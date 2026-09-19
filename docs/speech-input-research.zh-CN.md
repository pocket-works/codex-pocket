# 语音输入方案调研（替代浏览器 Web Speech API）

日期：2026-09-19  分支：`claude/speech-recognition-research-0e10fb`

## 1. 现状

- 当前实现：[packages/web/src/state/dictation.ts](../packages/web/src/state/dictation.ts) 直接用 `window.SpeechRecognition / webkitSpeechRecognition`，没有服务端参与。
- 问题：识别质量差。iOS Safari 的 Web Speech 走的是老一代 `SFSpeechRecognizer`，`continuous` 支持不稳、静音即停、没有标点、中英混说效果差；Android Chrome 走 Google 云端，国内网络不稳定。
- 前提约束（来自 CLAUDE.md）：host 是"薄代理"，不建模聊天状态；但**转写是一个无状态的媒体处理动作**，放在 host 侧并不违反这条规则。

## 2. 官方 Codex 桌面端是怎么做的（解包 app.asar 对照）

桌面端有**两套**互不相关的语音功能：

| 功能 | i18n key | 实现 |
|---|---|---|
| Dictation（听写，填到 composer） | `codex.command.composer.startDictation` | `AudioWorklet`（`dictation-audio-worklet-*.js`，2048 采样一块的 Float32 PCM）→ 前端做增益归一化 → 转 pcm16 → `POST /codex/dictation-stream-connect-info` 拿 WebSocket 连接信息 → 推流，`session.start` 配置：`provider_mode: streaming_sse`、`server_vad`（threshold 0.5 / prefix 300ms / silence 500ms）、`max_utterance_duration_ms: 30000` → 收 `transcript.segment / transcript.final`（带 utterance_id + revision 做合并） |
| Voice chat（实时语音对话） | `codex.command.composer.startVoiceMode`、`realtimeVoice.*` | app-server 的 `thread/realtime/*`（见 §3.3） |

结论：**听写走的是 ChatGPT 私有后端**（`chatgpt.com/backend-api/codex/dictation-stream-connect-info`），不是公开 API，也没有经过 app-server。第三方复用它意味着拿 OAuth access_token 去打未文档化的接口，随时可能被改/被封，不建议作为主方案。

## 3. 候选方案

### 3.1 host 侧 Apple SpeechAnalyzer（macOS 26+，本地、免费、离线）★推荐主方案

- host 本来就跑在 Mac 上；本机是 macOS 26.6.2，Xcode Swift 6.3 可用。
- 已在本机实测 `SpeechTranscriber.supportedLocales`：
  `de_* en_* es_* fr_* it_* ja_JP ko_KR pt_* yue_CN zh_CN zh_HK zh_TW`
  → **简体中文、粤语、繁体都在**。目前只装了 `en_*` 资产，`zh_CN` 需要通过 `AssetInventory` 一次性下载（系统级、几百 MB）。
- 相比 WebKit 用的旧 `SFSpeechRecognizer`，SpeechAnalyzer 是 WWDC25 新模型：无 1 分钟时长限制、长文本更准、延迟更低、支持流式 volatile 结果。
- 实现形态：`packages/host/native/dictate.swift` 编一个几十行的 CLI（stdin 读 pcm16 → stdout 输出 JSON 行），host 用 `child_process` 拉起；或者常驻一个进程，按会话喂音频。安装时用 `swiftc` 编译（`make`），或仓库里放预编译二进制。
- 风险：
  1. 只支持 macOS 26+（host 依赖 ChatGPT.app 本来就已经是 Mac-only，可接受）。
  2. 真实中文质量需要 A/B 一次再定，因为用户抱怨的 iOS Safari 效果本质上也是 Apple 的老引擎。
  3. 首次需要下载语言资产，需要在 `codex-pocket setup` 里加一步或首次使用时提示。

### 3.2 host 侧 OpenAI 转写 API（需要 API key）

- 现有 `~/.codex/auth.json` 是 `auth_mode=chatgpt`，`OPENAI_API_KEY` 为空 → **必须另配一个 API key**，ChatGPT 订阅不能直接用。
- 模型：`gpt-transcribe`（2026-07 起推荐默认，$0.0045/min）、`gpt-4o-transcribe`（$0.006/min）、流式 `gpt-live-transcribe`（$0.017/min，`wss://api.openai.com/v1/realtime?intent=transcription`）。
- 质量最好、中英混说最稳，但要付费、要走外网。适合作为 **可选 provider**：host 配置 `dictation.provider = "openai"` + key 时启用。

