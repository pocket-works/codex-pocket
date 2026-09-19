# codex-pocket

手机上的 PWA，经 Tailscale（或局域网）直连 Mac 上桌面 Codex 的 app-server。扫码即登录，秒级重连。

## 现状

- [x] Stage 1：`packages/host` 直连桌面 Codex（`pnpm dev:host threads`）
- [x] Stage 2：局域网 HTTPS/WSS + 扫码配对 + 鉴权转发（`pnpm dev:host serve`）
- [x] Stage 3：PWA 线程列表 / 对话 / 流式
- [x] Stage 4：审批 / 中断 / 新建线程 / 模型切换
- [x] Stage 5：HTTPS（`tailscale serve` 终止 TLS）+ launchd 常驻
- [x] Stage 6：实时性与可见性（列表实时更新 / 计划与用量 / 错误提示 / 模型提问）
- [x] Stage 7：输入增强（图片附件 / turn/steer / @文件 / 技能）
- [ ] Stage 8：Web Push 通知（依赖 HTTPS）
- [x] Stage 9：Diff 视图 / 线程管理 / 审批策略 / review

详见 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)。

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

状态目录 `~/.codex-pocket/`（`CODEX_POCKET_HOME` 可覆盖）：`devices.json`（只存 token 哈希）、`admin.token`、`runtime.json`、`config.json`、`certs/`、`uploads/`（手机发来的图片附件）、`host.log`（launchd 模式的日志）。

## 部署：Tailscale HTTPS + 开机常驻

host 本身只提供明文 HTTP；HTTPS 交给 `tailscale serve` 在前面终止，一个地址在家和在外都能用（同一局域网时 Tailscale 会走内网直连）：

1. Mac 和手机都安装 Tailscale 并登录同一账号；在 [管理控制台](https://login.tailscale.com/admin/dns) 打开 **HTTPS Certificates**（第一次跑 `tailscale serve` 时会给出启用链接）。
2. 在 Mac 上把 tailnet 名反代到 host，并告诉 host 手机应该用哪个地址（写入 `~/.codex-pocket/config.json`，之后 `serve` 启动自动带上）：

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:7333
   pnpm dev:host public-url set https://<mac>.<tailnet>.ts.net
   ```

3. `pnpm dev:host pair` 生成的二维码就指向 `https://<mac>.<tailnet>.ts.net/#pair=…`，手机（Tailscale 已连接）扫码即可；证书由 Tailscale 自动签发和续期。

不想用 Tailscale 时，把自己的 PEM 放到 `~/.codex-pocket/certs/fullchain.pem` 和 `certs/privkey.pem`，host 会直接以 HTTPS 监听；`--no-tls` 强制明文。只在局域网使用也可以完全不配 HTTPS，直接开 `http://<局域网 IP>:7333`，只是没有推送通知等需要安全上下文的能力。

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
- 目前是纯 HTTP（局域网内）。Stage 5 接入正式证书后才能作为 PWA 安装到主屏幕。

升级 Codex 后重新生成协议类型：

```bash
pnpm --filter @codex-pocket/protocol generate
```
