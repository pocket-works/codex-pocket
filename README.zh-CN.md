# codex-pocket

手机上的 PWA，经 Tailscale（或局域网）直连 Mac 上桌面 Codex 的 app-server。扫码即登录，秒级重连。

[English](./README.md)

## 功能

- 线程列表按桌面端真实项目分组（走 `project/list`）：在 Mac 上新建或删除项目，手机上立刻跟着变，不会残留一个旧文件夹冒充项目；对话流式输出、推理/工具调用折叠、Diff 视图
- 审批（含审批策略切换）、中断、`turn/steer`、服务端消息队列（`thread/queue/*`，与桌面端共享）、模型与推理强度、Fast 档
- 新建线程：项目 / 无项目 Chat、Work locally / New worktree、切换分支
- 图片附件、`@文件`、`/技能`、语音听写（经 host 流式转发到桌面端听写用的同一个 ChatGPT 语音后端，标识符和中英混说都能识别对）、模型提问弹层、计划与用量显示
- 线程改名 / 归档（左滑）/ fork / review
- 与 ChatGPT 桌面 app 共用同一个 app-server，手机和桌面看到同一份线程
- Web Push 通知：轮次完成、审批、提问、出错（iOS 需先添加到主屏幕）

## 安全模型

host 是一个**透明代理**：手机配对后拿到的是 Codex app-server 的全部能力，包括在 Mac 上执行命令和读写文件。安全边界只有两道——网络可达性和配对码——所以：

- 只通过 Tailscale（或局域网）访问，设置 `bindHost 127.0.0.1` 后端口不会暴露在局域网上；**不要**把它直接挂到公网（Cloudflare Tunnel、端口转发等）而不加额外认证。
- 配对码 8 位、10 分钟有效、猜错 5 次作废；设备 token 只存哈希，`revoke` 可随时吊销；管理接口只接受本机回环 + admin token。
- 听写复用 `~/.codex/auth.json` 里的 ChatGPT 登录，调的是未文档化的后端（`backend-api/dictation/stream`，即 Codex 桌面端听写按钮用的那个）。手机音频会发往 OpenAI，host 不落盘。OpenAI 一旦改动该接口，听写会失效，直到本项目跟进。host 是直连 chatgpt.com 的，不读 `HTTPS_PROXY`；如果这台 Mac 访问它需要代理，用 `config set outboundProxy http://127.0.0.1:1082` 指定。听写启动报 "did not answer session.start in time" 之类的错，多半就是这个原因。

## 运行：菜单栏应用

host 跑在 **Codex Pocket** 这个 macOS 菜单栏小应用里（`packages/desktop`）。打开应用就启动 host，退出应用就停掉 host，后台不会留下任何进程。菜单栏的圆点表示状态（灰=停止、黄=启动中、绿=运行、红=出错），菜单里能看到地址、Codex daemon 是否已连接、已配对的手机（可撤销），以及 **Pair a phone…**——弹窗显示二维码和手输码。

```bash
pnpm install
make app            # 生成 packages/desktop/release/mac-arm64/Codex Pocket.app
make open-app       # 或者把 .app 拖到 /Applications 再打开
```

应用内置了 host 和 PWA，不依赖系统 Node。未签名，第一次打开请右键 → 打开。Codex app-server 本身是官方 daemon（`codex app-server daemon start`），归 Codex 管，应用只显示它的连接状态，不会去停它。

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

常用操作都包在 `Makefile` 里（`make app`、`make start`、`make pair`、`make status`…），`make help` 查看列表。`pnpm --filter @codex-pocket/desktop dev` 从工作区直接跑菜单栏应用（会先把 host 从源码打包）；改了 host 代码后重新跑一次，或者 `pnpm --filter @codex-pocket/desktop bundle` 之后在菜单里点 **Restart host**。

