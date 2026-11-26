function isXiaoAIAnswerFailure(text) {
  return /(?:我(?:还|暂时|暂不|也)?(?:不知道|不知道咋说|不太清楚|不支持|不会|回答不上)|不太清楚|无法(?:回答|理解|获取|处理)|没法回答|回答不了|没听懂|不明白.{0,8}(?:说|意思)|换个问题|我还在学习|(?:你|我).{0,4}(?:问住|难住)了|被难住了(?:诶|呢|呀|哦)?|暂不支持(?:该|此)?功能|不知道咋说|还.{0,4}(?:支持.{0,6}功能|学习)|不如换.{0,6}(?:方式|问题|说)|超出.{0,6}(?:能力|范围)|(?:没有|无法)找到.{0,8}(?:答案|结果|内容)|(?:暂时|还)回答不)/i.test(
    text,
  );
}

/**
 * 让消息来源的音箱播报一段文字
 *
 * 优先走引擎的 say()：它会按音箱型号自动选择正确的 TTS 指令
 * （LX01 / S12A 是 [5, 1]，LX06/L09A/X08A/X08E/智能家庭屏 等是 [5, 3]），
 * 老版本引擎没有 say() 时，回退到该型号的 TTS 指令（再兜底 [5, 3]）。
 */
async function speak(engine, msg, text) {
  const did = msg.metadata?.did;
  if (typeof engine.say === 'function') {
    return engine.say(text, did);
  }
  const MiOT = typeof engine.getMiOT === 'function' ? engine.getMiOT(did) : engine.MiOT;
  const [siid, aiid] =
    (typeof engine.getSpeakerCapability === 'function'
      ? engine.getSpeakerCapability(did)?.ttsCommand
      : undefined) ?? [5, 3];
  return MiOT.doAction(siid, aiid, text);
}

/**
 * @type {import('@mi-gpt/next').MiGPTConfig}
 */
