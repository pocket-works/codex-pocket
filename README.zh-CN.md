# codex-pocket

手机上的 PWA，经 Tailscale（或局域网）直连 Mac 上桌面 Codex 的 app-server。扫码即登录，秒级重连。

[English](./README.md)

## 功能

- 线程列表按桌面端真实项目分组（走 `project/list`）：在 Mac 上新建或删除项目，手机上立刻跟着变，不会残留一个旧文件夹冒充项目；对话流式输出、推理/工具调用折叠、Diff 视图
- 审批（含审批策略切换）、中断、`turn/steer`、服务端消息队列（`thread/queue/*`，与桌面端共享）、模型与推理强度、Fast 档
- 新建线程：项目 / 无项目 Chat、Work locally / New worktree、切换分支
- 图片和 CSV 附件、`@文件`、`/技能`、语音听写（经 host 流式转发到桌面端听写用的同一个 ChatGPT 语音后端，标识符和中英混说都能识别对）、模型提问弹层、计划与用量显示
- 线程改名 / 归档（左滑）/ fork / review
- 与 ChatGPT 桌面 app 共用同一个 app-server，手机和桌面看到同一份线程
- Web Push 通知：轮次完成、审批、提问、出错（iOS 需先添加到主屏幕）
- 一个主屏幕 PWA 管理多台电脑，凭据、草稿、置顶和通知订阅分别保存

## 产品截图

| 线程列表 | 对话 | 审批 |
| :---: | :---: | :---: |
| <img src="./docs/screenshots/threads.jpg" width="240" alt="手机上的 Chat 和项目线程列表"> | <img src="./docs/screenshots/conversation.jpg" width="240" alt="包含推理、命令和最终回复的对话"> | <img src="./docs/screenshots/approval.jpg" width="240" alt="手机上的命令审批弹层"> |

| 子代理入口 | 子代理列表 |
| :---: | :---: |
| <img src="./docs/screenshots/subagents-entry.png" width="240" alt="对话中的子代理状态入口"> | <img src="./docs/screenshots/subagents-panel.png" width="240" alt="对话中的进行中和已完成子代理列表"> |

| 图片预览 | 电脑设置 |
| :---: | :---: |
| <img src="./docs/screenshots/image-preview.png" width="240" alt="带下载和关闭操作的全屏图片预览"> | <img src="./docs/screenshots/computer-settings.png" width="240" alt="已连接电脑设置和此手机的通知偏好"> |

| 电脑切换 | 新建会话 |
| :---: | :---: |
| <img src="./docs/screenshots/computers.png" width="240" alt="显示两台已连接 Mac 和添加电脑操作的电脑列表"> | <img src="./docs/screenshots/new-thread.png" width="240" alt="包含项目、工作方式、分支和输入框的新建会话页"> |

截图由真实界面组件和虚构的对话、路径及电脑信息生成，不含个人线程内容或配对凭据。

## 环境要求

- **Apple 芯片的 Mac**：正式版 DMG 和本地构建的应用均面向 arm64。
- **这台 Mac 上的 Codex 已登录**：安装 DMG 时先安装并登录 ChatGPT 桌面 app，Pocket 可使用它内置的 Codex CLI；源码构建也可使用单独安装的 `codex` CLI。host 沿用 Codex 的登录态，不自行登录。
- **Node 22.12+ 和 pnpm 只用于源码构建**：DMG 已包含菜单栏应用、host 和 PWA，运行时不需要它们。
- **一台能连到这台 Mac 的手机**：走 Tailscale 或局域网。iOS 需要把 PWA 添加到主屏幕，Safari 标签页里收不到 Web Push。

## 快速开始

### 安装 DMG

