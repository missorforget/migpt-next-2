import { randomUUID } from 'node:crypto';
import type { IMessage } from '@mi-gpt/chat';
import { firstOf, lastOf, sleep } from '@mi-gpt/utils';
import { extractNativeAnswer } from './native-answer.js';
import { MiService } from './service.js';

interface ConversationRecord {
  answers: Array<{
    type: string;
    tts?: { text?: string };
    llm?: { text?: string };
  }>;
  query: string;
  requestId?: string;
  time: number;
}

type GetConversationsFn = (options?: {
  limit?: number;
  timestamp?: number;
}) => Promise<{ records: ConversationRecord[] } | undefined> | undefined;

/**
 * 消息数据源：每个音箱对应一个独立的轮询游标
 */
interface MiMessageSource {
  /**
   * 音箱 did（多音箱时用于标记消息来源，方便回复路由到对应的音箱）
   */
  did?: string;
  getConversations: GetConversationsFn;
  lastQueryMsg?: IMessage;
  tempQueryMsgs: IMessage[];
}

interface MiMessageManagerOptions {
  /**
   * 单数据源（兼容旧版单音箱用法）
   */
  getConversations?: GetConversationsFn;
  /**
   * 多数据源：每个音箱一个（多音箱场景推荐使用）
   */
  sources?: Array<{ did?: string; getConversations?: GetConversationsFn }>;
  sleep?: (milliseconds: number) => Promise<void>;
  pendingPollInterval?: number;
  pendingPollTimeout?: number;
}

export class MiMessageManager {
  private _sources?: MiMessageSource[];
  private _resolvedDefaultSources?: MiMessageSource[];
  private _resolvedDevicesCount = -1;
  private readonly _sleep: NonNullable<MiMessageManagerOptions['sleep']>;
  private readonly _pendingPollInterval: number;
  private readonly _pendingPollTimeout: number;

  constructor(options: MiMessageManagerOptions = {}) {
    const getConversations =
      options.getConversations ?? ((request) => MiService.MiNA?.getConversations(request));
    const sources = options.sources?.map((e) => ({
      did: e.did,
      getConversations: e.getConversations ?? getConversations,
      tempQueryMsgs: [],
    }));
    if (sources && sources.length > 0) {
      // 多数据源：每个音箱一个
      this._sources = sources;
    } else if (options.getConversations) {
      // 单数据源（兼容旧版单音箱用法）
      this._sources = [{ getConversations, tempQueryMsgs: [] }];
    }
    // 都没有指定时，由 _resolveSources() 从 MiService 动态读取所有已初始化的音箱（多音箱）
    this._sleep = options.sleep ?? sleep;
    this._pendingPollInterval = Math.max(50, options.pendingPollInterval ?? 100);
    this._pendingPollTimeout = Math.max(
      this._pendingPollInterval,
      options.pendingPollTimeout ?? 2000,
    );
  }

  /**
   * 解析消息数据源：未显式配置时，自动从 MiService 读取所有已初始化的音箱（支持多音箱）
   */
  private _resolveSources(): MiMessageSource[] {
    if (this._sources) {
      return this._sources;
    }
    const devices = MiService.devices.filter((d) => d.MiNA);
    if (
      devices.length > 0 &&
      (!this._resolvedDefaultSources || devices.length !== this._resolvedDevicesCount)
    ) {
      this._resolvedDevicesCount = devices.length;
      this._resolvedDefaultSources = devices.map((d) => ({
        did: d.did,
        getConversations: (options?: { limit?: number; timestamp?: number }) =>
          d.MiNA!.getConversations(options),
        tempQueryMsgs: [],
      }));
    }
    if (!this._resolvedDefaultSources) {
      // 兼容旧版：MiService 未初始化多设备时的单数据源
      this._resolvedDefaultSources = [
        {
          getConversations: (options?: { limit?: number; timestamp?: number }) =>
            MiService.MiNA?.getConversations(options),
          tempQueryMsgs: [],
        },
      ];
    }
    return this._resolvedDefaultSources;
  }

  async fetchNextMessage(): Promise<IMessage | undefined> {
    // 多音箱：依次轮询每个音箱的对话消息，先到先处理
    for (const source of this._resolveSources()) {
      const msg = source.lastQueryMsg
        ? await this._fetchNextMessage(source)
        : await this._fetchFirstMessage(source);
      if (msg) {
        if (source.did) {
          msg.metadata = { ...msg.metadata, did: source.did };
        }
        return msg;
      }
    }
    return undefined;
  }

  private async _fetchFirstMessage(source: MiMessageSource) {
    const msgs = await this._fetchHistoryMsgs(source, {
      limit: 1,
      filterAnswer: false,
    });
    source.lastQueryMsg = msgs[0];
    return undefined;
  }

