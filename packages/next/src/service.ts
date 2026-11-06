import {
  type MIoT,
  type MiNA,
  type MiServiceConfig as _MiServiceConfig,
  getMIoT,
  getMiNA,
} from '@mi-gpt/miot';
import { jsonEncode } from '@mi-gpt/utils/parse';
import {
  type MiSpeakerCapability,
  kDefaultSpeakerCapability,
  resolveSpeakerCapability,
  resolveSpeakerModel,
} from './model.js';
import { assert } from './utils.js';

export type MiServiceConfig = _MiServiceConfig;

/**
 * 单个音箱的配置（不同型号的音箱只需分别填写对应的 did）
 */
export interface MiSpeakerDeviceConfig extends MiServiceConfig {
  /**
   * 音箱型号（可选）
   *
   * 一般情况下会自动从设备信息里识别（如 `xiaomi.wifispeaker.lx06` → `LX06`），
   * 只有识别不到、或者想强制指定时再手动填写，比如 `LX01`
   */
  model?: string;
  /**
   * 自定义 TTS 文本播报指令 [siid, aiid]（可选）
   *
   * 一般无需填写，内置了各型号的默认值；特殊固件可以在这里覆盖
   */
  ttsCommand?: [number, number];
  /**
   * 自定义唤醒指令 [siid, aiid]（可选）
   */
  wakeUpCommand?: [number, number];
}

/**
 * 单个音箱的 Mi Services（MiNA + MIoT）
 */
export interface MiDeviceServices {
  /**
   * 音箱标识（配置里的 did，可以是米家名称 / miotDID / mac / 设备ID）
   */
  did: string;
  /**
   * 米家中的设备名称
   */
  name?: string;
  /**
   * 米家里的备注名 / 别名（MiNA 专有）
   */
  alias?: string;
  /**
   * MIoT 设备 ID（一串数字）
   */
  miotDID?: string;
  /**
   * MiNA 设备 ID
   */
  deviceID?: string;
  /**
   * mac 地址
   */
  mac?: string;
  /**
   * 音箱型号（如 LX01、LX06、X08A）
   */
  model?: string;
  /**
   * 该型号对应的 MIoT 指令（TTS / 唤醒）
   */
  capability: MiSpeakerCapability;
  MiNA?: MiNA;
  MiOT?: MIoT;
}

/**
 * 归一化设备标识用于比对（忽略大小写、首尾空格、mac 的分隔符）
 *
 * 之所以做这个处理：`did` 允许填名称 / miotDID / mac，
 * 但 mac 常有 `AA:BB:CC`、`aa-bb-cc`、`aabbcc` 等不同写法
 */
function toDeviceKey(value?: string): string | undefined {
  const key = value?.trim().toLowerCase().replace(/[:\-\s]/g, '');
  return key || undefined;
}

class _MiService {
  /**
   * 所有已初始化的音箱服务（支持多个音箱、兼容多个型号）
   */
  devices: MiDeviceServices[] = [];

  /**
   * 兼容旧版单音箱用法：MiService.MiNA
   *
   * 多音箱时返回第一个成功初始化的音箱，操作指定音箱请使用 getDevice(did)
   */
  get MiNA(): MiNA | undefined {
    return this.devices.find((d) => d.MiNA)?.MiNA;
  }

  set MiNA(value: MiNA | undefined) {
    if (this.devices.length === 0) {
      this.devices.push({ did: 'default', capability: kDefaultSpeakerCapability });
    }
    this.devices[0]!.MiNA = value;
  }

  /**
   * 兼容旧版单音箱用法：MiService.MiOT
   *
   * 多音箱时返回第一个成功初始化的音箱，操作指定音箱请使用 getDevice(did)
   */
  get MiOT(): MIoT | undefined {
    return this.devices.find((d) => d.MiOT)?.MiOT;
  }

  set MiOT(value: MIoT | undefined) {
    if (this.devices.length === 0) {
      this.devices.push({ did: 'default', capability: kDefaultSpeakerCapability });
    }
    this.devices[0]!.MiOT = value;
  }

  /**
   * 按 did 获取指定音箱的服务（did 为空时返回第一个音箱）
   *
   * did 支持米家名称、备注名、miotDID、MiNA deviceID、mac 地址，
   * 所以 `engine.say(text, '客厅音箱')` 和 `engine.say(text, '123456789')`
   * 指向同一台设备时都能命中
   */
  getDevice(did?: string): MiDeviceServices | undefined {
    const key = toDeviceKey(did);
    if (!key) {
      return this.devices[0];
    }
    return this.devices.find((d) =>
      [d.did, d.name, d.alias, d.miotDID, d.deviceID, d.mac]
        .map(toDeviceKey)
        .filter(Boolean)
        .includes(key),
    );
  }

