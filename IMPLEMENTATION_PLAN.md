# codex-pocket 实施计划

目标：手机上的 PWA 通过局域网直连 Mac 上桌面 Codex 的 app-server，扫码即登录，秒级重连。
一期只做局域网，不做中继；只接 Codex，adapter 接口预留给 Claude。

## Stage 1: 协议类型 + host 直连桌面 Codex
**Goal**: `packages/protocol` 提供 `codex app-server generate-ts` 生成的类型；`packages/host` 的 `CodexClient` 能连上 `~/.codex/app-server-control/app-server-control.sock`，完成 `initialize`，收发请求/通知/服务端请求；`pnpm dev:host threads` 打印桌面 Codex 的线程列表。
**Success Criteria**: CLI 能列出与桌面 Codex 一致的线程；桌面 Codex 未运行时自动 spawn `codex app-server --listen unix://` 并连上。
**Tests**: JSON-RPC 客户端对着进程内 ws 测试服务器验证请求响应关联、通知分发、服务端请求应答、断连时挂起请求被拒绝；socket 定位逻辑（存在/不存在/陈旧 socket）。
**Status**: Complete

## Stage 2: 局域网服务 + 扫码配对 + 鉴权转发
**Goal**: host 起 HTTPS/WSS，提供静态 PWA 与 `/ws` 端点；启动打印二维码（URL 含一次性配对码）；配对后签发设备 token 持久化在 `~/.codex-pocket/`；`/ws` 上做 token 校验，然后把 JSON-RPC 透明转发到 Codex（多手机端共享一条 Codex 连接，通知广播）。
**Success Criteria**: 未配对连接被拒；扫码后设备 token 持久生效；两台设备同时收到同一线程的流式通知。
**Tests**: 配对码一次性与过期；token 撤销；转发层的请求 id 重映射与广播。
**Status**: Complete

## Stage 3: PWA 基础：线程列表、打开线程、发送与流式回复
**Goal**: Vite + React PWA。配对页、线程列表（按更新时间）、线程详情（`thread/resume` + `thread/items/list` 回放历史，`item/agentMessage/delta` 流式渲染）、发送消息（`turn/start`）、断线自动重连并恢复订阅。
**Success Criteria**: 手机上能看到桌面 Codex 的线程并继续对话；断网重连 < 2 秒。
**Tests**: 协议事件归一化（delta 合并、item 生命周期）纯函数测试；store 的重连状态机。
**Status**: Complete

## Stage 4: 审批、中断、新建线程、模型/推理强度
**Goal**: 处理 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` 的弹窗；`turn/interrupt`；新建线程时从已有线程 cwd 去重列出目录选择；`model/list` 驱动模型与 effort 切换。
**Success Criteria**: 手机上能批准/拒绝桌面 Codex 的命令；能新建线程并被桌面 App 看到。
**Tests**: 审批请求到 UI 状态映射；cwd 去重排序。
**Status**: Complete

## Stage 5: 证书、DNS 与常驻
**Goal**: host 内置 ACME DNS-01（`acme-client`）签发 `*.lan.<域名>` 通配证书，域名商 API 适配器（Cloudflare 优先）自动维护 A 记录指向当前局域网 IP；证书 <30 天自动续期；launchd 常驻；README。
**Success Criteria**: 手机浏览器打开 `https://mac.lan.<域名>:<port>` 无证书警告；Mac 换网络后 URL 不变。
**Tests**: DNS 适配器的请求构造（mock HTTP）；证书到期判断；IP 变化检测。
**Status**: Not Started（暂缓，先用自签证书 + 手动启动）

**TODO**（恢复时按此拆分）：
- [ ] ACME DNS-01 签发 `*.lan.<域名>` 通配证书（`acme-client`）
- [ ] Cloudflare DNS 适配器：A 记录指向当前局域网 IP，IP 变化时自动更新
- [ ] 证书剩余 <30 天自动续期
- [ ] launchd 常驻（plist 生成 + `install` / `uninstall` 命令）
- [ ] README 补充部署与域名配置说明

