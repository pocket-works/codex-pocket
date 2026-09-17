# codex-pocket

手机上的 PWA，通过局域网直连 Mac 上桌面 Codex 的 app-server。扫码即登录，秒级重连。

## 现状

- [x] Stage 1：`packages/host` 直连桌面 Codex（`pnpm dev:host threads`）
- [x] Stage 2：局域网 HTTPS/WSS + 扫码配对 + 鉴权转发（`pnpm dev:host serve`）
- [x] Stage 3：PWA 线程列表 / 对话 / 流式
- [x] Stage 4：审批 / 中断 / 新建线程 / 模型切换
- [ ] Stage 5：ACME 证书 + DNS 自动维护 + launchd 常驻（暂缓，TODO 见实施计划）
- [x] Stage 6：实时性与可见性（列表实时更新 / 计划与用量 / 错误提示 / 模型提问）
- [x] Stage 7：输入增强（图片附件 / turn/steer / @文件 / 技能）
- [ ] Stage 8：Web Push 通知（依赖 Stage 5 证书）
- [ ] Stage 9：Diff 视图 / 线程管理 / 审批策略 / review

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

状态目录 `~/.codex-pocket/`（`CODEX_POCKET_HOME` 可覆盖）：`devices.json`（只存 token 哈希）、`admin.token`、`runtime.json`、`certs/`、`uploads/`（手机发来的图片附件）。

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