  /**
   * 初始化一个或多个音箱（支持同时接入多个不同型号的音箱）
   *
   * @param config.speaker 单个音箱配置，或音箱配置数组
   * @param config.speakers 音箱配置数组（与 speaker 二选一，也可同时使用）
   */
  async init(config: {
    debug?: boolean;
    speaker?: MiSpeakerDeviceConfig | MiSpeakerDeviceConfig[];
    speakers?: MiSpeakerDeviceConfig[];
  }) {
    const { debug = false } = config;
    const configs = normalizeSpeakerConfigs(config);

    assert(configs.length > 0, '❌ Speaker 缺少配置参数');

    for (const item of configs) {
      const speaker = { ...item, debug, timeout: Math.max(1000, item.timeout ?? 5000) };

      assert(!!speaker.did, '❌ Speaker 缺少 did 参数');
      assert(
        !!speaker.passToken || (!!speaker.userId && !!speaker.password),
        `❌ Speaker（${speaker.did}）缺少 passToken 或 userId 和 password`,
      );

      let MiNA = await getMiNA(speaker);
      let MiOT = await getMIoT(speaker);

      // MiNA 支持「备注名 / 别名」，MIoT 只认 did / name / mac：
      // 用备注名配置时 MIoT 会找不到设备，这里用 MiNA 解析出的 miotDID 再试一次
      if (!MiOT) {
        const resolved: any = (MiNA?.account as any)?.device;
        const fallbackDid: string | undefined = resolved?.miotDID ?? resolved?.did;
        if (fallbackDid && fallbackDid !== speaker.did) {
          console.log(`🔁 按「${speaker.did}」未匹配到 MIoT 设备，改用设备 ID（${fallbackDid}）重试`);
          MiOT = await getMIoT({ ...speaker, did: fallbackDid });
        }
      }

      assert(
        !!MiNA && !!MiOT,
        `❌ 初始化音箱（${speaker.did}）Mi Services 失败：` +
          `请确认该值和米家里的设备名称 / 备注名 / miotDID / mac 完全一致` +
          `（注意「音响」与「音箱」、空格、大小写），或打开 debug 查看设备列表`,
      );

      // 自动识别型号：MIoT 的 model（xiaomi.wifispeaker.lx06）/ MiNA 的 hardware（LX06）
      // 优先取能命中指令表的那个，避免 model 是兜底值时丢掉 hardware
      const model = resolveSpeakerModel(
        speaker.model,
        (MiOT!.account as any)?.device?.model,
        (MiNA!.account as any)?.device?.hardware,
      );
      const capability = resolveSpeakerCapability({
        model,
        ttsCommand: speaker.ttsCommand,
        wakeUpCommand: speaker.wakeUpCommand,
      });

      // 记录设备的各种标识：did 允许填名称 / 备注名 / miotDID / deviceID / mac，
      // 有了这些字段，后续用任意一种标识都能路由到这同一台音箱
      const miotDevice: any = (MiOT!.account as any)?.device;
      const minaDevice: any = (MiNA!.account as any)?.device;
      const miotDID: string | undefined = miotDevice?.did ?? minaDevice?.miotDID;
      const mac: string | undefined = miotDevice?.mac ?? minaDevice?.mac;

      // 多音箱常见故障：两个配置项写成了同一台设备（比如名称写重复了）
      const duplicated = this.devices.find(
        (d) =>
          (!!miotDID && d.miotDID === miotDID) ||
          (!!toDeviceKey(mac) && toDeviceKey(d.mac) === toDeviceKey(mac)),
      );
      if (duplicated) {
        console.warn(
          `⚠️ 音箱（${speaker.did}）与已连接的音箱（${duplicated.did}）是同一台设备，已跳过。` +
            `多音箱请为每个音箱填写不同的 did，建议直接用 miotDID 或 mac 区分`,
        );
        continue;
      }

      this.devices.push({
        did: speaker.did,
        name: miotDevice?.name ?? minaDevice?.name,
        alias: minaDevice?.alias,
        miotDID,
        deviceID: minaDevice?.deviceID,
        mac,
        model: capability.model,
        capability,
        MiNA,
        MiOT,
      });

      if (debug) {
        const device: any = MiOT!.account?.device;
        console.debug(
          `🐛 音箱（${speaker.did}）设备信息：`,
          jsonEncode(
            {
              name: device?.name,
              desc: device?.desc,
              model: device?.model,
              rom: device?.extra?.fw_version,
              ttsCommand: capability.ttsCommand,
              wakeUpCommand: capability.wakeUpCommand,
            },
            { prettier: true },
          ),
        );
      }
    }

    assert(this.devices.length > 0, '❌ 初始化 Mi Services 失败');
  }
}

/**
 * 归一化音箱配置：兼容 单个对象 / 对象数组 / speakers 数组 三种写法，并按 did 去重
 */
export function normalizeSpeakerConfigs(config: {
  speaker?: MiSpeakerDeviceConfig | MiSpeakerDeviceConfig[];
  speakers?: MiSpeakerDeviceConfig[];
}): MiSpeakerDeviceConfig[] {
  const { speaker, speakers } = config ?? {};

  let list: MiSpeakerDeviceConfig[] = [];
  if (Array.isArray(speaker)) {
    list = [...speaker];
  } else if (speaker) {
    list = [speaker];
  }
  if (Array.isArray(speakers)) {
    list = [...list, ...speakers];
  }

  const seen = new Set<string>();
  return list.filter((e) => {
    // 配置去重只看 did 本身（trim + 忽略大小写），不合并空格，避免把
    // 「小爱 音箱」和「小爱音箱」这种不同名称误判为同一台
    const key = String(e?.did ?? '')
      .trim()
      .toLowerCase();
    if (!key) {
      console.warn('⚠️ 有音箱配置缺少 did，已跳过该项');
      return false;
    }
    if (seen.has(key)) {
      console.warn(`⚠️ 音箱配置（${e.did}）重复，已跳过。多音箱请为每个音箱填写不同的 did`);
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const MiService = new _MiService();
