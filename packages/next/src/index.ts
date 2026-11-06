import { ChatBot, type IMessage } from '@mi-gpt/chat';
import type { ISpeaker, IReply } from '@mi-gpt/engine/base';
import { type EngineConfig, MiGPTEngine } from '@mi-gpt/engine/index';
import { deepMerge, sleep } from '@mi-gpt/utils';
import type { Prettify } from '@mi-gpt/utils/typing';
import { MiMessage } from './message.js';
import type { MiSpeakerCapability } from './model.js';
import { kDefaultSpeakerCapability } from './model.js';
import { MiService, type MiSpeakerDeviceConfig } from './service.js';
import { MiSpeaker } from './speaker.js';

export { extractNativeAnswer } from './native-answer.js';
export type { NativeAnswer } from './native-answer.js';
export {
  kDefaultSpeakerCapability,
  kSpeakerCapabilities,
  kSpeakerModelAlias,
  getSpeakerCapability,
  parseSpeakerModel,
  resolveSpeakerCapability,
  resolveSpeakerModel,
} from './model.js';
export type { MiSpeakerCapability } from './model.js';
export { MiSpeaker } from './speaker.js';
export type { MiDeviceServices, MiSpeakerDeviceConfig } from './service.js';

/**
 * 单个音箱的配置（不同型号的音箱只需分别填写对应的 did）
 *
 * - model / ttsCommand / wakeUpCommand 一般无需填写，会自动按型号适配
 */
export type MiSpeakerConfig = MiSpeakerDeviceConfig & {
  /**
   * 消息轮询间隔（毫秒）
   *
   * 默认 1000（最低 1 秒）
   */
  heartbeat?: number;
};

export type MiGPTConfig = Prettify<
  EngineConfig<MiJiaEngine> & {
    debug?: boolean;
    /**
     * 音箱配置
     *
     * 支持两种写法：
     * - 单个音箱：speaker: { did, userId, password, ... }（兼容旧版）
     * - 多个音箱：speaker: [{ did: '音箱A', ... }, { did: '音箱B', ... }]
     *
     * 多个音箱支持混搭不同型号，共用同一个小米账号时只需分别填写 did
     */
    speaker?: MiSpeakerConfig | MiSpeakerConfig[];
    /**
     * 多个音箱配置（与 speaker 二选一，也可同时使用，推荐多音箱场景使用）
     */
    speakers?: MiSpeakerConfig[];
  }
>;

const kDefaultMiGPTConfig: MiGPTConfig = {
  debug: false,
  // 默认仅提供全局轮询间隔，音箱具体配置（did 等）由用户传入
  speaker: { heartbeat: 500 } as MiGPTConfig['speaker'],
};

class MiJiaEngine extends MiGPTEngine {
  config: MiGPTConfig = kDefaultMiGPTConfig;

  speaker = MiSpeaker;

  /**
   * 兼容旧版：第一个音箱的 MiNA（多音箱请使用 getMiNA(did)）
   */
  get MiNA() {
    return MiService.MiNA!;
  }

  /**
   * 兼容旧版：第一个音箱的 MIoT（多音箱请使用 getMiOT(did)）
   */
  get MiOT() {
    return MiService.MiOT!;
  }

  /**
   * 获取指定音箱的 MiNA 服务（did 为空时返回第一个音箱）
   */
  getMiNA(did?: string) {
    return MiService.getDevice(did)?.MiNA;
  }

  /**
   * 获取指定音箱的 MIoT 服务（did 为空时返回第一个音箱）
   */
  getMiOT(did?: string) {
    return MiService.getDevice(did)?.MiOT;
  }

  /**
   * 获取指定音箱的型号能力（TTS / 唤醒指令，已按型号自动适配）
   */
  getSpeakerCapability(did?: string): MiSpeakerCapability {
    return MiService.getDevice(did)?.capability ?? kDefaultSpeakerCapability;
  }

  /**
   * 让指定音箱播报一段文字
   *
   * 会自动按型号选择正确的 TTS 指令（如 LX01 是 [5, 1]，其余多为 [5, 3]），
   * 替代业务代码里硬编码的 `MiOT.doAction(5, 3, text)`
   */
  async say(text: string, did?: string) {
    const device = MiService.getDevice(did);
    if (!device?.MiOT) {
      console.warn(`⚠️ 未找到音箱（${did ?? '默认'}）的 MIoT 服务，已跳过播报：${text}`);
      return false;
    }
    const [siid, aiid] = this.getSpeakerCapability(did).ttsCommand;
    const ok = await device.MiOT.doAction(siid, aiid, text);
    if (!ok) {
      console.warn(
        `⚠️ 音箱（${device.did}）播放文本失败（指令 [${siid}, ${aiid}]，型号 ${device.model ?? '未识别'}）` +
          `，可在配置里用 ttsCommand 覆盖，如 LX01/S12A 类型号试 [5, 1]，其余试 [5, 3]`,
      );
    }
    return ok;
  }

  /**
   * 唤醒指定音箱（按型号自动适配唤醒指令）
   */
  async wakeUp(did?: string) {
    const device = MiService.getDevice(did);
    if (!device?.MiOT) {
      console.warn(`⚠️ 未找到音箱（${did ?? '默认'}）的 MIoT 服务，已跳过唤醒`);
      return false;
    }
    const [siid, aiid] = this.getSpeakerCapability(did).wakeUpCommand;
    return device.MiOT.doAction(siid, aiid);
  }

  /**
   * 获取消息对应的 Speaker
   *
   * 多音箱场景下，根据消息来源（msg.metadata.did，由消息轮询自动标记）
   * 路由到对应的音箱；找不到来源音箱时不做任何播放（避免误播到其他音箱）
   */
  getSpeaker(msg?: IMessage): ISpeaker {
    const did = msg?.metadata?.did as string | undefined;
    return MiSpeaker.of(did);
  }

  // 轮询消息
  #processing = false;
  async #processMessage(msg: IMessage) {
    if (this.#processing) return;
    this.#processing = true;
    try {
      await this.onMessage(msg);
    } finally {
      this.#processing = false;
    }
  }

  async start(config: MiGPTConfig) {
    await super.start(deepMerge(kDefaultMiGPTConfig, config));

    await MiService.init(this.config as any);

    console.log(`✅ 服务已启动...（已连接 ${MiService.devices.length} 个音箱）`);

    // 轮询间隔最小 1 秒（多音箱时共用全局轮询节奏）
    const heartbeatConfig = Array.isArray(this.config.speaker)
      ? this.config.speaker[0]
      : this.config.speaker;
    const heartbeat = Math.max(500, heartbeatConfig?.heartbeat ?? 500);

    // 轮询消息（多音箱时同时轮询所有音箱的对话消息）
    while (this.status === 'running') {
      const msg = await MiMessage.fetchNextMessage();
      if (msg) {
        await this.#processMessage(msg);
      }
      await sleep(heartbeat);
    }
  }

  async askAI(msg: IMessage): Promise<IReply> {
    const text = await ChatBot.chat(msg);
    return { text };
  }
}

export const MiGPT = new MiJiaEngine();
