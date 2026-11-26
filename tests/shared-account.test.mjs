import assert from 'node:assert/strict';
import test from 'node:test';

import { MIoT, MiNA } from '../packages/miot/dist/index.js';
import {
  getSharedAccount,
  hasAccountCredentials,
  inheritSpeakerCredentials,
  normalizeSpeakerConfigs,
} from '../packages/next/dist/index.js';

const shared = { userId: '100000', password: 'secret' };

test('getSharedAccount 支持顶层 account / 平铺字段两种写法', () => {
  assert.deepEqual(getSharedAccount({ account: shared }), shared);
  assert.deepEqual(getSharedAccount({ userId: '100000', password: 'secret' }), shared);

  // 顶层 account 优先于平铺字段
  assert.deepEqual(
    getSharedAccount({ account: { passToken: 'top' }, userId: '100000', password: 'secret' }),
    { passToken: 'top' },
  );

  // 只写一半不算有效凭据
  assert.deepEqual(getSharedAccount({ userId: '100000' }), {});
  assert.equal(hasAccountCredentials({ userId: '100000' }), false);
  assert.equal(hasAccountCredentials({ passToken: 'pt' }), true);
  assert.equal(hasAccountCredentials(shared), true);
});

test('共用账号：顶层 account 自动继承给每台音箱，只需填 did', () => {
  const configs = normalizeSpeakerConfigs({
    account: shared,
    speaker: [{ did: '客厅音箱' }, { did: '卧室音箱' }],
  });
  const resolved = inheritSpeakerCredentials(configs, getSharedAccount({ account: shared }));

  assert.deepEqual(
    resolved.map((c) => c.did),
    ['客厅音箱', '卧室音箱'],
  );
  for (const config of resolved) {
    assert.equal(config.userId, '100000');
    assert.equal(config.password, 'secret');
  }
});

test('兼容旧写法：账号写在第一个音箱上，其余音箱自动继承', () => {
  const config = {
    speaker: [
      { did: '客厅音箱', ...shared },
      { did: '卧室音箱' },
      { did: '书房音箱' },
    ],
  };
  const resolved = inheritSpeakerCredentials(
    normalizeSpeakerConfigs(config),
    getSharedAccount(config),
  );

  assert.deepEqual(
    resolved.map((c) => [c.did, c.userId, c.password]),
    [
      ['客厅音箱', '100000', 'secret'],
      ['卧室音箱', '100000', 'secret'],
      ['书房音箱', '100000', 'secret'],
    ],
  );
});

test('每个音箱可单独使用不同账号，且半套凭据不会串账号', () => {
  const config = {
    account: shared,
    speaker: [
      { did: '客厅音箱' },
      { did: '卧室音箱', userId: '200000', password: 'other' },
      // 只写了 userId，缺 password：不能把顶层账号的 password 拼过来
      { did: '书房音箱', userId: '300000' },
    ],
  };
  const resolved = inheritSpeakerCredentials(
    normalizeSpeakerConfigs(config),
    getSharedAccount(config),
  );

  assert.deepEqual(resolved[0], { did: '客厅音箱', ...shared });
  assert.deepEqual(resolved[1], { did: '卧室音箱', userId: '200000', password: 'other' });
  assert.deepEqual(resolved[2], { did: '书房音箱', ...shared });
});

test('没有任何账号时保持原样（交给 .mi.json 登录缓存判断）', () => {
  const configs = normalizeSpeakerConfigs({ speaker: [{ did: 'A' }, { did: 'B' }] });
  const resolved = inheritSpeakerCredentials(configs, getSharedAccount({}));
  assert.deepEqual(resolved, [{ did: 'A' }, { did: 'B' }]);
});

test('共用账号时 did 未匹配会清掉 .mi.json 缓存的旧设备，避免串设备', async () => {
  const originalMiNA = MiNA.__callMiNA;
  const originalMIoT = MIoT.__callMIoT;
  try {
    MiNA.__callMiNA = async () => [
      {
        deviceID: 'dev-1',
        miotDID: '111',
        name: '客厅音箱',
        alias: '客厅的',
        mac: 'AA:BB:CC:DD:EE:01',
      },
    ];
    MIoT.__callMIoT = async () => ({
      list: [
        {
          did: '111',
          name: '客厅音箱',
          mac: 'AA:BB:CC:DD:EE:01',
          model: 'xiaomi.wifispeaker.lx06',
        },
      ],
    });

    // 模拟 .mi.json 里缓存了上一台音箱的 device
    const staleMiNA = await MiNA.getDevice({
      sid: 'micoapi',
      did: '不存在的音箱',
      device: { deviceID: 'dev-1', name: '客厅音箱' },
    });
    assert.equal(staleMiNA.device, undefined, 'MiNA 未清掉旧 device');

    const staleMIoT = await MIoT.getDevice({
      sid: 'xiaomiio',
      did: '不存在的音箱',
      device: { did: '111', name: '客厅音箱' },
    });
    assert.equal(staleMIoT.device, undefined, 'MIoT 未清掉旧 device');

    // 正常匹配时仍然能写入新设备（含备注名匹配）
    const matched = await MiNA.getDevice({ sid: 'micoapi', did: '客厅的' });
    assert.equal(matched.device.name, '客厅音箱');
    const matchedMIoT = await MIoT.getDevice({ sid: 'xiaomiio', did: '111' });
    assert.equal(matchedMIoT.device.did, '111');
  } finally {
    MiNA.__callMiNA = originalMiNA;
    MIoT.__callMIoT = originalMIoT;
  }
});
