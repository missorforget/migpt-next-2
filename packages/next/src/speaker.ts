import type { ISpeaker } from '@mi-gpt/engine/base';
import { kDefaultSpeakerCapability } from './model.js';
import { MiService, type MiDeviceServices } from './service.js';

export interface IPlayMessageOptions {
  text?: string;
  url?: string;
}

/**
 * 单个音箱的 Speaker
 */
class SingleSpeaker implements ISpeaker {
  constructor(private device: MiDeviceServices) {}

  /**
   * 播放文字、音频链接
   *
   * 文字优先走 MiNA 的 TTS；MiNA 不可用或失败时，再按该音箱型号的
   * MIoT「播放文本」指令兜底（LX01 / S12A 是 [5, 1]，其余多为 [5, 3]）
   */
  async play({ text, url }: IPlayMessageOptions = {}) {
    const { MiNA, MiOT, capability } = this.device;
    if (url) {
      return MiNA ? MiNA.play({ url }) : false;
    }
    if (!text) {
      return false;
    }
    const ok = MiNA ? await MiNA.play({ text }) : false;
    if (ok || !MiOT) {
      return ok;
    }
    const [siid, aiid] = capability.ttsCommand;
    return MiOT.doAction(siid, aiid, text);
  }

  /**
   * 中断原来小爱的运行
   */
  async abortXiaoAI() {
    const { MiNA } = this.device;
    if (!MiNA) {
      return false;
    }
    return MiNA.stop();
  }
}

/**
 * 多音箱广播 Speaker：同时操作所有音箱
 */
class BroadcastSpeaker implements ISpeaker {
  constructor(private devices: MiDeviceServices[]) {}

  private static async _broadcast(
    devices: MiDeviceServices[],
    action: (speaker: SingleSpeaker) => Promise<boolean>,
  ) {
    const targets = devices.filter((d) => d.MiNA);
    if (targets.length === 0) {
      return false;
    }
    const results = await Promise.all(targets.map((d) => action(new SingleSpeaker(d))));
    return results.some(Boolean);
  }

  async play(options: IPlayMessageOptions = {}) {
    return BroadcastSpeaker._broadcast(this.devices, (speaker) => speaker.play(options));
  }

  async abortXiaoAI() {
    return BroadcastSpeaker._broadcast(this.devices, (speaker) => speaker.abortXiaoAI());
  }
}

/**
 * 多音箱管理器
 *
 * - MiGPT 引擎把它当做一个普通的 ISpeaker 使用
 * - 单音箱：行为与旧版完全一致
 * - 多音箱：默认广播（所有音箱同时播放/中断），也可通过 of(did) 路由到指定音箱
 */
class SpeakerManager implements ISpeaker {
  /**
   * 获取指定音箱的 Speaker
   *
   * - did 为空：只有一个音箱时返回该音箱，多个音箱时返回广播 Speaker
   * - did 不存在：返回一个空操作 Speaker（不会误播到其他音箱）
   */
  of(did?: string): ISpeaker {
    if (did) {
      // 用 getDevice 而不是直接比 did：名称 / 备注名 / miotDID / mac 都能命中
      const device = MiService.getDevice(did);
      if (device) {
        return new SingleSpeaker(device);
      }
      console.warn(`⚠️ 未找到音箱（${did}），已忽略本次播放请求`);
      return new SingleSpeaker({ did, capability: kDefaultSpeakerCapability });
    }
    if (MiService.devices.length === 1) {
      return new SingleSpeaker(MiService.devices[0]!);
    }
    return new BroadcastSpeaker(MiService.devices);
  }

  /**
   * 播放文字、音频链接（广播到所有音箱，任一成功即返回 true）
   */
  async play(options: IPlayMessageOptions = {}) {
    return new BroadcastSpeaker(MiService.devices).play(options);
  }

  /**
   * 中断所有音箱上原来小爱的运行
   */
  async abortXiaoAI() {
    return new BroadcastSpeaker(MiService.devices).abortXiaoAI();
  }
}

export const MiSpeaker = new SpeakerManager();
