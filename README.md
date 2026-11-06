# MiGPT-Next 增强版

让小爱音箱接上大模型（豆包、DeepSeek、ChatGPT 等都可以），让它更聪明。

> 基于 [MiGPT-Next](https://github.com/idootop/migpt-next) 二次开发。官方版已停止维护，本版新增了防抢话、联网搜索、保留小爱原生回答、网络代理、非流式问答等亮点。

## 它能做什么？

- ✅ 小爱能回答的问题，让小爱自己答（不打断）
- ✅ 小爱答不上来的，自动交给大模型（比如豆包）回答
- ✅ 问「今天天气」「最新新闻」这类实时问题，会自动联网搜索
- ✅ 可以自定义：比如听到「开灯」就去开你家的灯

## 快速开始（Docker）

Docker 可以把整个运行环境打包成「镜像」，你只需要装好 Docker，不用自己配置 Node.js 等环境，Windows / macOS / NAS 都能用同一套命令，最省心。

**第 1 步：安装 Docker**
- Windows / macOS：去官网下载安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)；
- NAS（飞牛、群晖等）：在系统自带的「Docker」或「Container Manager」应用中心里启用即可；
- 装好后在命令行输入 `docker -v`，能输出版本号就说明安装成功。

**第 2 步：下载本仓库代码**

```shell
git clone http://github.com/whBettering/migpt-next-2

cd migpt-next-2
```

> 不会用命令行？也可以直接在 GitHub 页面右上角 **Download ZIP** 下载后解压。

**第 3 步：修改配置 `config.js`**

在根目录打开 `config.js`，按注释把下面三处改成你自己的：

```js
export default {
  speaker: {
    userId: "你的小米ID（一串数字）",
    password: "你的小米密码",
    did: "小爱音箱在米家里显示的名字",
  },
  openai: {
    baseURL: "模型地址，例如 https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "你的 API Key",
    model: "模型名，例如豆包 ep-2026xxxxx",
  },
};
```

**第 4 步：构建镜像并运行**

在仓库根目录依次执行下面三条命令（首次使用需先执行第一、二条）：

```shell
pnpm install && pnpm build   # 首次使用：安装依赖、生成产物
docker build -f Dockerfile.local -t migpt-next:local .   # 打包成镜像
docker run -it --rm -v $(pwd)/config.js:/app/config.js migpt-next:local   # 运行
```

这几条命令在做什么（不理解可跳过）：
- `docker build ... -t migpt-next:local .`：把当前目录打包成一个名为 `migpt-next:local` 的镜像；
- `docker run ... -v $(pwd)/config.js:/app/config.js`：把外面的 `config.js` 映射进容器。这样以后改配置**不用重新打包**，改完重启即可。

**第 5 步：日常操作**
- 停止运行：在终端按 `Ctrl + C`；
- 改完配置后重跑：直接再执行第 4 步的 `docker run` 命令即可；
- 想 24 小时后台常驻：把 `docker run` 改成 `docker run -d --restart=always -v $(pwd)/config.js:/app/config.js migpt-next:local`（去掉 `-it --rm`，加 `-d --restart=always`），这样服务会在后台一直运行，设备重启后也会自动拉起。

## 多音箱 & 多型号

`speaker` 支持数组，一次接入多个音箱（不同型号可以混搭）：

```js
speaker: [
  { did: "客厅的小爱音箱", userId: "小米ID", password: "密码" },
  { did: "卧室的小爱音箱", userId: "小米ID", passToken: "passToken" },
],
```

- 单音箱继续用对象写法即可，完全兼容旧配置；
- 每个音箱的对话消息会被单独轮询，**谁被唤醒就在谁身上回答**，不会串音；
- 多个音箱共用一个小米账号时，只需分别填写各自的 `did`。

### `did` 可以填什么

`did` 会被拿去和设备的这些字段逐一比对，命中任意一个即可：

| 可填的值 | 举例 | 说明 |
| --- | --- | --- |
| 设备名称 | `客厅音箱` | 与米家里显示的名称完全一致（错别字、空格、大小写都算不同） |
| 备注名 / 别名 | `客厅的` | 仅 MiNA 侧支持 |
| miotDID | `123456789` | 纯数字，改设备名也不受影响，**多音箱首选** |
| mac 地址 | `AA:BB:CC:DD:EE:FF` | 大小写、`:` `-` 分隔符不敏感 |
| 设备 ID | `xxxxx` | MiNA 的 deviceID |

同时，`engine.say(text, did)` / `engine.wakeUp(did)` / `engine.getMiOT(did)` 的 `did` 参数也支持上面任意一种写法，所以配置里填了 `miotDID`，业务代码里传设备名同样能路由到正确的音箱。

⚠️ **多音箱时每项的 `did` 必须能唯一区分**。两台音箱在米家里同名（比如都叫「小爱音箱」）时，请分别改用 miotDID 或 mac，否则会被识别成同一台设备并跳过（启动日志会给出警告）。

不同型号的 MIoT 指令不一致，引擎会自动按型号适配，无需手动配置：

