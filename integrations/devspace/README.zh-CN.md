# DevSpace MCP：Microsoft 365 Copilot 适配

本目录统一保存本轮 DevSpace MCP 适配的完整源码补丁和复现说明。仓库原有的 `copilot/` 是独立的 OpenAPI 桥接服务；本目录的补丁需要应用到 [Waishnav/devspace](https://github.com/Waishnav/devspace)，不会由本仓库的 Node 服务自动加载。

## 版本与内容

- 上游基线：`fdbff75e07779bba1f2fdc785a2575e2b0d839bc`。
- 本地 DevSpace 最终提交：`3822a981292d4257d0150dc28af7fb159686eb5d`。
- 补丁文件：[`devspace-copilot.patch`](devspace-copilot.patch)。
- 补丁包含受控 Git 工具提交 `c6ced15bd53c4588785f1ab5d4f9eff87f6ceec3` 和本轮 OAuth、代理、只读查询优化；不需要另找前置补丁。
- 这些 DevSpace 提交号用于记录来源，不代表它们已经进入上游 GitHub 仓库。
- 上游授权声明见 [UPSTREAM-LICENSE](UPSTREAM-LICENSE)。

包含的行为：

1. 为省略 OAuth `resource` 的客户端提供显式开启的兼容选项；仍保留 owner password、PKCE、客户端认证及 token audience 校验。
2. OAuth 回调不被允许时，只报告被拒绝的主机名，便于配置白名单。
3. 增加 `DEVSPACE_TRUST_PROXY=loopback`，适用于从本机回环地址连接的隧道/反向代理。
4. 提供受控的 Git status、fetch、ff-only pull、switch、stage、commit、push 工具。
5. `git_status` 返回 HEAD、upstream、ahead/behind；只查询本地 refs，不执行 fetch 或刷新索引。
6. Windows 启动脚本启用 full 工具模式和缺失 resource 兼容，并将 `teams.microsoft.com` 与实际观察到的 Studio 回调主机 `global.consent.azure-apim.net` 加入现有白名单。

## 已经运行本轮修改的电脑

如果现有 DevSpace checkout 已包含上述最终提交，无需再次应用补丁。这个目录用于 GitHub 归档、评审及新环境复现。

不要对正在使用的 checkout 重复应用补丁，也不要用重置或清理命令强行覆盖本地改动。

## 在新目录复现（Windows PowerShell）

先下载本仓库的 `feature/copilot-local-bridge` 分支，在其根目录打开 PowerShell。使用新的 DevSpace 目录：

```powershell
$bridgeRoot = (Get-Location).Path
$patchPath = Join-Path $bridgeRoot "integrations\devspace\devspace-copilot.patch"
$devspaceRoot = Join-Path (Split-Path $bridgeRoot -Parent) "devspace-copilot"

git clone https://github.com/Waishnav/devspace.git $devspaceRoot
if ($LASTEXITCODE -ne 0) { throw "Clone failed; choose a new directory." }
Set-Location $devspaceRoot
git switch --create feature/copilot-mcp fdbff75e07779bba1f2fdc785a2575e2b0d839bc
if ($LASTEXITCODE -ne 0) { throw "Cannot select the pinned base." }
git apply --check $patchPath
if ($LASTEXITCODE -ne 0) { throw "Patch validation failed; stop here." }
git apply $patchPath
if ($LASTEXITCODE -ne 0) { throw "Patch application failed." }
npm ci
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }
```

使用该版本 package.json 所支持的 Node.js（`>=22.19 <27`）。本补丁仅保证对指定上游基线可应用；升级上游时需重新检查差异与兼容性。

随后按 DevSpace 的配置说明设置允许访问的目录、owner password 和公开 HTTPS 地址，并保持用户自己的 HTTPS 隧道运行。配置完成后启动：

```powershell
.\scripts\Start-DevSpace-Copilot.cmd
```

脚本使用已有配置，不包含密码、API key、token 或用户专属公网地址。新机器仍需独立完成配置。

## 接入 Copilot

- MCP URL 使用该 DevSpace 实例公开的 HTTPS `/mcp` 地址。
- Studio 连接可以使用 OAuth 2.0 动态注册/发现；实际回调主机必须在 DevSpace 白名单内。
- 声明式 Agent 的 RemoteMCPServer 使用 OAuthPluginVault；注册 ID 属于各自租户，不能把其他客户端 ID 或密码填入该字段。
- 本目录只交付 DevSpace 服务端补丁和说明，不包含已绑定租户的应用安装包；发布 Agent、分配权限仍在微软对应管理界面完成。
- 项目约束是仅使用已有 M365 Copilot 订阅。服务端本身不调用付费模型 API；微软侧具体智能体、模型、渠道是否包含在许可证内需要按实际配置确认，不能将“能添加 MCP”视作免额外计费保证。

## 确认提示与执行边界

补丁没有把 `bash`、`write`、`edit` 或 Git 写操作标成只读，也不绕过 Copilot 的确认界面。只读工具可以减少重复确认，最终行为取决于宿主。

文件工具执行允许目录检查；shell 使用本机用户权限，并不是只允许访问该目录的通用沙箱。

## 验证记录（2026-11-05）

- 本地 DevSpace：类型检查、配置测试、OAuth store 测试通过。
- OAuth HTTP 流程测试：2 项通过。
- Git 工具与 MCP server 回归：15 项通过。
- 导出的完整补丁在独立的基线文件副本上通过 `git apply --check` 和实际应用；全部 17 个结果文件的 Git blob 哈希与本地最终提交一致。
- 此前用户已确认 Copilot 登录和工具调用成功；这不等于所有宿主都可免确认，也不等于所有模型均已开放。

原有 OpenAPI 桥接方案另见 [Copilot 安装说明](../../docs/COPILOT.zh-CN.md)。
