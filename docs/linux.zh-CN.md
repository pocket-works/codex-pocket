# Linux 服务器部署（实验性）

Codex Pocket v0.3.0 新增 Linux x86_64 无界面 host。压缩包包含 host、构建好的手机 PWA、启动脚本、systemd 用户服务与许可证。Node.js 和 Codex 需要单独安装；运行压缩包不需要 pnpm、Electron 或源码目录。

已在 Debian 13 x86_64、Node.js 22.23.3、Codex CLI 0.161.0 上，用 iPhone 主屏幕 PWA 验证配对、流式回复、通知与点击跳转、麦克风听写。自动和浏览器检查还覆盖文件、Git/worktree、审批、队列、历史、离线界面与重连。ARM64、其他发行版、Android 和 Linux 桌面应用尚未验证。听写使用未文档化的 ChatGPT 接口，iPhone 测试者反馈文字出现有延迟；本版没有解决这个延迟。

## 前置条件

- Linux x86_64、Node.js **22.12+**，以及已安装并登录的 Codex CLI，支持 `codex app-server daemon start`（已测 **0.161.0**）。
- bash、zsh、dash 或 sh 登录 shell。Pocket 通过交互式登录 shell 调用 Codex，继承 PATH、模型服务密钥和代理配置。按终端使用 Codex 的方式配置；必要时将 `CODEX_BIN` 设为 CLI 的绝对路径。
- 服务器可访问模型服务；通知和听写还需要访问对应推送服务及 ChatGPT 接口。听写需要 ChatGPT 登录态，可用 `codex-pocket config set outboundProxy <url>` 单独配置 HTTP 代理。
- 手机可访问服务器。主屏幕 PWA、通知和麦克风使用 HTTPS。下文采用两端 Tailscale，无需开放公网防火墙端口。

用平常运行 Codex 的非 root 账号运行 Pocket。不要将登录 token 放入压缩包或 service 配置。

## 安装与配置