1. 在 Apple 芯片的 Mac 上安装并登录 ChatGPT 桌面 app。
2. 从[最新版本](https://github.com/pocket-works/codex-pocket/releases/latest)下载已签名并公证的 Apple 芯片 DMG，打开后把 **Codex Pocket** 拖入 **Applications（应用程序）**，再从应用程序中启动。应用图标会出现在菜单栏。
3. 如果希望 iPhone 收到通知，先配置下文的 [Tailscale HTTPS](#部署tailscale-https)，再配对手机；否则让手机与 Mac 连接同一局域网即可。在 Pocket 菜单里选 **Pair a phone…**，用手机扫描二维码，或打开弹窗里的地址手动输入配对码。配对码 10 分钟后失效。
4. 在 Safari 中打开准备长期使用的 PWA 地址（需要通知时用 HTTPS 地址），选择**添加到主屏幕**。打开主屏幕 PWA 后，需要再次在 Pocket 菜单中配对，因为 iOS 为它使用独立的存储。需要 Web Push 时，打开 **Menu → Computers**，点击 Mac 旁的信息按钮进入详情，开启 **Notifications**。

要与 ChatGPT 桌面 app 共享正在使用的线程，在 Pocket 菜单中选 **Desktop sharing > Link desktop…**，然后退出并重新打开 ChatGPT。如果现有 Codex daemon 缺少桌面工具环境，关联时会重启它一次并中断正在进行的轮次。无需关联也能使用 Pocket，但由独立桌面 app-server 占用的线程无法在手机上取得写入权。

![Codex Pocket 手机配对页](./docs/screenshots/pairing.jpg)

### 从源码构建

在 Apple 芯片的 Mac 上登录 Codex，并安装 Node 22.12+ 与 pnpm 后运行：

```bash
pnpm install --frozen-lockfile
make app
make open-app
```

随后按上面的菜单步骤配对手机。`make app` 产出的是未签名的开发构建；正常安装请使用已签名、公证的正式版 DMG。旧版 v0.1.0 zip 未签名，v0.1.1 起的正式版改用 DMG。

当前构建面向 Apple 芯片 Mac。通过 `link-desktop` 与桌面 App 共享线程还要求 Codex daemon 的 `account/read` 响应带有 `workspaceRouting`（Codex CLI 0.156.0 或更新版本）；`codex-pocket desktop` 会检查这项能力。听写依赖未文档化的 ChatGPT 接口，接口变更后可能失效。

## 多台电脑

1. 在每台 Mac 上运行更新后的 Codex Pocket，并分别配置自己的 [Tailscale HTTPS](#部署tailscale-https) 地址。
2. 手机保留一个主屏幕 PWA，打开 **Menu → Computers**，选择 **Add computer**，在这个 PWA 内扫描另一台 Mac 的配对二维码。手动配对需要另一台 Mac 的 HTTPS 地址和配对码。
3. 在 **Computers** 中选择电脑即可切换。线程、项目、文件和任务属于各自的电脑。切换会保存草稿，不会停止正在运行的轮次；发送或上传过程中，要等待操作完成后才能切换。
4. 点击电脑旁的信息按钮进入管理页。**Computer** 包含可编辑的名称和地址，**This phone** 包含通知偏好和 **Pairing details** 入口。配对详情是独立页面，显示手机名称、配对时间、配对 ID 和 **Pair again**；需要恢复访问时，电脑管理主页也会显示 **Pair again**。**Unpair computer** 单独放在主页内容末尾。从这两个页面返回都会恢复聊天或草稿。电脑可达时，解除配对会撤销这部手机的权限，不会删除 Mac 上的聊天；**Remove locally** 只删除手机上的凭据，需要稍后在 Mac 上撤销旧配对。**Menu → About** 显示手机应用版本。

主屏幕 PWA 保持原来的安装地址。应用资源缓存完成后，即使入口 Mac 暂时不可达，也能打开应用并连接其他 Mac。首次安装、更新和注册新的通知 worker 仍需要入口地址可达。每台电脑使用独立作用域的 Web Push 订阅，点击通知会选择对应电脑和线程。多台电脑同时向主屏幕 iPhone PWA 推送，仍需实机验证。

升级会迁移当前 PWA 地址下已有的配对和本地数据。不同浏览器地址或主屏幕应用的存储无法自动导入，需要在保留的 PWA 中重新添加那些 Mac。电脑地址变更需要重新配对，旧 token 不会发送到修改后的地址。

## 安全模型

host 是一个**透明代理**：手机配对后拿到的是 Codex app-server 的全部能力，包括在 Mac 上执行命令和读写文件。安全边界只有两道——网络可达性和配对码——所以：

- 只通过 Tailscale（或局域网）访问，设置 `bindHost 127.0.0.1` 后端口不会暴露在局域网上；**不要**把它直接挂到公网（Cloudflare Tunnel、端口转发等）而不加额外认证。
- 配对码 8 位、10 分钟有效、猜错 5 次作废；设备 token 只存哈希，`revoke` 可随时吊销；管理接口只接受本机回环 + admin token。
- 浏览器配对绑定 PWA 来源地址。手机 API 的跨域访问同时校验对应配对的 token 和来源，管理接口不开放跨域访问；手机为每台电脑分别保存 token。
- 听写复用 `~/.codex/auth.json` 里的 ChatGPT 登录，调的是未文档化的后端（`backend-api/dictation/stream`，即 Codex 桌面端听写按钮用的那个）。手机音频会发往 OpenAI，host 不落盘。OpenAI 一旦改动该接口，听写会失效，直到本项目跟进。host 是直连 chatgpt.com 的，不读 `HTTPS_PROXY`；如果这台 Mac 访问它需要代理，用 `config set outboundProxy http://127.0.0.1:1082` 指定。听写启动报 "did not answer session.start in time" 之类的错，多半就是这个原因。

## 运行：菜单栏应用

host 跑在 **Codex Pocket** 这个 macOS 菜单栏小应用里（`packages/desktop`）。打开应用就启动 host，退出应用就停掉 host；如果已关联桌面应用，独立的本地转发服务会继续运行，直到执行 `unlink-desktop`。菜单栏的圆点表示状态（灰=停止、黄=启动中、绿=运行、红=出错），菜单里能看到地址、Codex daemon 是否已连接、已配对的手机（可撤销），以及 **Pair a phone…**——弹窗显示二维码和手输码。勾选 **Keep this Mac awake** 后，host 运行期间 Mac 不会因闲置而睡眠，手机随时能发起任务、跑着的任务也不会被打断（屏幕照常熄灭；电池供电时合盖仍会睡眠）。这个选项保存在 `~/.codex-pocket/desktop.json`。

`make app` 会生成 `packages/desktop/release/mac-arm64/Codex Pocket.app`，也可以把它拖到 `/Applications`。应用内置了 host 和 PWA，不依赖系统 Node。Codex app-server 本身是官方 daemon（`codex app-server daemon start`），归 Codex 管，应用只显示它的连接状态，不会去停它。

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

参与贡献请先看 [CONTRIBUTING.md](./CONTRIBUTING.md)；各包职责与代码约定见 [AGENTS.md](./AGENTS.md)。
维护者的 macOS 手动打包与发版检查见 [docs/releasing.md](./docs/releasing.md)。

状态目录 `~/.codex-pocket/`（`CODEX_POCKET_HOME` 可覆盖）：`devices.json`（token 哈希和推送订阅）、`admin.token`、`vapid.json`（Web Push 密钥对）、`runtime.json`、`config.json`、`certs/`、`uploads/`（手机发来的图片和 CSV 附件，每次上传最大 10 MB）、`host.log`；关联桌面后还有 `desktop-bridge.log`。

## 部署：Tailscale HTTPS

host 本身只提供明文 HTTP；HTTPS 交给 `tailscale serve` 在前面终止，一个地址在家和在外都能用（同一局域网时 Tailscale 会走内网直连）：

1. Mac 和手机都安装 Tailscale 并登录同一账号；在 [管理控制台](https://login.tailscale.com/admin/dns) 打开 **HTTPS Certificates**（第一次跑 `tailscale serve` 时会给出启用链接）。
2. 在 Mac 上把 tailnet 名反代到 host：

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:7333
   ```

   如果安装的是 DMG，在 `~/.codex-pocket/config.json` 中添加以下字段（保留原有字段），把示例 tailnet 名换成自己的，然后退出并重新打开 Pocket：

   ```json
   {
     "publicUrl": "https://<mac>.<tailnet>.ts.net",
     "bindHost": "127.0.0.1"
   }
   ```

   如果从源码构建，可运行下面的等效 CLI 命令，把示例 tailnet 名换成自己的；之后需要重启 host（使用 `make start` 启动的可运行 `make restart`）：

   ```bash
   pnpm dev:host config set publicUrl "https://<mac>.<tailnet>.ts.net"
   pnpm dev:host config set bindHost 127.0.0.1   # 只监听回环：局域网里其他设备碰不到 7333
   ```

3. 在 Pocket 菜单中选 **Pair a phone…**，二维码会指向 `https://<mac>.<tailnet>.ts.net/#pair=…`。手机连接 Tailscale 后扫码即可。源码构建的用户也可运行 `pnpm dev:host pair`。证书由 Tailscale 自动签发和续期。
4. 想要全屏体验就在 Safari 里“添加到主屏幕”。主屏幕 PWA 需要独立配对：再次选择 **Pair a phone…**，在 PWA 内扫码或输入 8 位配对码。
5. 打开 **Menu → Computers**，进入 Mac 的详情并开启 **Notifications**。轮次完成、Codex 请求审批或提问、轮次失败时会推送——除非 app 正开着那个线程。

源码构建可用 `pnpm dev:host config` 查看当前设置、`config unset <key>` 恢复默认；DMG 安装可编辑 `~/.codex-pocket/config.json`，重启 Pocket 后生效。

不想用 Tailscale 时，把自己的 PEM 放到 `~/.codex-pocket/certs/fullchain.pem` 和 `certs/privkey.pem`，host 会直接以 HTTPS 监听；`--no-tls` 强制明文。只在局域网使用也可以完全不配 HTTPS（不设 `bindHost`，默认监听所有接口），直接开 `http://<局域网 IP>:7333`，只是没有推送通知和离线启动等需要安全上下文的能力。

在 host 运行时打开 HTTPS PWA，等待应用资源完成缓存后，即使 Mac 上的 Pocket 已停止或无法连接，手机也能打开界面，显示连接提示，并在 host 恢复后自动重连。更新 Pocket 后，需要在 host 运行时打开一次手机应用，以刷新离线缓存。尚未缓存资源的首次访问仍需要 host 在线。

host 日志在 `~/.codex-pocket/host.log`，Codex daemon 日志在 `~/.codex/app-server-control/app-server.log`。

构建 PWA 后 `serve` 会自动从 `packages/web/dist` 提供页面：

```bash
pnpm --filter @codex-pocket/web build
pnpm dev:host serve
```

## 与桌面 Codex 共享线程（推荐）

Codex 的 writer 锁是跨进程的文件锁：桌面 ChatGPT App 默认自己 spawn 一个私有 `app-server`，手机连别的进程就打不开桌面正开着的线程。解决办法是让两边进同一个进程：

```bash
codex-pocket link-desktop   # 启动独立的本地转发服务，再让 ChatGPT 连接它
# 退出并重新打开 ChatGPT
codex-pocket desktop        # 查看链接状态，以及 daemon 是否已经可以 link
```

`serve` 连接 Codex 官方 daemon（`codex app-server daemon start`，socket 在 `~/.codex/app-server-control/app-server-control.sock`）。未设置 `CODEX_BIN` 且已安装 ChatGPT 时，Pocket 使用 ChatGPT 内置的 CLI；否则使用 shell 的 `PATH` 中的 CLI。`link-desktop` 会安装用户级 LaunchAgent，把 `ws://127.0.0.1:7355` 转发到该 socket。转发服务使用 Pocket 内置的 Electron 运行时，先验证能通过入口连接 app-server，再设置桌面 App 的 `CODEX_APP_SERVER_WS_URL`；`link-desktop` 会等待服务就绪。首次关联时不必先打开 Pocket。退出 Pocket 后转发服务仍在；执行 `unlink-desktop` 才移除它。daemon 进程始终由 Codex 自己管理。桌面和手机最终在同一个 daemon 中，桌面打开的线程在手机上可以直接继续，双方实时同步。转发服务通过交互式登录 shell 启动 Codex，因此 daemon 拿到的 `PATH`、代理变量和模型服务 API key 与终端里一致。`link-desktop` 会先检查 daemon 的 `account/read` 是否带 `workspaceRouting`：桌面 App 的所有后端请求（登录信息、听写）都要经过这个字段，缺了会静默失效——standalone 版 codex 0.155.1 就没有，而 ChatGPT.app 自带的那份已经有了。这个字段随 codex 0.156.0 发布（openai/codex#45529）；在 daemon 升到该版本之前该命令会拒绝执行（`--force` 可强制），桌面 App 继续用自己的私有 app-server。`codex-pocket desktop` 会做同样的检查，Codex 升级后跑一下就知道能不能 link。桌面 App 提供给 Codex 的工具（新建或转交线程、自动化等，即内置的 `codex_app` MCP）要通过一个 unix socket 连到 App：App 每次启动都会新开这个 socket。转发服务让 `~/.codex-pocket/app-tools.sock` 始终指向正在运行的 App 的 socket；该 socket 要求对端是 OpenAI 签名的进程，所以 MCP 通过 App 自带的 node 运行。此前已启动的 daemon 可能由 `link-desktop` 重启一次（正在跑的对话会被打断）。执行 `codex-pocket unlink-desktop` 后，重启 ChatGPT 即可恢复它的私有 app-server。`~/.codex-pocket/config.json` 里 `"codex": {"port": N}` 可改转发端口，改后须重新执行 `link-desktop`。

从曾经自带 `com.codex-pocket.shared-app-server` LaunchAgent 的旧版升级时，`link-desktop` 会先移除旧 agent，再安装转发服务；请先等桌面上正在进行的轮次结束。
从 host 托管转发入口的版本升级时，请重启 Pocket，并重新运行 `link-desktop` 安装独立转发服务，然后再退出 Pocket。

升级 Codex 后重新生成协议类型：

```bash
pnpm --filter @codex-pocket/protocol generate
```

## 版本发布

带版本号的 macOS 构建可从 [GitHub Releases](https://github.com/pocket-works/codex-pocket/releases) 下载。所有工作区包共用同一个语义化版本号，变更记录见 [CHANGELOG.md](./CHANGELOG.md)。推送 `v<版本号>` tag 并通过 CI 后会创建 Release 草稿；维护者在本机完成 DMG 的签名、公证和验证，再上传并发布。具体步骤见[发版流程](./docs/releasing.md)。

## 许可

MIT。`packages/protocol/src/generated` 由 OpenAI Codex CLI（Apache-2.0）的 `codex app-server generate-ts` 生成，原样收录，见 [packages/protocol/NOTICE](./packages/protocol/NOTICE)。
