# codex-pocket

手机上的 PWA，通过局域网直连 Mac 上桌面 Codex 的 app-server。扫码即登录，秒级重连。

## 现状

- [x] Stage 1：`packages/host` 直连桌面 Codex（`pnpm dev:host threads`）
- [x] Stage 2：局域网 HTTPS/WSS + 扫码配对 + 鉴权转发（`pnpm dev:host serve`）
- [x] Stage 3：PWA 线程列表 / 对话 / 流式
- [x] Stage 4：审批 / 中断 / 新建线程 / 模型切换
- [x] Stage 5：ACME 证书 + DNS 自动维护 + launchd 常驻
- [x] Stage 6：实时性与可见性（列表实时更新 / 计划与用量 / 错误提示 / 模型提问）
- [x] Stage 7：输入增强（图片附件 / turn/steer / @文件 / 技能）
- [ ] Stage 8：Web Push 通知（依赖 Stage 5 证书）
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

## 部署：HTTPS 域名 + 开机常驻

默认是明文 HTTP，手机上能用但没有推送通知等需要安全上下文的能力。要拿到无警告的 `https://`，需要一个托管在 Cloudflare 的域名：

1. 在 Cloudflare 创建 API Token，权限 `Zone:DNS:Edit`，只授权该 zone。
2. 保存设置（token 写入 `~/.codex-pocket/config.json`，权限 600）：

   ```bash
   pnpm dev:host tls setup --zone example.com --hostname mac.lan.example.com --email you@example.com --token <cloudflare-token>
   # 第一次建议先加 --staging 验证流程，成功后去掉再跑一次
   ```

3. 之后每次 `serve` 启动都会：
   - 把 `mac.lan.example.com` 的 A 记录指向当前局域网 IP，之后每分钟检查一次，换 Wi‑Fi 自动更新；
   - 通过 Let's Encrypt DNS-01 签发 `*.lan.example.com` 通配证书到 `certs/`，剩余不足 30 天时自动续期并热替换，不用重启。

   也可以手动触发：`pnpm dev:host tls issue`，查看状态：`pnpm dev:host tls status`。

4. 手机和 Mac 在同一局域网时，浏览器打开 `https://mac.lan.example.com:7333`。域名解析到内网 IP，流量不出局域网。不在 Cloudflare 的域名可以自己把 PEM 放到 `certs/fullchain.pem` 和 `certs/privkey.pem`，host 会直接使用。

开机常驻（launchd）：

```bash
pnpm build                                   # 生成 packages/host/dist 和 packages/web/dist
node packages/host/dist/cli.js install       # 写入 ~/Library/LaunchAgents/com.codex-pocket.host.plist 并启动
node packages/host/dist/cli.js uninstall     # 移除
```

日志在 `~/.codex-pocket/host.log`。代码更新后重新 `pnpm build`，再 `install` 一次即可重载。

## 出门在外

一期只做局域网。要在外网使用，最简单的办法是 Tailscale / WireGuard：Mac 和手机都加入同一 tailnet，`serve --host <tailnet IP>`（或不指定 `--host`，默认监听所有接口），`--public-host` 填 tailnet IP 或对应的 DNS 名即可。

构建 PWA 后 `serve` 会自动从 `packages/web/dist` 提供页面：

```bash
pnpm --filter @codex-pocket/web build
pnpm dev:host serve
```

## 已知约束

- Codex 的 app-server 对每个线程只允许一个 writer 连接。**桌面 Codex 正打开的线程在手机上会显示"已在桌面打开"**，在桌面关掉该线程的标签页后即可从手机继续。反过来，手机打开的线程在所有手机断开约 5 秒后自动释放给桌面。
- 目前是纯 HTTP（局域网内）。Stage 5 接入正式证书后才能作为 PWA 安装到主屏幕。

升级 Codex 后重新生成协议类型：

```bash
pnpm --filter @codex-pocket/protocol generate
```