---

二期目标：对齐 ChatGPT App 的 Codex 远程控制体验（差距分析见 2026-09-18 讨论）。连接方式仍是局域网/VPN，不做自建中继。Stage 6–9 按价值排序，6 和 7 不依赖 Stage 5，8 依赖 Stage 5 的证书部分。

## Stage 6: 实时性与可见性
**Goal**: 把 app-server 已有但 PWA 未接的通知接上，让手机端不再"静默"。线程列表订阅 `thread/started` / `thread/status/changed` / `thread/name/updated` / `thread/archived` 实时更新，不再依赖手动刷新；线程页接 `turn/plan/updated`（结构化待办）、`thread/tokenUsage/updated`（上下文占比）、`error` / `warning` / `model/rerouted`（顶部提示条）；`account/rateLimits/read` + `account/rateLimits/updated` 在列表页显示额度；新增 `item/tool/requestUserInput` 弹层，让模型的提问能在手机上回答；列表行显示 `ConversationGitInfo` 的分支名。
**Success Criteria**: 桌面新建/重命名线程 2 秒内出现在手机列表；模型提问时手机能作答且桌面同步收到；turn 出错时手机有可见提示。
**Tests**: reducer 对新增通知的归一化；列表 store 的增量更新（新增/改名/归档/去重）；requestUserInput 到 UI 状态映射。
**Status**: Not Started

## Stage 7: 输入增强
**Goal**: 输入框支持图片附件（相册/拍照 → `localImage` 或 base64 `image`，多张）；turn 进行中输入改为 `turn/steer`（追加指令而非新起 turn），并显示 `thread/queue/changed` 的排队状态；`@` 触发 `fuzzyFileSearch` 补全为 `mention`；`skills/list` 驱动 `/` 技能选择。
**Success Criteria**: 手机截图发给 Codex 并被正确识别；运行中追加一句指令能被当前 turn 采纳；`@` 能补全出项目内文件。
**Tests**: 输入内容到 `UserInput[]` 的组装（文本 + 图片 + mention 混排）；steer 与 start 的分流逻辑；fuzzy search 结果的防抖与取消。
**Status**: Not Started

## Stage 8: Web Push 通知
**Goal**: host 实现 Web Push（VAPID 密钥持久化在 `~/.codex-pocket/`，`web-push` 发送），订阅信息按设备存入 `devices.json`；在 `turn/completed`、三种 `requestApproval`、`item/tool/requestUserInput`、`error` 时推送，PWA 前台且正在看该线程时不推；`sw.js` 处理 `push` 与 `notificationclick`，点击跳到对应线程。依赖 Stage 5 的 HTTPS 证书（iOS 要求 HTTPS + 添加到主屏幕）。
**Success Criteria**: 手机锁屏状态下，桌面 Codex 需要审批时收到系统通知，点开直接进入审批弹层。
**Tests**: 推送触发规则（哪些通知、前台抑制、按设备去重）；订阅失效（410）时自动清理；VAPID 密钥的生成与复用。
**Status**: Not Started

## Stage 9: Diff、线程管理与审批策略
**Goal**: `fileChange` 支持展开查看 diff（`item/fileChange/patchUpdated` / `turn/diff/updated`，手机友好的按文件折叠视图）；线程重命名（`thread/name/set`）、归档（`thread/archive` / `thread/unarchive`）、fork（`thread/fork`）；新建线程支持目录浏览（`fs/readDirectory`）；审批弹层增加"本次会话一直允许"（`acceptForSession`）；线程页可切换审批策略/沙箱（`permissionProfile/list`）；`review/start` 入口。
**Success Criteria**: 手机上能看清一次改动的 diff 并批准；能整理线程列表；同类命令不用反复批准。
**Tests**: diff 解析与按文件分组；审批决策到响应体的映射；归档后列表过滤。
**Status**: Not Started

**外网可达（不设 Stage）**：一期在 README 里记录 Tailscale / WireGuard 方案，host `--host` 绑定 tailnet IP 即可；自建中继不在本计划内。
