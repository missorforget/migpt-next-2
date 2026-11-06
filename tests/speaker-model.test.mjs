import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MiGPT,
  MiSpeaker,
  getSpeakerCapability,
  parseSpeakerModel,
  resolveSpeakerCapability,
  resolveSpeakerModel,
} from '../packages/next/dist/index.js';
import { MiService, normalizeSpeakerConfigs } from '../packages/next/dist/service.js';

test('parses speaker model codes from MIoT / MiNA device fields', () => {
  assert.equal(parseSpeakerModel('xiaomi.wifispeaker.lx06'), 'LX06');
  assert.equal(parseSpeakerModel('xiaomi.wifispeaker.x08e'), 'X08E');
  assert.equal(parseSpeakerModel('LX01'), 'LX01');
  assert.equal(parseSpeakerModel('xiaomi.wifispeaker.l09a'), 'L09A');
  // S12 系列归一化为指令表里的 S12A
  assert.equal(parseSpeakerModel('xiaomi.wifispeaker.s12'), 'S12A');
  assert.equal(parseSpeakerModel('S12A'), 'S12A');
  assert.equal(parseSpeakerModel('s12a'), 'S12A');
  assert.equal(parseSpeakerModel(''), undefined);
  assert.equal(parseSpeakerModel(undefined), undefined);
});

test('picks the most reliable model from multiple candidates', () => {
  // model 是兜底值、hardware 才准确时，以 hardware 为准
  assert.equal(resolveSpeakerModel('xiaomi.wifispeaker', 'S12A'), 'S12A');
  assert.equal(resolveSpeakerModel('xiaomi.wifispeaker.s12', 'S12A'), 'S12A');
  // 手工配置优先
  assert.equal(resolveSpeakerModel('LX01', 'S12A'), 'LX01');
  assert.equal(resolveSpeakerModel(undefined, undefined), undefined);
});

test('uses the model specific TTS / wake up commands', () => {
  // 小爱音箱（LX01）：TTS 是 [5, 1]，唤醒是 [5, 3]
  assert.deepEqual(getSpeakerCapability('LX01').ttsCommand, [5, 1]);
  assert.deepEqual(getSpeakerCapability('LX01').wakeUpCommand, [5, 3]);

  // 小爱音箱（第二代）S12A：同样是 [5, 1] 播报
  assert.deepEqual(getSpeakerCapability('S12A').ttsCommand, [5, 1]);
  assert.deepEqual(getSpeakerCapability('S12A').wakeUpCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability('xiaomi.wifispeaker.s12').ttsCommand, [5, 1]);

  // 小爱音箱 Pro（LX06）
  assert.deepEqual(getSpeakerCapability('xiaomi.wifispeaker.lx06').ttsCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability('xiaomi.wifispeaker.lx06').wakeUpCommand, [5, 4]);

  // 小爱音箱 Art（L09A）
  assert.deepEqual(getSpeakerCapability('L09A').ttsCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability('L09A').wakeUpCommand, [5, 4]);

  // 小爱音箱 Play（X08A）：唤醒是 [5, 5]
  assert.deepEqual(getSpeakerCapability('X08A').ttsCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability('X08A').wakeUpCommand, [5, 5]);

  // 小爱音箱 Play（X08E）
  assert.deepEqual(getSpeakerCapability('X08E').ttsCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability('X08E').wakeUpCommand, [5, 4]);

  // 智能家庭屏系列与主流型号一致（走默认值）
  assert.deepEqual(getSpeakerCapability('X10A').ttsCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability('X10A').wakeUpCommand, [5, 4]);

  // 未收录的型号回退默认值
  assert.deepEqual(getSpeakerCapability('UNKNOWN-MODEL').ttsCommand, [5, 3]);
  assert.deepEqual(getSpeakerCapability(undefined).ttsCommand, [5, 3]);
});

test('supports overriding commands for special firmwares', () => {  const capability = resolveSpeakerCapability({
    model: 'LX06',
    ttsCommand: [5, 7],
    wakeUpCommand: [5, 9],
  });
  assert.deepEqual(capability.ttsCommand, [5, 7]);
  assert.deepEqual(capability.wakeUpCommand, [5, 9]);
  assert.equal(capability.model, 'LX06');

  // 非法指令会被忽略，回退到型号默认值
  const invalid = resolveSpeakerCapability({ model: 'LX01', ttsCommand: [5] });
  assert.deepEqual(invalid.ttsCommand, [5, 1]);
});

