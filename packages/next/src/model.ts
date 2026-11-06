/**
 * 各型号小爱音箱的 MIoT 指令差异
 *
 * 不同型号的「播放文本（TTS）」和「唤醒」指令不一致，用错指令会导致：
 * - 发成唤醒指令 → 音箱只亮灯不出声
 * - 发成其他 siid/aiid → 直接报错 or 无反应
 */
export interface MiSpeakerCapability {
  /**
   * TTS 文本播报指令 [siid, aiid]
   *
   * 对应 MIoT 动作：siid=5（音箱扬声器）, aiid 因型号而异
   */
  ttsCommand: [number, number];
  /**
   * 唤醒指令 [siid, aiid]
   */
  wakeUpCommand: [number, number];
}

/**
 * 默认能力：绝大多数型号（含智能家庭屏系列）都使用 [5, 3] 播放文本、[5, 4] 唤醒
 */
export const kDefaultSpeakerCapability: MiSpeakerCapability = {
  ttsCommand: [5, 3],
  wakeUpCommand: [5, 4],
};

/**
 * 型号 → MIoT 指令对照表
 *
 * key 为型号（大小写不敏感），可从米家设备列表的 model 字段获取：
 * `xiaomi.wifispeaker.lx06` → `LX06`
 *
 * 智能家庭屏系列（X10A 等）与主流型号一致，走默认值即可，无需单独配置
 */
export const kSpeakerCapabilities: Record<string, MiSpeakerCapability> = {
  /** 小爱音箱（初代） */
  LX01: { ttsCommand: [5, 1], wakeUpCommand: [5, 3] },
  /** 小爱音箱（第二代）/ S12 系列 */
  S12A: { ttsCommand: [5, 1], wakeUpCommand: [5, 3] },
  /** 小爱音箱 Pro */
  LX06: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小爱音箱 Art */
  L09A: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小爱音箱 Play（新款） */
  X08A: { ttsCommand: [5, 3], wakeUpCommand: [5, 5] },
  /** 小爱音箱 Play（新款） */
  X08E: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小爱音箱 Play（老款） */
  L05B: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小爱音箱 Play 增强版 */
  L05C: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小爱音箱（经典款） */
  L06A: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小爱音箱 mini */
  L07A: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
  /** 小米智能家庭屏 10 */
  X10A: { ttsCommand: [5, 3], wakeUpCommand: [5, 4] },
};

/**
 * 型号别名
 *
 * 有的设备 model 是 `xiaomi.wifispeaker.s12`（解析出 S12），
 * 而硬件型号 / 指令表里写的是 `S12A`，这里做一次归一化
 */
export const kSpeakerModelAlias: Record<string, string> = {
  S12: 'S12A',
  S12B: 'S12A',
};

/**
 * 从 model / hardware 字段解析型号
 *
 * - `xiaomi.wifispeaker.lx06` → `LX06`
 * - `xiaomi.wifispeaker.x08e` → `X08E`
 * - `LX01` → `LX01`
 */
export function parseSpeakerModel(model?: string): string | undefined {
  if (!model || typeof model !== 'string') {
    return undefined;
  }
  const parts = model
    .trim()
    .split(/[.\-_/\s]+/)
    .filter(Boolean);
  const raw = parts[parts.length - 1];
  if (!raw) {
    return undefined;
  }
  const code = raw.toUpperCase();
  return kSpeakerModelAlias[code] ?? code;
}

/**
 * 从多个候选字段里挑出最可信的型号
 *
 * 优先级：能命中指令表的候选 > 第一个有效候选，避免 MiOT 的 model
 * 是个未收录的兜底值（如 `xiaomi.wifispeaker`）时丢掉 MiNA 的 hardware
 */
export function resolveSpeakerModel(...candidates: (string | undefined)[]): string | undefined {
  let fallback: string | undefined;
  for (const candidate of candidates) {
    const code = parseSpeakerModel(candidate);
    if (!code) {
      continue;
    }
    if (kSpeakerCapabilities[code]) {
      return code;
    }
    fallback ??= code;
  }
  return fallback;
}

/**
 * 按型号获取音箱能力（未收录的型号回退到默认值）
 */
export function getSpeakerCapability(model?: string): MiSpeakerCapability {
  const code = parseSpeakerModel(model);
  if (!code) {
    return { ...kDefaultSpeakerCapability };
  }
  const capability = kSpeakerCapabilities[code] ?? kDefaultSpeakerCapability;
  return {
    ttsCommand: [...capability.ttsCommand] as [number, number],
    wakeUpCommand: [...capability.wakeUpCommand] as [number, number],
  };
}

/**
 * 解析音箱能力：型号自动识别 + 用户自定义指令覆盖
 */
export function resolveSpeakerCapability(options: {
  /** 型号，如 LX01 / xiaomi.wifispeaker.lx06（可选，识别不到时会回退默认值） */
  model?: string;
  /** 自定义 TTS 指令，覆盖型号默认值 */
  ttsCommand?: number[];
  /** 自定义唤醒指令，覆盖型号默认值 */
  wakeUpCommand?: number[];
}): MiSpeakerCapability & { model?: string } {
  const capability = getSpeakerCapability(options.model);
  const ttsCommand = normalizeCommand(options.ttsCommand);
  const wakeUpCommand = normalizeCommand(options.wakeUpCommand);
  if (ttsCommand) {
    capability.ttsCommand = ttsCommand;
  }
  if (wakeUpCommand) {
    capability.wakeUpCommand = wakeUpCommand;
  }
  return { ...capability, model: parseSpeakerModel(options.model) };
}

/**
 * 校验并归一化 [siid, aiid] 指令
 */
function normalizeCommand(command?: number[]): [number, number] | undefined {
  if (!Array.isArray(command) || command.length !== 2) {
    return undefined;
  }
  const [siid, aiid] = command;
  if (!Number.isFinite(siid) || !Number.isFinite(aiid)) {
    return undefined;
  }
  return [Number(siid), Number(aiid)];
}