  private async _fetchNextMessage(source: MiMessageSource): Promise<IMessage | undefined> {
    if (source.tempQueryMsgs.length > 0) {
      // 当前有暂存的新消息（从新到旧），依次处理之
      return this._fetchNextTempMessage(source);
    }
    // 拉取最新的 2 条 msg（用于和上一条消息比对是否连续）
    const nextMsg = await this._fetchNext2Messages(source);
    if (nextMsg !== 'continue') {
      return nextMsg;
    }
    // 继续向上拉取其他新消息
    return this._fetchNextRemainingMessages(source);
  }

  /**
   * 拉取最新的 2 条消息，用于和上一条消息比对是否连续
   */
  private async _fetchNext2Messages(source: MiMessageSource) {
    let msgs = await this._fetchHistoryMsgs(source, { limit: 2, filterAnswer: false });
    const newest = firstOf(msgs);
    if (
      newest &&
      newest.timestamp > source.lastQueryMsg!.timestamp &&
      !this._hasNativeAnswer(newest)
    ) {
      const completed = await this._waitForNativeAnswer(source, newest);
      if (!completed) {
        return;
      }
      msgs = completed;
    }
    if (msgs.length < 1 || firstOf(msgs)!.timestamp <= source.lastQueryMsg!.timestamp) {
      // 没有拉到新消息
      return;
    }
    if (
      firstOf(msgs)!.timestamp > source.lastQueryMsg!.timestamp &&
      (msgs.length === 1 || lastOf(msgs)!.timestamp <= source.lastQueryMsg!.timestamp)
    ) {
      // 刚好收到一条新消息
      source.lastQueryMsg = firstOf(msgs);
      return source.lastQueryMsg;
    }
    // 还有其他新消息，暂存当前的新消息
    for (const msg of msgs) {
      if (msg.timestamp > source.lastQueryMsg!.timestamp) {
        source.tempQueryMsgs.push(msg);
      }
    }
    return 'continue';
  }

  private _hasNativeAnswer(msg: IMessage) {
    return typeof msg.metadata?.xiaoAIAnswer === 'string';
  }

  private async _waitForNativeAnswer(
    source: MiMessageSource,
    pending: IMessage,
  ): Promise<IMessage[] | undefined> {
    for (
      let elapsed = 0;
      elapsed < this._pendingPollTimeout;
      elapsed += this._pendingPollInterval
    ) {
      await this._sleep(this._pendingPollInterval);
      const msgs = await this._fetchHistoryMsgs(source, { limit: 2, filterAnswer: false });
      const current = msgs.find(
        (msg) => msg.id === pending.id || msg.timestamp === pending.timestamp,
      );
      if (current && this._hasNativeAnswer(current)) {
        return msgs;
      }
    }
    return undefined;
  }

  /**
   * 继续向上拉取其他新消息
   */
  private async _fetchNextRemainingMessages(
    source: MiMessageSource,
    options?: {
      maxPage?: number;
      pageSize?: number;
    },
  ) {
    let currentPage = 0;
    const { maxPage = 3, pageSize = 10 } = options ?? {};
    while (true) {
      currentPage++;
      if (currentPage > maxPage) {
        // 拉取新消息超长，取消拉取
        return this._fetchNextTempMessage(source);
      }
      const nextTimestamp = lastOf(source.tempQueryMsgs)!.timestamp;
      const msgs = await this._fetchHistoryMsgs(source, {
        limit: pageSize,
        timestamp: nextTimestamp,
      });
      for (const msg of msgs) {
        if (msg.timestamp >= nextTimestamp) {
          // 忽略上一页的消息
        } else if (msg.timestamp > source.lastQueryMsg!.timestamp) {
          // 继续添加新消息
          source.tempQueryMsgs.push(msg);
        } else {
          // 拉取到历史消息处
          return this._fetchNextTempMessage(source);
        }
      }
    }
  }

  /**
   * 读取暂存的消息
   */
  private _fetchNextTempMessage(source: MiMessageSource) {
    const nextMsg = source.tempQueryMsgs.pop();
    source.lastQueryMsg = nextMsg;
    return nextMsg;
  }

  private async _fetchHistoryMsgs(
    source: MiMessageSource,
    options?: {
      limit?: number;
      timestamp?: number;
      filterAnswer?: boolean;
    },
  ): Promise<IMessage[]> {
    const filterAnswer = options?.filterAnswer ?? true;
    const conversation = await source.getConversations(options);
    let records = conversation?.records ?? [];
    if (filterAnswer) {
      // 过滤有小爱回答的消息
      records = records.filter(
        (e) =>
          ['TTS', 'LLM'].includes(e.answers[0]?.type ?? '') && // 过滤 TTS 和 LLM 消息
          e.answers.length === 1, // 播放音乐时会有 TTS、Audio 两个 Answer
      );
    }
    return records.map((e) => {
      const nativeAnswer = extractNativeAnswer(e);
      return {
        id: e.requestId || randomUUID(),
        sender: 'user',
        text: e.query,
        timestamp: e.time,
        metadata: nativeAnswer
          ? {
              xiaoAIAnswer: nativeAnswer.text,
              xiaoAIAnswerType: nativeAnswer.type,
            }
          : undefined,
      };
    });
  }
}

export const MiMessage = new MiMessageManager();
