# codex-pocket

手机上的 PWA，经 Tailscale（或局域网）直连 Mac 上桌面 Codex 的 app-server。扫码即登录，秒级重连。

[English](./README.md)

## 功能

- 线程列表按项目分组，实时跟随桌面端更新；对话流式输出、推理/工具调用折叠、Diff 视图
- 审批（含审批策略切换）、中断、`turn/steer`、模型与推理强度、Fast 档
- 新建线程：项目 / 无项目 Chat、Work locally / New worktree、切换分支
- 图片附件、`@文件`、`/技能`、模型提问弹层、计划与用量显示
- 线程改名 / 归档（左滑）/ fork / review
- 与 ChatGPT 桌面 app 共用同一个 app-server，手机和桌面看到同一份线程
- 待做：Web Push 通知

## 安全模型

host 是一个**透明代理**：手机配对后拿到的是 Codex app-server 的全部能力，包括在 Mac 上执行命令和读写文件。安全边界只有两道——网络可达性和配对码——所以：

- 只通过 Tailscale（或局域网）访问，设置 `bindHost 127.0.0.1` 后端口不会暴露在局域网上；**不要**把它直接挂到公网（Cloudflare Tunnel、端口转发等）而不加额外认证。
- 配对码 8 位、10 分钟有效、猜错 5 次作废；设备 token 只存哈希，`revoke` 可随时吊销；管理接口只接受本机回环 + admin token。

## 开发

```bash
pnpm install
pnpm test
pnpm dev:host info      # 连接信息
pnpm dev:host threads   # 桌面 Codex 的最近线程
pnpm dev:host serve     # 局域网服务，首次启动打印配对二维码
pnpm dev:host pair      # 再配一台手机
pnpm dev:host devices   # 已配对设备
pnpm dev:host revoke <id>
```

常用操作都包在 `Makefile` 里（`make start`、`make pair`、`make status`…），`make help` 查看列表。

状态目录 `~/.codex-pocket/`（`CODEX_POCKET_HOME` 可覆盖）：`devices.json`（只存 token 哈希）、`admin.token`、`runtime.json`、`config.json`、`certs/`、`uploads/`（手机发来的图片附件）、`host.log`（launchd 模式的日志）。

## 部署：Tailscale HTTPS + 开机常驻

host 本身只提供明文 HTTP；HTTPS 交给 `tailscale serve` 在前面终止，一个地址在家和在外都能用（同一局域网时 Tailscale 会走内网直连）：

1. Mac 和手机都安装 Tailscale 并登录同一账号；在 [管理控制台](https://login.tailscale.com/admin/dns) 打开 **HTTPS Certificates**（第一次跑 `tailscale serve` 时会给出启用链接）。
2. 在 Mac 上把 tailnet 名反代到 host，并告诉 host 手机应该用哪个地址（写入 `~/.codex-pocket/config.json`，之后 `serve` 启动自动带上）：

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:7333
   pnpm dev:host config set publicUrl https://<mac>.<tailnet>.ts.net
   pnpm dev:host config set bindHost 127.0.0.1   # 只监听回环：局域网里其他设备碰不到 7333
   ```

3. `pnpm dev:host pair` 生成的二维码就指向 `https://<mac>.<tailnet>.ts.net/#pair=…`，手机（Tailscale 已连接）扫码即可；证书由 Tailscale 自动签发和续期。
4. 想要全屏体验就在 Safari 里"添加到主屏幕"。注意 iOS 给主屏幕应用单独的存储，第一次打开会再要一次配对：在 Mac 上再跑 `pair`，在 app 里点"扫码"扫同一个二维码，或者输入它打印的 8 位码（形如 `ABCD-EFGH`）。

`pnpm dev:host config` 查看当前设置，`config unset <key>` 恢复默认。

不想用 Tailscale 时，把自己的 PEM 放到 `~/.codex-pocket/certs/fullchain.pem` 和 `certs/privkey.pem`，host 会直接以 HTTPS 监听；`--no-tls` 强制明文。只在局域网使用也可以完全不配 HTTPS（不设 `bindHost`，默认监听所有接口），直接开 `http://<局域网 IP>:7333`，只是没有推送通知等需要安全上下文的能力。

开机常驻（launchd）：

```bash
pnpm build                                   # 生成 packages/host/dist 和 packages/web/dist
node packages/host/dist/cli.js install       # 写入 ~/Library/LaunchAgents/com.codex-pocket.host.plist 并启动
node packages/host/dist/cli.js uninstall     # 移除
```

日志在 `~/.codex-pocket/host.log`。代码更新后重新 `pnpm build`，再 `install` 一次即可重载。

构建 PWA 后 `serve` 会自动从 `packages/web/dist` 提供页面：

```bash
pnpm --filter @codex-pocket/web build
pnpm dev:host serve
```

## 与桌面 Codex 共享线程（推荐）

Codex 的 writer 锁是跨进程的文件锁：桌面 ChatGPT App 默认自己 spawn 一个私有 `app-server`，手机连别的进程就打不开桌面正开着的线程。解决办法是让两边进同一个进程：

```bash
codex-pocket link-desktop   # 设置 CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:7355/，并安装登录时自动设置的 LaunchAgent
# 退出并重新打开 ChatGPT
codex-pocket desktop        # 查看链接状态
```

`serve` 会用桌面 App 自带的 codex 二进制启动（或复用）一个监听 `ws://127.0.0.1:7355` 的共享 app-server；桌面和手机都连它，桌面打开的线程在手机上可以直接继续，双方实时同步。`codex-pocket unlink-desktop` 可以恢复默认行为。`~/.codex-pocket/config.json` 里 `"codex": {"mode": "daemon"}` 可切回官方 daemon 模式（此时桌面正打开的线程会显示"已在桌面打开"）。

升级 Codex 后重新生成协议类型：

```bash
pnpm --filter @codex-pocket/protocol generate
```

## 许可

MIT。`packages/protocol/src/generated` 由 OpenAI Codex CLI（Apache-2.0）的 `codex app-server generate-ts` 生成，原样收录，见 [packages/protocol/NOTICE](./packages/protocol/NOTICE)。
