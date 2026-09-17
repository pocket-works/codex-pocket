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
