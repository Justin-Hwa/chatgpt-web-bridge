# Microsoft 365 Copilot 本地代码仓库版

本版本让 Microsoft 365 Copilot 网页中的专用 **Local Repo Bridge Agent** 读取你指定的本地代码仓库、修改 UTF-8 文本文件，并执行受支持的 Git 操作。它使用你登录的 Microsoft 365 Copilot 来理解任务，不需要 OpenAI API Key，也不需要额外运行 Codex。

原项目是“本地 Codex/OMP 向 ChatGPT 网页咨询”的委派工具，不能只把 ChatGPT 网址改成 Copilot 就获得本地读写能力。本版本保留原工具，在 `copilot/` 中新增本地执行服务和微软原生 Agent 打包器。

## 接入方式与前提

`Copilot 网页中的 Agent → 微软 API plugin → HTTPS 隧道 → 本机 Node 服务 → 配置的本地仓库`

- 目标是组织账号的 **Microsoft 365 Copilot**，入口为 <https://m365.cloud.microsoft/chat>。单凭“高级版”字样不能判断账号是否允许安装；消费者 Copilot / Copilot Pro 网页不属于本指南已实现的接入目标。
- 你的组织需要允许上传和使用自定义应用。已有付费 Copilot 许可证不等于自动拥有此权限；缺少上传入口时由 Microsoft 365 / Teams 管理员开启。
- 本机需要 Node.js 24 或更新的受支持版本、Git，以及 Microsoft `devtunnel` CLI。Copilot 这一部分只使用 Node 内置模块，**不需要 npm install**。
- 微软云端必须能够通过 HTTPS 访问服务；仅填写 `localhost`、局域网 IP 或 VPN 内地址无效。隧道和本机服务都必须保持运行。
- 这是 API plugin（OpenAPI）方案。选择此方式是因为微软明确支持 API plugin 使用托管的 API Key；declarative agent 的 MCP action 不支持这种 API Key 认证。它没有使用 OAuth 动态注册，所以不涉及 OAuth `redirect_uri` 白名单。

实现和自动化测试不等于租户验收。本版本提供可上传的包生成器；**尚未在你的 Microsoft 365 租户内实际安装并完成 Copilot 端到端测试**。安装后按本文验收步骤确认。

## 1. 下载代码

在 Windows PowerShell 中选择一个开发目录执行：

```powershell
git clone --branch feature/copilot-local-bridge https://github.com/Justin-Hwa/chatgpt-web-bridge.git chatgpt-web-bridge-copilot
Set-Location .\chatgpt-web-bridge-copilot
node --version
git --version
node copilot/cli.mjs help
```

这会创建单独的下载目录。目标业务仓库仍使用你原有的本地目录，不需要复制进 bridge 项目。

## 2. 初始化并配置允许访问的仓库

```powershell
node copilot/cli.mjs init --config copilot.local.json
notepad .\copilot.local.json
```

初始化会生成随机 `apiKey` 和固定 `appId`。已有文件不会被覆盖。保留它们，只修改 `repositories` 中的目录和权限，例如：

```json
{
  "port": 3210,
  "appId": "保留初始化时生成的 UUID",
  "apiKey": "保留初始化时生成的随机密钥",
  "repositories": [
    {
      "id": "smtb-cust",
      "path": "C:/work/WorkSpace/SMTB/SMTB_CUST",
      "allowWrite": true,
      "allowGitWrite": true,
      "allowPush": false,
      "protectedBranches": ["main", "master", "release", "release2"]
    }
  ]
}
```

上面是配置说明，不能把中文占位文字替换掉真实生成值。JSON 路径建议使用 `/`，避免 Windows 反斜杠转义问题。

按相同结构添加 BANK、COMMON 或其他仓库即可。每个 `id` 必须唯一，`path` 必须指向已有 Git 仓库的工作树根目录；不能指向仓库子目录或把同一根目录重复配置。权限含义：

| 配置 | 作用 |
| --- | --- |
| `allowWrite` | 允许编辑仓库内的普通 UTF-8 文本文件 |
| `allowGitWrite` | 允许 fetch、pull、切换/创建分支、暂存、提交等已实现的 Git 操作 |
| `allowPush` | 额外允许推送；默认关闭。需要推送时先开启并重启服务 |
| `protectedBranches` | 阻止在列出的分支上执行暂存、提交和推送；不等于禁止查看该分支文件 |