test('speaker.play falls back to the model specific MIoT TTS when MiNA fails', async () => {
  const original = MiService.devices;
  try {
    const calls = [];
    MiService.devices = [
      {
        did: '二代音箱',
        model: 'S12A',
        capability: getSpeakerCapability('S12A'),
        MiNA: { play: async () => false, stop: async () => true },
        MiOT: {
          doAction: async (...args) => {
            calls.push(args);
            return true;
          },
        },
      },
    ];

    // MiNA TTS 失败 → 回退到 MIoT 播放文本，且用 S12A 的 [5, 1]
    assert.equal(await MiSpeaker.of('二代音箱').play({ text: '你好' }), true);
    assert.deepEqual(calls, [[5, 1, '你好']]);
  } finally {
    MiService.devices = original;
  }
});

test('engine.say / wakeUp use the command of each speaker model', async () => {
  const original = MiService.devices;
  try {
    const calls = [];
    const stubMiOT = (name) => ({
      doAction: async (...args) => {
        calls.push([name, ...args]);
        return true;
      },
    });
    MiService.devices = [
      {
        did: '老音箱',
        model: 'LX01',
        capability: getSpeakerCapability('LX01'),
        MiOT: stubMiOT('LX01'),
      },
      {
        did: '新音箱',
        model: 'LX06',
        capability: getSpeakerCapability('LX06'),
        MiOT: stubMiOT('LX06'),
      },
    ];

    await MiGPT.say('你好', '老音箱');
    await MiGPT.say('你好', '新音箱');
    await MiGPT.wakeUp('老音箱');
    await MiGPT.wakeUp('新音箱');

    assert.deepEqual(calls, [
      ['LX01', 5, 1, '你好'],
      ['LX06', 5, 3, '你好'],
      ['LX01', 5, 3],
      ['LX06', 5, 4],
    ]);

    // 未知 did 不会误发指令
    calls.length = 0;
    assert.equal(await MiGPT.say('nope', '不存在的音箱'), false);
    assert.deepEqual(calls, []);
  } finally {
    MiService.devices = original;
  }
});

test('did 支持名称 / 备注名 / miotDID / mac 多种写法', async () => {
  const original = MiService.devices;
  try {
    const calls = [];
    MiService.devices = [
      {
        did: '客厅音箱', // 配置里填的是名称
        name: '客厅音箱',
        alias: '客厅的',
        miotDID: '111111',
        deviceID: 'dev-1',
        mac: 'AA:BB:CC:DD:EE:01',
        model: 'LX06',
        capability: getSpeakerCapability('LX06'),
        MiOT: {
          doAction: async (...args) => {
            calls.push(['客厅', ...args]);
            return true;
          },
        },
      },
      {
        did: '222222', // 配置里填的是 miotDID
        name: '卧室音箱',
        alias: '卧室的',
        miotDID: '222222',
        deviceID: 'dev-2',
        mac: 'aa-bb-cc-dd-ee-02',
        model: 'S12A',
        capability: getSpeakerCapability('S12A'),
        MiOT: {
          doAction: async (...args) => {
            calls.push(['卧室', ...args]);
            return true;
          },
        },
      },
    ];

    // 用名称 / 备注名 / miotDID / mac 都能命中同一台设备
    for (const key of ['客厅音箱', '客厅的', '111111', 'AA:BB:CC:DD:EE:01', 'aabbccddee01']) {
      assert.equal(MiService.getDevice(key)?.did, '客厅音箱', `按 ${key} 未命中`);
    }
    // 配置里填的是 miotDID，业务代码传设备名同样能路由过去
    assert.equal(MiService.getDevice('卧室音箱')?.did, '222222');
    // mac 分隔符/大小写不敏感
    assert.equal(MiService.getDevice('AA:BB:CC:DD:EE:02')?.did, '222222');
    // 未知标识不会误命中
    assert.equal(MiService.getDevice('不存在的音箱'), undefined);

    // 路由到名称对应的音箱，且用它的型号指令（S12A 走 [5, 1]）
    assert.equal(await MiGPT.say('你好', '卧室音箱'), true);
    assert.deepEqual(calls, [['卧室', 5, 1, '你好']]);
    assert.equal(await MiSpeaker.of('客厅的').play({ text: 'hi' }), true);
    assert.deepEqual(calls.at(-1), ['客厅', 5, 3, 'hi']);
  } finally {
    MiService.devices = original;
  }
});

test('normalizeSpeakerConfigs 去重时保留不同名称的音箱', () => {
  const configs = normalizeSpeakerConfigs({
    speaker: [
      { did: '客厅音箱' },
      { did: '客厅音箱 ' }, // 仅空格/大小写不同 → 视为重复
      { did: '小爱 音箱' }, // 名称本身带空格 → 不是重复
      { did: '小爱音箱' },
    ],
  });
  assert.deepEqual(
    configs.map((e) => e.did),
    ['客厅音箱', '小爱 音箱', '小爱音箱'],
  );
});