export default {
  debug: false, // 是否开启调试模式

  /**
   * 共享的小米账号：多个音箱共用一个账号时，只需在这里写一次，
   * 下面 speaker 数组里的每台音箱只填各自的 did 即可（userId / password 为可选项）。
   *
   * 也兼容旧写法：把账号写在数组里第一个音箱上，其余音箱会自动继承。
   * 如果某台音箱属于另一个小米账号，在它自己的配置里单独写账号即可覆盖。
   */
  account: {
    /**
     * 小米 ID（一串数字）
     *
     * 注意：不是手机号或邮箱，请在小米账号「个人信息」-「小米 ID」查看
     */
    userId: 'xiaomizhanghaoidxxxx',
    /**
     * 小米账号登录密码
     *
     * 如果提示登录失败，请改用 passToken 登录
     */
    password: 'xiaomizhanghaomimaxxxx',
    /**
     * （可选）小米账号 passToken，与 userId + password 二选一
     *
     * 获取教程：https://github.com/idootop/migpt-next/issues/4
     */
    // passToken: 'xiaomizhanghaopasstokenxxxx',
  },

  /**
   * 音箱配置（支持多音箱，兼容多个型号）
   *
   * 支持两种写法：
   * 1. speaker: { did, userId, password, ... }              单个音箱（兼容旧版）
   * 2. speaker: [{ did: '音箱A' }, { did: '音箱B' }]         多个音箱（不同型号可混搭）
   *    也可以写成 speakers: [{ ... }, { ... }]
   *
   * 共用一个小米账号时只需分别填写 did；每台音箱也能单独配置不同账号
   */
  speaker: [
    {
      /**
       * 音箱标识：可以填米家里的「设备名称」「备注名」「miotDID」或「mac 地址」，任选其一
       *
       * - 名称：'客厅音箱'（与米家里显示的完全一致，注意错别字/空格/大小写，
       *   比如「音响」和「音箱」不是一回事）
       * - miotDID：纯数字串，改名后也不会失效，多音箱时最稳
       * - mac：'AA:BB:CC:DD:EE:FF'（大小写、分隔符不敏感）
       *
       * ⚠️ 多音箱时每项必须能唯一区分：如果两台音箱名称相同，
       * 请改用各自的 miotDID 或 mac，否则会被当成同一台设备跳过。
       *
       * 找不到设备时，打开上面的 debug 选项，日志里会打印真实的 name / miotDID / mac。
       */
      did: '小爱音箱Play',
      /**
       * （可选）音箱型号，一般会自动识别，识别不到时可手动填写
       *
       * 不同型号的 TTS/唤醒指令不一样，内置对照表如下：
       * - LX01（小爱音箱）      TTS [5, 1]  唤醒 [5, 3]
       * - S12A（小爱音箱 二代） TTS [5, 1]  唤醒 [5, 3]
       * - LX06（小爱音箱 Pro）  TTS [5, 3]  唤醒 [5, 4]
       * - L09A（小爱音箱 Art）  TTS [5, 3]  唤醒 [5, 4]
       * - X08A（小爱音箱 Play） TTS [5, 3]  唤醒 [5, 5]
       * - X08E（小爱音箱 Play） TTS [5, 3]  唤醒 [5, 4]
       * - L05B / L05C / L06A / L07A   TTS [5, 3]  唤醒 [5, 4]
       * - 智能家庭屏系列        TTS [5, 3]  唤醒 [5, 4]
       *
       * 未收录的型号默认按 TTS [5, 3] / 唤醒 [5, 4] 处理
       */
      // model: 'LX06',
      /**
       * （可选）自定义指令，特殊固件需要时可以覆盖，格式：[siid, aiid]
       */
      // ttsCommand: [5, 3],
      // wakeUpCommand: [5, 4],
    },
    {
      // 第二个音箱（不同型号也可以），共用顶层 account，不需要重复写账号
      did: '小爱音箱Pro',
      // model: 'LX06', // 一般会自动识别，无需填写
      // 如果这台音箱属于另一个账号，在这里单独写即可覆盖顶层：
      // userId: '另一个小米ID', password: '另一个密码',
    },
  ],
  openai: {
    enableProxy: true,
    /**
     * 你的大模型服务提供商的接口地址
     *
     * 支持兼容 OpenAI 接口的大模型服务，比如：DeepSeek V3 等
     *
     * 注意：一般以 /v1 结尾，不包含 /chat/completions 部分
     * - ✅ https://api.openai.com/v1
     * - ❌ https://api.openai.com/v1/（最后多了一个 /
     * - ❌ https://api.openai.com/v1/chat/completions（不需要加 /chat/completions）
     */
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3', //这里是火山引擎 baseURL示例
    /**
     * API 密钥
     */
    apiKey: 'apikeyxxxxxxxxxxxxxxxxxxx',
    /**
     * 模型名称，注意这里填的是火山引擎的模型接入点，ep 开头
     */
    model: 'ep-202608xxxxxxxxx',
    /**
     * 按需联网：由模型判断当前问题是否需要搜索最新信息。
     */
    webSearch: {
      enabled: true,
      strategy: 'hybrid',
      fallbackNotice: '联网搜索暂时不可用，以下内容可能不是最新。',
    },
    /**
     * 扩展配置
     */
    extra: {
      /**
       * 请求超时时间（毫秒），默认 30 秒
       */
      requestOptions: {
        timeout: 60000,
      },
    },
  },
  prompt: {
    /**
     * 系统提示词，如需关闭可设置为：''（空字符串）
     */
    system: '你是一个智能助手，请用简洁的语言回答用户的问题，每次回答控制在150字以内。',
  },
  context: {
    /**
     * 每次对话携带的最大历史消息数（如需关闭可设置为：0）
     */
    historyMaxLength: 10,
  },
  /**
   * 流式响应配置
   */
  stream: {
    /**
     * 单次响应的最大长度（控制分句大小）
     * 小爱音箱 L05B 对 TTS 文本长度有限制，建议不超过 100
     */
    maxReplyLength: 100,
  },
  /**
   * 只回答以下关键词开头的消息：
   *
   * - 请问地球为什么是圆的？
   * - 你知道世界上跑的最快的动物是什么吗？
   */
  callAIKeywords: [''],
  /**
   * 自定义消息回复
   *
   * 多音箱场景：消息轮询会自动在 msg.metadata.did 标记消息来自哪个音箱，
   * 通过 engine.getSpeaker(msg) / engine.getMiOT(did) 可路由到对应的音箱
   */
  async onMessage(engine, msg) {
    if (!engine.config.callAIKeywords?.some((keyword) => msg.text.startsWith(keyword))) {
      return;
    }

    const xiaoAIAnswer =
      typeof msg.metadata?.xiaoAIAnswer === 'string' ? msg.metadata.xiaoAIAnswer.trim() : '';
    if (xiaoAIAnswer && !isXiaoAIAnswerFailure(xiaoAIAnswer)) {
      console.log(`🔈 保留小爱原生回答：${xiaoAIAnswer}`);
      return { handled: true };
    }
    if (xiaoAIAnswer) {
      console.log(`🤖 小爱无法回答，切换外接 LLM：${xiaoAIAnswer}`);
    }

    // 消息来源音箱（多音箱时路由到对应的音箱；找不到来源时保持兼容旧行为）
    const speaker = engine.getSpeaker ? engine.getSpeaker(msg) : engine.speaker;
    if (msg.metadata?.did) {
      console.log(`📢 来自音箱（${msg.metadata.did}）的消息：${msg.text}`);
    }

    // 不少型号的 MiNA TTS 无法稳定抢占小爱原生回复，改用 MIoT 的“播放文本”动作。
    const stopped = await speaker.abortXiaoAI();
    if (!stopped) {
      console.warn('⚠️ 未能确认已停止小爱原生播报，继续切换外接 LLM');
    }
    await speak(engine, msg, '正在思考中');

    const { text } = await engine.askAI(msg, { stream: false });
    if (text) {
      console.log(`🔊 ${text}`);
      await speak(engine, msg, text);
    }

    // 阻止引擎再走默认的 MiNA TTS 链路。
    return { handled: true };
  },
};