`copilot.local.json` 含访问密钥，不要提交到 Git、上传给 Copilot 或发到聊天中。生成的微软应用 ZIP 不含此文件和密钥。配置文件必须放在所有开放仓库之外；若你也要开放 bridge 项目本身，请将配置移至该项目以外，并在 serve/doctor 中使用其绝对路径。服务会拒绝把实际配置文件所在的仓库开放出去，不受配置文件名影响。

## 3. 启动与检查本机服务

在第一个 PowerShell 窗口运行并保持打开：

```powershell
node copilot/cli.mjs serve --config copilot.local.json
```

在第二个 PowerShell 窗口进入相同 bridge 目录，执行：

```powershell
node copilot/cli.mjs doctor --config copilot.local.json
```

预期看到 `/healthz` 和 `/api/repositories` 返回成功。doctor 在本机读取密钥，不会打印密钥。

服务只监听 `127.0.0.1:3210`。如果端口已被其他程序使用，修改配置中的 `port`，随后所有隧道端口也使用同一值。

## 4. 创建固定 HTTPS 隧道

先按微软官方说明安装 [devtunnel CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started)。在第二个 PowerShell 窗口执行：

```powershell
devtunnel user login
devtunnel create --allow-anonymous
devtunnel port create --port-number 3210 --protocol http
devtunnel host
```

记录创建的 tunnel ID，以及输出的 **Connect via browser** HTTPS URL，例如 `https://你的隧道主机.devtunnels.ms`。首次在浏览器打开该 URL，若显示提示页，选择 Continue。随后访问 `https://你的隧道主机.devtunnels.ms/healthz` 确认能看到状态。

`--allow-anonymous` 是让微软云端能够经过隧道，**API 工具本身仍要求 Bearer 密钥**；不是把本机文件匿名公开。不要关闭 bridge 的认证。也不需要打开路由器入站端口。

保持这个窗口运行。下次可直接运行：

```powershell
devtunnel host 你的tunnel-id
```

使用固定隧道可避免每次重新打包。若已有多个 devtunnel，请使用显式 tunnel ID，避免操作默认隧道时选错。URL 必须是纯 HTTPS 主机地址，不含端口、路径、查询参数或密钥。

## 5. 在微软登记 API Key

打开 <https://dev.teams.microsoft.com>，使用与你的 Microsoft 365 Copilot 相同的组织账号登录。

1. 进入 **Tools → API key registration**。
2. 选择 **Create an API key / New API key**。
3. 选择 **Add secret**，把本机 `copilot.local.json` 的 `apiKey` 值填入这里。密钥只在你自己的本机和微软登记界面操作，不要粘贴到聊天。
4. API key name 填 `Local Repo Bridge`。
5. Base URL 填第 4 步的固定 HTTPS URL，与生成应用包时使用的 URL 完全一致。
6. Target tenant 选择自己的租户。
7. Target Teams App 尽可能绑定本机配置中的 `appId`。如果应用尚未上传、暂时只能选 Any Teams app，完成安装后回到登记页面绑定实际 app ID。
8. 保存，复制返回的 **API key registration ID / auth config ID**。

注意三个值不同：

| 名称 | 从哪里取得 | 用在哪里 |
| --- | --- | --- |
| `apiKey` | 本机初始化生成 | 本机服务 + 微软登记的 secret |
| registration ID | 微软登记页面保存后返回 | 应用包中的 `ApiKeyPluginVault.reference_id` |
| `appId` | 本机初始化生成 | 微软应用身份，更新时保持相同 |

API Key 登记共享的是此 bridge 的访问能力，不会自动按微软用户区分本地仓库权限。这个 Agent 先供你个人使用；不要把它发布给无权访问这些仓库的其他人。

## 6. 生成安装包

在第三个 PowerShell 窗口进入 bridge 目录，读取非秘密的 appId：

```powershell
$bridgeAppId = (Get-Content -Raw .\copilot.local.json | ConvertFrom-Json).appId
node copilot/cli.mjs package --base-url "https://你的隧道主机.devtunnels.ms" --registration-id "微软返回的登记ID" --app-id "$bridgeAppId" --output dist/copilot
```

