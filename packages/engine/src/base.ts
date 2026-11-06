import type { IMessage } from '@mi-gpt/chat';
import type { StreamResponse } from '@mi-gpt/stream';

export interface IReply {
  /**
   * 文字回复
   */
  text?: string;
  /**
   * 音频链接
   */
  url?: string;
  /**
   * 流式响应
   */
  stream?: StreamResponse;
  /**
   * 已经处理过用户的消息了，不再走默认的处理逻辑
   */
  handled?: boolean;
  /**
   * 使用默认的消息处理逻辑
   */
  default?: boolean;
  /**
   * （多音箱场景）指定回复到哪个音箱
   *
   * 填写配置里对应音箱的 did；不填时回复到消息来源的音箱
   */
  did?: string;
}

export interface ISpeaker {
  /**
   * 中断原来小爱的运行
   */
  abortXiaoAI: () => Promise<boolean>;
  /**
   * 播放文字、音频链接
   */
  play: ({
    text,
    url,
  }: {
    text?: string;
    url?: string;
    bytes?: Uint8Array;
    /**
     * 超时时长（毫秒）
     *
     * 默认 10 分钟
     */
    timeout?: number;
    /**
     * 是否阻塞运行(仅对播放文字、音频链接有效)
     *
     * 如果是则等到音频播放完毕才会返回
     */
    blocking?: boolean;
  }) => Promise<boolean>;
}

export abstract class BaseEngine {
  status: 'running' | 'stopped' = 'stopped';

  abstract config: Record<string, any>;
  /**
   * Speaker（单音箱或管理多个音箱的多 Speaker 管理器）
   */
  abstract speaker: ISpeaker;

  abstract start(config: this['config']): Promise<void>;
  abstract stop(): Promise<void>;

  abstract onMessage(msg: IMessage): Promise<void>;
  abstract askAI(msg: IMessage, options?: { stream?: boolean }): Promise<IReply>;
}
