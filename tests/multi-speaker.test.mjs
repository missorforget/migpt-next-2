import assert from 'node:assert/strict';
import test from 'node:test';

import * as MessageModule from '../packages/next/dist/message.js';
import { MiService } from '../packages/next/dist/service.js';
import { MiSpeaker } from '../packages/next/dist/speaker.js';

function createDeviceServices(did, responses) {
  let index = 0;
  return {
    did,
    MiNA: {
      getConversations: async () => responses[Math.min(index++, responses.length - 1)],
      play: async ({ text, url }) => Boolean(text || url),
      stop: async () => true,
    },
    MiOT: {
      doAction: async () => true,
    },
  };
}

test('MiService keeps devices after init and falls back for single-speaker access', async () => {
  const original = MiService.devices;
  try {
    MiService.devices = [
      createDeviceServices('音箱A', []),
      createDeviceServices('音箱B', []),
    ];

    // 兼容旧版：MiNA / MiOT 返回第一个音箱
    assert.equal(MiService.MiNA, MiService.devices[0].MiNA);
    assert.equal(MiService.MiOT, MiService.devices[0].MiOT);
    // 按 did 路由
    assert.equal(MiService.getDevice('音箱B'), MiService.devices[1]);
    assert.equal(MiService.getDevice(), MiService.devices[0]);
  } finally {
    MiService.devices = original;
  }
});

test('SpeakerManager broadcasts play and abortXiaoAI to all speakers', async () => {
  const original = MiService.devices;
  try {
    const played = [];
    const stopped = [];
    MiService.devices = [
      {
        did: '音箱A',
        MiNA: {
          play: async ({ text }) => {
            played.push(['A', text]);
            return true;
          },
          stop: async () => {
            stopped.push('A');
            return true;
          },
        },
      },
      {
        did: '音箱B',
        MiNA: {
          play: async ({ text }) => {
            played.push(['B', text]);
            return true;
          },
          stop: async () => {
            stopped.push('B');
            return true;
          },
        },
      },
    ];

    assert.equal(await MiSpeaker.play({ text: '你好' }), true);
    assert.deepEqual(played, [
      ['A', '你好'],
      ['B', '你好'],
    ]);

    assert.equal(await MiSpeaker.abortXiaoAI(), true);
    assert.deepEqual(stopped, ['A', 'B']);
  } finally {
    MiService.devices = original;
  }
});

test('SpeakerManager routes of(did) to the requested speaker only', async () => {
  const original = MiService.devices;
  try {
    const played = [];
    MiService.devices = [
      {
        did: '音箱A',
        MiNA: {
          play: async ({ text }) => {
            played.push(['A', text]);
            return true;
          },
        },
      },
      {
        did: '音箱B',
        MiNA: {
          play: async ({ text }) => {
            played.push(['B', text]);
            return true;
          },
        },
      },
    ];

    const speakerB = MiSpeaker.of('音箱B');
    await speakerB.play({ text: '只对B说' });
    assert.deepEqual(played, [['B', '只对B说']]);

    // 未知的 did：不误播到其他音箱
    played.length = 0;
    await MiSpeaker.of('不存在的音箱').play({ text: 'nope' });
    assert.deepEqual(played, []);
  } finally {
    MiService.devices = original;
  }
});

test('message polling supports multiple speakers and tags messages with did', async () => {
  const answeredRecord = (requestId, time, query, text) => ({
    requestId,
    time,
    query,
    answers: [{ type: 'TTS', tts: { text } }],
  });

  const sourceA = createDeviceServices('音箱A', [
    { records: [answeredRecord('a-old', 1, 'A旧问题', '旧答案')] },
    { records: [answeredRecord('a-new', 5, 'A新问题', 'A答案')] },
  ]);
  const sourceB = createDeviceServices('音箱B', [
    { records: [answeredRecord('b-old', 2, 'B旧问题', '旧答案')] },
    { records: [answeredRecord('b-new', 6, 'B新问题', 'B答案'), answeredRecord('b-old', 2, 'B旧问题', '旧答案')] },
  ]);

  const manager = new MessageModule.MiMessageManager({
    sources: [
      { did: '音箱A', getConversations: (o) => sourceA.MiNA.getConversations(o) },
      { did: '音箱B', getConversations: (o) => sourceB.MiNA.getConversations(o) },
    ],
    sleep: async () => {},
  });

  // 第一轮：为每个数据源建立游标，不返回消息
  assert.equal(await manager.fetchNextMessage(), undefined);

  // A 音箱先来新消息，并打上 did 标记
  const msgA = await manager.fetchNextMessage();
  assert.equal(msgA.id, 'a-new');
  assert.equal(msgA.metadata.did, '音箱A');
  assert.equal(msgA.metadata.xiaoAIAnswer, 'A答案');

  // B 音箱的新消息随后被处理，同样带有来源标记
  const msgB = await manager.fetchNextMessage();
  assert.equal(msgB.id, 'b-new');
  assert.equal(msgB.metadata.did, '音箱B');
  assert.equal(msgB.metadata.xiaoAIAnswer, 'B答案');
});