输出：

- `dist/copilot/copilot-local-bridge.zip`：可上传的微软应用包。
- 同目录中的 `manifest.json`、`declarativeAgent.json`、`apiPlugin.json`、`openapi.json` 与两个 PNG 图标：供检查或在工具中导入。

ZIP 根目录直接包含清单，无额外父文件夹。它只包含公开 endpoint 和登记 ID，不含密钥。清单使用 Microsoft 365 app schema 1.22、declarative agent schema 1.9 和 plugin schema 2.4。

## 7. 安装到 Microsoft 365 Copilot

可以通过 Teams 网页/客户端的 **Apps → Manage your apps → Upload an app → Upload a custom app** 上传 `copilot-local-bridge.zip`，按页面提示添加。不同租户的入口名称可能略有不同。

若找不到上传入口，管理员需要允许 custom app upload；也可由管理员上传到组织应用目录。这是微软租户权限，修改本机代码不能绕过。

安装后打开 <https://m365.cloud.microsoft/chat>，在侧边栏 **Agents** 中选择 **Local Repo Bridge**。普通默认 Copilot 对话不会自动获得这个 Agent 的工具。

如果你使用 VS Code 的 **Microsoft 365 Agents Toolkit**：

1. 先登录 Microsoft 365 账号，确认具备 Copilot access 和 Custom App Upload。
2. 若需要由 Toolkit 重新生成项目，选择 **Create a New Agent/App → Declarative Agent → Add an Action → Start with an OpenAPI Description Document**。
3. 选用 `dist/copilot/openapi.json`，选择六个操作，并按 Toolkit 的认证配置登记密钥。
4. 复用 `dist/copilot/declarativeAgent.json` 的指令和 conversation starters，核对其 action 引用对应 Toolkit 生成的 plugin 文件。
5. 使用 **Provision** 安装测试。

本项目不提供 `m365agents.yml`；不要直接在源码目录执行 Toolkit Provision。上传已生成的 ZIP 是本文的直接安装流程。不要用本地 `/openapi.json` 中的 localhost URL 替代包内已填写公网地址的 `openapi.json`。

## 8. 首次验收

先在一个专门的测试仓库中逐步执行，确认工具能真实返回本机状态：

> 列出你能访问的本地仓库。选择 my-project，调用工具检查 Git 状态和最近的提交；不要修改文件。

接着使用实际配置的 repository ID：

> 在 my-project 中检查当前状态，创建并切换到 feature/copilot-smoke 分支。创建 COPILOT-SMOKE.txt，内容为“Copilot local bridge smoke test”。然后读取该文件并展示 Git diff。暂时不要提交或推送。

在本机资源管理器/编辑器中检查文件确实已创建。最后可以要求：

> 只暂存 COPILOT-SMOKE.txt，然后提交，提交说明为“test: verify Copilot local bridge”。显示提交结果，不要推送。

只有确实需要时才开启 `allowPush`，重启服务，再明确要求推送指定开发分支。Git 身份、签名与远端凭据使用本机原有配置；bridge 不会自动设置用户名、关闭签名或添加远端凭据。HTTP 工具调用发生在本机服务进程的用户权限下。

用于实际开发的示例：

> 检查 smtb-cust 的 Git 状态，读取仓库中的 AGENTS.md 和 TD 相关代码。先解释现状，再根据以下要求修改。保留我的已有改动，完成后展示 diff，并列出尚未执行的测试。本次不要提交或推送。

Copilot 能否正确选工具、能否完成长任务，仍需要按实际模型和租户行为验证。它不是一个持续后台运行的本地 Codex Agent。

## 支持范围

| 能力 | 当前支持 |
| --- | --- |
| 多个本地仓库 | 使用配置中的仓库 ID，不接受任意绝对路径 |
| 文件一览与读取 | UTF-8 文本；分页读取，返回完整文件 SHA-256 |
| 新建/修改代码 | 完整文本写入；用 expectedHash 检测旧版本和多数并发修改冲突 |
| Git 查看 | status、diff、log、show |
| Git 修改 | fetch、fast-forward-only pull、switch、createBranch、显式路径 stage、commit、可选 push |
| Git 破坏性操作 | 不支持 reset、clean、rebase、merge、stash、force push |
| 任意 shell / Maven / npm 构建 | 本版本不提供；需要在本机终端执行 |
| 二进制文件、图像、超大文件 | 不属于本版本文本编辑能力 |
| 浏览器 DOM 自动化 | 不需要；使用微软原生 API plugin 调用 |
| OAuth 动态注册 | 本方案不使用 |