从 [GitHub Releases](https://github.com/pocket-works/codex-pocket/releases) 下载 `codex-pocket-v0.3.0-linux-x64.tar.gz` 和对应 `.sha256`，在下载目录执行：

```bash
sha256sum -c codex-pocket-v0.3.0-linux-x64.tar.gz.sha256
mkdir -p "$HOME/.local/share/codex-pocket" "$HOME/.local/bin"
tar -xzf codex-pocket-v0.3.0-linux-x64.tar.gz -C "$HOME/.local/share/codex-pocket"
ln -sfn codex-pocket-v0.3.0-linux-x64 "$HOME/.local/share/codex-pocket/current"
ln -sfn "$HOME/.local/share/codex-pocket/current/bin/codex-pocket" "$HOME/.local/bin/codex-pocket"
```

将 `$HOME/.local/bin` 加入 shell PATH，然后检查 `node --version`、`codex --version`、`codex login status` 和 `codex app-server daemon start`。daemon 由 Codex 管理；Pocket 连接它的 Unix socket，不监督或停止它。

在 tailnet 启用 Tailscale MagicDNS 和 HTTPS 证书。将下例地址替换为服务器的 Tailscale DNS 名称：

```bash
codex-pocket config set bindHost 127.0.0.1
codex-pocket config set publicUrl https://server.example-tailnet.ts.net
sudo tailscale serve --bg --https=443 http://127.0.0.1:7333
codex-pocket serve --no-tls
```

host 在本机回环地址提供 HTTP，由 Tailscale 终止 HTTPS。Pocket 默认会检测 `~/.codex-pocket/certs/` 中的证书；上述代理方案保持该目录无证书，或在服务 `ExecStart` 加上 `--no-tls`。在手机打开 HTTPS `/api/health`，应显示 `ok: true` 与 `upstream: true`。

其他 HTTPS 反向代理需保留 `/ws` 的 WebSocket 升级（包括听写消息），并使用相同公开地址。可信局域网直连 HTTP 可用基本聊天，但缺少需要安全上下文的浏览器能力。

## 配对 iPhone

1. iPhone 连接 Tailscale，用 Safari 打开配置的 HTTPS 地址。
2. 选择**分享 → 添加到主屏幕**，从主屏幕启动 PWA。它与 Safari 使用独立存储。
3. 在服务器另一个终端运行 `codex-pocket pair`。在 PWA 内扫描二维码，或选择 **Enter code instead** 输入 10 分钟有效的配对码。不要公开配对码。
4. 发送消息。通知在 **Menu → Computers → 信息按钮 → Notifications** 开启并允许权限；任务完成前将应用切到后台。点击通知应进入对应会话。
5. 点击输入框旁的麦克风，允许权限并验证听写。

同一个主屏幕 PWA 可通过 **Add computer** 配对 Mac 和 Linux host。线程与文件位于所选电脑。桌面关联与菜单栏应用是 macOS 功能；Linux 使用手机不需要它们。

## systemd 用户服务

在具有运行中 systemd 用户管理器的机器上，先停止前台 Pocket host，再启用服务：

```bash
mkdir -p "$HOME/.config/systemd/user"
cp "$HOME/.local/share/codex-pocket/current/deploy/codex-pocket.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now codex-pocket
systemctl --user status codex-pocket
journalctl --user -u codex-pocket -f
```

服务从 `~/.local/bin`、`/usr/local/bin`、`/usr/bin` 或 `/bin` 查找 Node，使用 bash。如果用 nvm 等版本管理器，运行 `systemctl --user edit codex-pocket`，用绝对 Node 目录与默认 PATH 覆盖 `Environment="PATH=..."`；Codex 环境位于 zsh 配置时设 `Environment="SHELL=/bin/zsh"`。也可设 `Environment="CODEX_BIN=/absolute/path/to/codex"`。修改后执行 `systemctl --user daemon-reload` 并重启 Pocket。

需要开机启动并在退出登录后继续运行时，可由管理员执行 `sudo loginctl enable-linger "$USER"`。请在自己的机器重启后检查服务与手机重连。已验证 unit 语法和最小服务环境；测试主机采用 tini，未运行 systemd 管理器，因此尚未实测开机恢复。无 systemd 的容器可让既有进程管理器运行前台启动命令。

`KillMode=process` 只停止 Pocket。Codex 管理其 daemon 和 updater，Pocket 停止后它们可能继续运行。需要时用 Codex CLI 管理它们；重启 Pocket 应保留正在执行的 Codex 任务。

## 升级、回退与卸载

校验并解压新版本到旧版本旁，停止 Pocket，把 `current` 软链接指向新目录，再启动。systemd 示例：

```bash
systemctl --user stop codex-pocket
ln -sfn codex-pocket-v0.3.0-linux-x64 "$HOME/.local/share/codex-pocket/current"
systemctl --user start codex-pocket
```

替换成已安装的实际版本。回退时选择旧目录并重启。保留 `~/.codex-pocket/`（配对、VAPID、配置和上传）、`~/.codex/`（Codex 登录与历史）以及公开地址。在原始安装 host 可达时打开手机 PWA，刷新缓存界面；同一地址下 host 升级和重启保留配对 token。

卸载前在 host 运行时撤销手机（`codex-pocket devices`、`codex-pocket revoke <id>`），执行 `systemctl --user disable --now codex-pocket`，删除 unit、启动命令软链接与安装目录，并刷新 systemd。无需代理时只移除 Pocket 对应的 Tailscale Serve 映射。可选删除 `~/.codex-pocket/`，但会删除聊天引用的上传文件。Codex 本身及其数据单独管理。

## 源码构建

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:linux
pnpm package:linux:check # Linux x86_64；通过模拟 daemon 验证解压后的安装包
```

压缩包与校验文件输出到 `release/linux/`。`pnpm build` 还会构建 macOS 桌面应用，Linux 打包请用 `package:linux`。