状态目录 `~/.codex-pocket/`（`CODEX_POCKET_HOME` 可覆盖）：`devices.json`（token 哈希和推送订阅）、`admin.token`、`vapid.json`（Web Push 密钥对）、`runtime.json`、`config.json`、`certs/`、`uploads/`（手机发来的图片附件）、`host.log`。

## 部署：Tailscale HTTPS

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
5. 在 app 的设置页打开 **Notifications**。轮次完成、Codex 请求审批或提问、轮次失败时会推送——除非 app 正开着那个线程。

`pnpm dev:host config` 查看当前设置，`config unset <key>` 恢复默认。

不想用 Tailscale 时，把自己的 PEM 放到 `~/.codex-pocket/certs/fullchain.pem` 和 `certs/privkey.pem`，host 会直接以 HTTPS 监听；`--no-tls` 强制明文。只在局域网使用也可以完全不配 HTTPS（不设 `bindHost`，默认监听所有接口），直接开 `http://<局域网 IP>:7333`，只是没有推送通知等需要安全上下文的能力。

host 日志在 `~/.codex-pocket/host.log`，Codex daemon 日志在 `~/.codex/app-server-control/app-server.log`。

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
codex-pocket desktop        # 查看链接状态，以及 daemon 是否已经可以 link
```

`serve` 连接 Codex 官方 daemon（`codex app-server daemon start`，socket 在 `~/.codex/app-server-control/app-server-control.sock`），并把 `ws://127.0.0.1:7355` 转发到这个 socket 供桌面 App 使用。daemon 进程由 Codex 自己管理：按需启动、记录 pid、自动升级。host 通过你的交互式登录 shell 启动它（与桌面 App 走 SSH 时的做法一致），因此 daemon 拿到的 `PATH`、代理变量和模型服务 API key 与你终端里一致。桌面和手机最终在同一个进程里，桌面打开的线程在手机上可以直接继续，双方实时同步。`link-desktop` 会先检查 daemon 的 `account/read` 是否带 `workspaceRouting`：桌面 App 的所有后端请求（登录信息、听写）都要经过这个字段，缺了会静默失效——standalone 版 codex 0.155.1 就没有，而 ChatGPT.app 自带的那份已经有了。这个字段随 codex 0.156.0 发布（openai/codex#45529）；在 daemon 升到该版本之前该命令会拒绝执行（`--force` 可强制），桌面 App 继续用自己的私有 app-server。`codex-pocket desktop` 会做同样的检查，Codex 升级后跑一下就知道能不能 link。桌面 App 提供给 Codex 的工具（新建或转交线程、自动化等，即内置的 `codex_app` MCP）要通过一个 unix socket 连到 App：App 每次启动都会新开这个 socket，平时把路径交给它自己启动的 app-server。桌面挂到 daemon 后，host 用固定路径 `~/.codex-pocket/app-tools.sock` 启动 daemon，并根据 App 的日志让这个 symlink 始终指向正在运行的 App 的 socket；该 socket 要求对端是 OpenAI 签名的进程，所以 MCP 通过 App 自带的 node 运行。在此之前就已启动的 daemon 会由 `link-desktop` 重启一次（正在跑的对话会被打断）。`codex-pocket unlink-desktop` 可恢复桌面 App 的私有 app-server。`~/.codex-pocket/config.json` 里 `"codex": {"port": N}` 可改转发端口。

从曾经自带 `com.codex-pocket.shared-app-server` LaunchAgent 的旧版升级时，下一次 `serve` 会移除该 agent 并接管端口；请先等桌面上正在进行的轮次结束。

升级 Codex 后重新生成协议类型：

```bash
pnpm --filter @codex-pocket/protocol generate
```

## 许可

MIT。`packages/protocol/src/generated` 由 OpenAI Codex CLI（Apache-2.0）的 `codex app-server generate-ts` 生成，原样收录，见 [packages/protocol/NOTICE](./packages/protocol/NOTICE)。