| 型号 | TTS 指令 | 唤醒指令 |
| --- | --- | --- |
| LX01（小爱音箱） | `[5, 1]` | `[5, 3]` |
| S12A（小爱音箱 第二代） | `[5, 1]` | `[5, 3]` |
| LX06（小爱音箱 Pro） | `[5, 3]` | `[5, 4]` |
| L09A（小爱音箱 Art） | `[5, 3]` | `[5, 4]` |
| X08A（小爱音箱 Play） | `[5, 3]` | `[5, 5]` |
| X08E（小爱音箱 Play） | `[5, 3]` | `[5, 4]` |
| L05B / L05C / L06A / L07A | `[5, 3]` | `[5, 4]` |
| X10A（智能家庭屏 10）/ 智能家庭屏系列 | `[5, 3]` | `[5, 4]` |

型号从设备信息里自动识别（`xiaomi.wifispeaker.lx06` → `LX06`，`xiaomi.wifispeaker.s12` → `S12A`）。如果识别不到或者固件特殊，也可以在配置里强制指定或覆盖：

```js
speaker: [
  {
    did: "客厅的小爱音箱",
    model: "LX01",            // 可选：手动指定型号
    ttsCommand: [5, 1],        // 可选：自定义 TTS 指令 [siid, aiid]
    wakeUpCommand: [5, 3],     // 可选：自定义唤醒指令 [siid, aiid]
  },
],
```

业务代码里想让音箱播报，用引擎封装好的方法即可（自动选对型号指令）：

```js
await engine.say("你好呀", msg.metadata?.did); // 播报文字
await engine.wakeUp(msg.metadata?.did);        // 唤醒音箱
```

> 💡 想让它联网回答实时问题？在 `config.js` 里把 `openai.webSearch.enabled` 设为 `true` 即可。

## 其他部署方式

**本项目以 Docker 部署为主**，Windows / macOS / Linux / NAS 通用。如果你不想用 Docker，也有以下方式：

- **飞牛 NAS（fnOS）**：飞牛自带「Docker」应用。把代码放进 NAS（比如 `/vol1/docker/migpt-next`），改好 `config.js`，然后在飞牛的 Docker 应用里「构建镜像 + 创建容器」即可（就是上面的命令，有图形界面）；也可以 SSH 到 NAS 终端直接执行命令。NAS 常开，正好适合让音箱服务 24 小时在线。
- **其他 NAS（群晖 / 威联通）**：思路一样，都是基于 Docker，用系统自带的 Docker / Container Manager 操作即可。
- **直接跑 Node.js**：本项目本质是 Node.js 应用。在有 Node 16+ 的机器上安装依赖并构建，再写一个入口脚本调用 `MiGPT.start(config)` 启动。适合熟悉 Node 的用户，新手不推荐。

## ✨ 本版增强亮点

相比migpt-next 原版，本仓库做了以下源码级增强：

### 1. 防抢话 + TTS 体验优化
官方版小爱常因等待 AI 回复超时而抢答「不知道」。本版从三处入手：
- **先占位再思考**：引擎调用 LLM 前，先让音箱播放「正在思考中」并等待 500ms，占住 TTS 通道；
- **真正打断**：`abortXiaoAI()` 由空实现改为调用 `MiNA.stop()`，实际停止小爱当前播放；
- **更快响应 + 串行处理**：消息轮询心跳降至 500ms，并新增处理锁保证消息串行，避免并发回复错乱。

### 2. 联网搜索（火山方舟 Responses API）
支持回答「今天天气」「最新新闻」等实时问题：
- **`hybrid` 策略**：本地正则先判断问题时效性（显式指令 / 时效词 / 当前年份 / 易变信息等），命中才触发搜索；`auto` 则每次交给模型判断；
- **失败自动降级**：搜索异常时回退普通模型补全，并在回答前拼接 `fallbackNotice` 提示；
- **TTS 清洗**：播放前移除 Markdown 链接、URL 与引用角标，避免音箱念出网址。

### 3. 保留小爱原生回答（兜底话术混合判断）
`extractNativeAnswer` 从对话记录中提取小爱已生成的回答（区分 TTS / LLM 两类），经 `metadata.xiaoAIAnswer` 透传给 `onMessage`——该字段**不会发送给大模型**。

内置**混合判断策略**：`config.js` 中用一套「兜底话术」正则（如「不知道」「没听懂」「我还在学习」「无法回答」等）先判断小爱这次的回答是否有效——
- 小爱**答得上来**：直接保留原生回答，不打断、不浪费模型调用；
- 小爱**答不上来**（命中兜底话术）：才切换大模型接管回答。

这样既省 Token，也避免「小爱明明能答、却硬被大模型抢答」的尴尬。

### 4. 网络代理支持
MiOT 请求自动读取 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`（含小写）环境变量，Docker 部署且宿主机需代理访问小米服务时开箱即用；同时 401 凭证失效会自动刷新并重试。

### 5. 非流式问答
`askAI(msg, { stream: false })` 走一次性补全而非流式输出——也是联网搜索生效的前提，配合 `onMessage` 可实现更稳定的单次问答。

## 本地构建

```shell
pnpm install
pnpm build
```

## 常见问题

**问：一直提示登录失败？**
答：小米账号触发了安全验证，改用 `passToken` 登录。
**问：小爱还是抢话？**
答：本版已大幅缓解（会先播「正在思考中」占位、再真正打断小爱）。
**问：控制台有 AI 回答，但音箱播的还是小爱自己的话？**
答：一般是 TTS 兼容问题，不同机型播放指令可能不同。按 `config.js` 里 `onMessage` 的注释调整播放方式即可。

## 免责声明

本项目仅供学习研究，与小米官方无关，请勿用于商业用途。继续使用即代表同意 [用户协议](agreement.md)。

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang)