### 3.3 Codex app-server `thread/realtime/*`（gpt-realtime）

- 已在 codex 二进制里确认方法：`thread/realtime/start | appendAudio | appendText | appendSpeech | stop | listVoices`，通知含 `transcript/delta`、`transcript/done`（role = user/assistant）。
- 走 ChatGPT 凭据，不需要 API key，且 host 只需透传 JSON-RPC，完全符合"薄代理"。
- **但它是完整的语音对话模式**：`ThreadRealtimeStartParams` 里没有"只转写不回复"的开关，`output_modality` 只是 text/audio；模型一定会回应并可能推进 thread。`appendSpeech` 是"让模型朗读一段文本"，不是语音输入。
- 结论：不适合做听写；可作为后续"Voice chat"功能（对齐桌面端）单独立项。

### 3.7 复用官方听写后端（ChatGPT 私有接口 + Codex OAuth token）★调研后升为首选

网上已有两个独立实现证明这条路是通的，且用的正是 `~/.codex/auth.json` 里的 token：

- [Wangnov/codex-asr](https://github.com/Wangnov/codex-asr)（Rust，54★，brew/crates 可装）：一次性上传 `POST https://chatgpt.com/backend-api/transcribe`（multipart `file` + 可选 `language`），返回 `{text}`。
- [FZR-forks/codex-asr PR #1](https://github.com/FZR-forks/codex-asr/pull/1)（2026-09-11）：流式桥接，作者标注"已对当前 ChatGPT 听写 WebSocket 做 24 kHz PCM16 端到端实测，delta 拼接与最终结果一致"。[lidge-jun/opencodex PR #4392](https://github.com/lidge-jun/opencodex/pull/4392) 也暴露了同一条流。

协议要点（来自上述源码 + 桌面端产物交叉核对）：

| 项 | 值 |
|---|---|
| 流式地址 | `wss://chatgpt.com/backend-api/dictation/stream`，子协议 `chatgpt-dictation`（服务端必须回同一个子协议）；桌面端多一步 `POST /codex/dictation-stream-connect-info`，第三方实现直接连也可以 |
| 请求头 | `Authorization: Bearer <access_token>`、`ChatGPT-Account-Id: <account_id>`、`originator: Codex Desktop`、`User-Agent` |
| 客户端→服务端 | `session.start`（`dictation_session_id`、`attempt_id`、`config`：`input_audio_format: pcm16`、`sample_rate_hz`、`num_channels: 1`、`max_utterance_duration_ms: 30000`、`session_ttl_ms: 300000`、`provider_mode: streaming_sse`、`transcript_delivery_mode: segment`、`vad: server_vad{0.5, 300ms, 500ms}`）→ `audio.append{audio: base64 pcm16}` → `audio.flush` / `audio.clear` → `session.close` |
| 服务端→客户端 | `session.started`、`speech.started/stopped{utterance_id}`、`transcript.segment{utterance_id, revision, text}`（**累积假设，可改写前文**）、`transcript.final{utterance_id, revision, text}`、`transcript.failed`、`session.error` |

限制与风险：
- 未文档化接口，随时可能改；要保留回退 provider。
- 单句最长 30 s，靠 server VAD 自动切句；`transcript.segment` 是整句累积文本，不是增量，UI 要按 utterance_id 合并。
- `access_token` 会过期，由 codex 自己刷新写回 `auth.json`；host 每次开会话前重读文件，401 时提示用户在 Codex 里重新登录。
- **2026-09-19 本机实测通过**（Node + `ws`，直连 `dictation/stream`，16 kHz pcm16，100 ms 一块按实时速度推）：`session.started` 后约 1 s 出第一段 `transcript.segment`，之后每 100–300 ms 一次累积修订；`speech.stopped` 后 ~400 ms 收到 `transcript.final`；`session.close` 后服务端回 `session.updated{status: closed}` + `asset.ready`（录音在服务端留 30 天）然后 1000 关闭。同一段合成音频的结果：
  > 帮我把 composer组件里的 useEffect改成 useMemo，然后把发送按钮的五个状态整理成一个枚举，另外，host那边的 WebSocket重连逻辑有个 bug，断网以后不会自动恢复，你先查一下 proxy目录下的代码，别急着改，先给我一个方案。

  英文标识符大小写、`枚举/组件/重连`、标点、`bug` 全部正确——远好于 SpeechAnalyzer（§6）。
- 服务端会每 ~100 ms 推一条 `session.updated`（带完整 config），客户端忽略即可；`transcript.delta` 只是元数据，以 `segment`/`final` 为准。

### 3.4 host 侧开源模型（whisper.cpp / sherpa-onnx）

- `whisper.cpp` large-v3-turbo + Metal：中文可用，但容易幻觉、缺标点、要下 1.6GB 模型、要 brew/编译依赖。
- `sherpa-onnx` + SenseVoice-small / Paraformer：中文准确率更好、有 node binding，但依赖体积大、维护成本高。
- 既然 macOS 26 自带 SpeechAnalyzer，这条路性价比不高，仅作为非 macOS-26 机器的备胎记录。

### 3.5 手机端本地（transformers.js Whisper / WebGPU）

iPhone Safari 内存与 WebGPU 限制大，冷启动要下模型，PWA 场景体验差。放弃。

### 3.6 什么都不做：用 iOS 键盘自带的听写键

任何 `<textarea>` 都能用，中文好。但它和 Web Speech 是同一引擎，而且无法做"按住说话→自动发送"这类产品体验。作为兜底提示即可。

## 4. 音频传输：手机 → host

统一用 **`AudioWorklet` 抓 PCM，在 worklet 里重采样到 16 kHz mono → Int16**，与官方桌面端一致：

- 不依赖 `MediaRecorder` 的容器差异（iOS 只出 `audio/mp4`，Android Chrome 只出 `webm/opus`，AVFoundation 解不了 webm）。
- 带宽 32 KB/s，可以走现有的 host WebSocket 通道（新增一类消息）或一个独立的 `POST /api/dictation`。
- 流式：每 ~100ms 一块推给 host，host 喂 SpeechAnalyzer，把 volatile/final 结果推回来，composer 实时更新——和现在 `onText(final + interim)` 的接口形态一致，`DictationButton` 基本不用改。

## 5. 推荐路线（2026-09-19 更新）

SpeechAnalyzer 已用合成音频实测（§6）：速度极快，但技术词同音错多、英文标识符被压扁，基本是 Siri 听写水平，不比现状好。因此主方案改为 **§3.7 复用官方听写后端**，质量等同桌面端。

1. **Spike**：本机用 `codex-asr`（或探测脚本）确认 token 能连上 `backend-api/transcribe` 与 `dictation/stream`。
2. **Stage 1**：host 加 `dictation` provider：手机 AudioWorklet → 16 kHz pcm16 → host WS → 上游 `dictation/stream`，`transcript.segment/final` 按 utterance 合并后回推；`DictationButton` 接口不变。
3. **Stage 2**：错误/过期处理（401 → 提示重新登录）、Settings 显示 provider 状态。
4. **回退**：`provider = openai`（自备 key，`gpt-transcribe`）与本机 SpeechAnalyzer（macOS 26）作为备选，Web Speech 作为最后兜底。

## 6. SpeechAnalyzer 实测（合成 TTS 音频，仅作参考）

- `zh_CN` 资产下载 11 s；20 s 音频转写 0.2–0.5 s。
- 纯中文：`侧边栏→侧编栏`、`用例→用力`、`边界→边借`，标点稀疏。
- 中英混说：`组件→组建`、`枚举→美举`、`重连→重联`，`useEffect→useffect`、`WebSocket→websocat`、`proxy→proxi`，`bug` 丢失。

## 参考

- 官方桌面端产物：`/Applications/ChatGPT.app/Contents/Resources/app.asar` → `webview/assets/app-initial-*.js`（搜 `dictation-stream-connect-info`）、`dictation-audio-worklet-*.js`
- codex 协议源码：`codex-rs/app-server-protocol/src/protocol/v2/realtime.rs`
- Apple：[SpeechTranscriber.supportedLocales](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportedlocales())、[SpeechAnalyzer vs SFSpeechRecognizer](https://blakecrosley.com/blog/speech-framework-vs-sfspeechrecognizer)、[iOS 26 SpeechAnalyzer live mic 示例](https://github.com/simplememofast/ios26-speechanalyzer-live-mic)
- OpenAI 定价：[Transcribe & Whisper API Pricing (Sep 2026)](https://costgoat.com/pricing/openai-transcription)、[gpt-transcribe 说明](https://gpt-transcribe.org/model/gpt-transcribe)、[gpt-realtime](https://openai.com/index/introducing-gpt-realtime/)