文件访问会排除 `.git`、`.env*`、常见私钥/证书文件和 `copilot.local.json`；拒绝符号链接、Windows junction 和硬链接文件。它不是操作系统沙箱或完整 DLP 系统，仓库代码、本地 Git 配置、过滤器与凭据助手仍需可信。此版本禁用 Git hooks，因此不能依赖提交钩子执行检查，应在本机单独运行相应检查。

写入请求使用 UUID `requestId`。同一服务进程内，相同 ID 和内容的重试返回已保存结果；重启服务会清空重试缓存。超时后不能推断“没有执行”，应先检查实际状态。文件修改还会在写入前检查完整文件 hash，防止基于旧版本直接覆盖。对同一仓库的 bridge 请求会串行处理；外部编辑器在最后检查与文件替换之间的极短窗口仍可能修改文件，因此这不是操作系统级原子比较交换。

较长文件需连续读取所有页后才能替换完整内容。Copilot action 的上下文和返回长度有限，大规模改造仍应分批处理，不应声称一次调用读取了被截断的全部代码。

## 常见问题

**Copilot 只回复建议，没有真正读取文件**

确认你正在 Local Repo Bridge Agent 中聊天；要求它调用 listRepositories。检查本机服务窗口是否出现请求日志。可以在 Copilot 中使用微软开发调试命令 `-developer on`，观察 action 选择情况；结束时使用 `-developer off`。

**工具返回 401**

核对本地 apiKey 与微软登记的 secret 是否相同，plugin 内填写的是登记 ID 而不是 secret；核对登记的 Base URL 和 app/tenant 绑定。

**调用超时、连接失败或跳转到登录页**

先运行 doctor，再检查公网 `/healthz`、隧道是否仍运行、首次 Continue 是否完成，以及隧道是否允许云端访问。不能把需要浏览器交互登录的反向代理直接放在工具前面。

**403 或 Git 操作被拒绝**

查看本机配置的 allowWrite、allowGitWrite、allowPush 和 protectedBranches；修改配置后重启服务。仓库边界与被排除的敏感路径不能靠换一个 API 绕过。

**409 / expectedHash 不匹配**

其他程序改过文件，或请求 ID 被不同内容重复使用。重新读取实际状态，重新规划；不要拿旧 hash 强行写入。

**Git 提交/推送失败**

在本机终端检查 Git 身份、签名、远端认证及远端权限。服务不会弹出可靠的交互式凭据流程，也不会代你关闭现有签名策略。处理好后重新检查状态，再发起新的明确操作。

**更新了 bridge、隧道地址或清单**

保留同一 appId。重新生成包，更新 API Key 登记 Base URL（若地址改变）。Microsoft 要求应用清单更新时增加 manifest.version；目前生成器输出版本为 0.2.0，同一版本的重新上传可能需要先移除旧测试应用再添加，或者修改生成器中的版本后重新打包。移除微软应用不删除本机仓库。

**停止与撤销**

在 bridge 和 devtunnel 窗口按 Ctrl+C。需要撤销长期访问时，轮换本地 apiKey 并更新/删除微软 API Key 登记。已经返回到 Copilot 对话中的内容不会因停止服务而自动删除。

## 官方依据（2026-10-29 核实）

- [MCP 与 API plugins 的作用范围](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins)：作为 declarative agent 的 actions。
- [API Key 认证配置](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-api-key)：登记 secret，清单仅引用登记 ID。
- [认证方式对照](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication)：MCP action 与 OpenAPI plugin 的认证支持不同。
- [本地调试和 devtunnel](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-debug-local)：云端可达性、固定隧道和首次启用。
- [租户与 custom app upload 前提](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/prerequisites)。
- [API plugin 创建流程](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-api-plugins-existing-api)。
- [Plugin schema 2.4](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4)、[declarative agent schema 1.9](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.9)。
- [已知限制](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/known-issues)：请求参数保持扁平，避免不支持的嵌套对象。
