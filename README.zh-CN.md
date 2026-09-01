# chatgpt-web-bridge

[English](README.md) | **简体中文**

一个通用的 Agent Skill / Runtime，用于把**思考、计划、架构审查、Root Cause 第二意见和独立 Review**委派给可见的 ChatGPT Web，同时始终保持**本地 Codex / OMP 作为执行者（Executor）和本地项目事实源**。

目标运行环境包括：

- Codex Desktop
- Codex CLI
- ORCA + Codex CLI
- ORCA + OMP
- 其他能够调用 Shell，并具备兼容 Browser Bridge 的 Agent

## 核心角色分工

```text
本地 Codex / OMP
  = Executor（执行者）
  = 本地项目事实源
  = 调查 / 修改 / Build / Test / Debug / Git / Deploy

ChatGPT Web
  = Thinker（思考者）
  = Planner（计划者）
  = Reviewer（审核者）
  = Confirmer / Second Opinion（确认者 / 第二意见）
```

本地仓库、Git 状态、日志、运行时行为和测试结果始终是事实源。ChatGPT 的输出属于建议和判断，只有经过本地 Agent 验证后才能作为实施依据。

## 为什么要做这个项目

像 `adamallcock/codex-chatgpt-control` 这样的项目，已经为可见的 ChatGPT Chat / Work 会话提供了很完善的语义控制层。

本项目在此基础上增加一层更通用的 **Agent 委派策略（delegation policy）**，并解除“只能由 Codex Desktop 托管浏览器工作流”的限制。

```text
Codex Desktop ───────────────┐
Codex CLI ───────────────────┤
ORCA + Codex/OMP ────────────┼─> chatgpt-web-delegate Skill
其他 Shell Agent ────────────┘             │
                                           ├─ Codex Browser Bridge / SDK
                                           ├─ ORCA 内置 Browser Tool
                                           └─ BrowserSkill fallback
                                                      │
                                                      ▼
                                                ChatGPT Web
```

## v0.1 目标

- [x] 通用 `chatgpt-web-delegate` Skill
- [x] 明确 Executor 与 Thinker / Planner / Reviewer 的职责边界
- [x] 支持自主但有边界的 ChatGPT 委派策略
- [x] 标准化 Consultation Prompt
- [x] Consultation Budget
- [x] Submit-once 等待状态机
- [x] Timeout / Resume 语义，禁止盲目重复发送 Prompt
- [x] Codex Desktop / 兼容 `BrowserLike` 的 SDK 路径
- [x] ORCA Host Browser Tool 协议
- [x] BrowserSkill fallback 策略
- [x] 单元测试 + GitHub Actions CI
- [ ] ORCA 专用 JavaScript `BrowserLike` Adapter（等待 ORCA 暴露稳定 JS Browser API）
- [ ] BrowserSkill → `BrowserLike` Adapter
- [ ] 文件上传 / 下载
- [ ] ChatGPT Work / Deep Research
- [ ] 完整 E2E 测试矩阵

## Agent 应该什么时候自主调用 ChatGPT

适合自动委派给 ChatGPT 的场景：

- 架构、认证、权限、安全、数据库 Schema、迁移、部署、数据丢失风险、Public API 等高影响决策
- Root Cause 调查中存在多个合理假设，而本地证据暂时无法明确区分
- 已经过两轮有意义的本地调查 / 修复，但仍没有实质进展
- 大规模或跨模块修改在真正实施前，需要对计划进行独立 Review
- 重要实现已经完成，并且本地测试通过，希望再做一次独立 Review
- 本地 Agent 对当前判断信心明显不足，而且第二意见可能改变后续行动
- 用户明确要求“问一下 ChatGPT”“让 ChatGPT Review”“找另一个模型看看”等

以下场景通常不应自动调用 ChatGPT：

- typo / formatting / rename
- 简单 CRUD
- `git status`、只 Build、只 Test 等纯执行工作
- Root Cause 已经清楚、证据充分的小型 Bug
- 对已经被本地强证据支持的结论反复确认

默认每个用户任务的 Consultation Budget：

```yaml
max_consultations: 3
max_followups_per_consultation: 2
```

详细规则见 [`docs/DELEGATION_POLICY.md`](docs/DELEGATION_POLICY.md)。

## ChatGPT 长时间思考 / 输出时如何等待

Bridge 必须把“Prompt 已提交”和“回答已经完成”视为两个不同的状态：

```text
submit once
    │
    ▼
submitted
    │
    ▼
generating ──────────────┐
    │                    │ 持续轮询同一个 turn
    └────────────────────┘
    │ generation inactive
    ▼
stable_candidate
    │ 回答在稳定时间内不再变化
    ▼
complete
    │
    ▼
读取最终回答
```

如果 Prompt 已经提交，但等待过程中发生 timeout：

```text
timeout
  submitted: true
  resumable: true
  action: 重新检查同一个 ChatGPT thread
  forbidden: 自动重新发送 Prompt
```

详细规则见 [`docs/WAITING_AND_RECOVERY.md`](docs/WAITING_AND_RECOVERY.md)。

## 安装

要求 Node.js 20+：

```bash
npm install
npm test
```

### 安装 Skill 到 Codex

#### Linux / macOS

```bash
mkdir -p ~/.codex/skills/chatgpt-web-delegate
cp -R skills/chatgpt-web-delegate/* ~/.codex/skills/chatgpt-web-delegate/
```

#### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$HOME\.codex\skills\chatgpt-web-delegate"
Copy-Item -Recurse -Force ".\skills\chatgpt-web-delegate\*" "$HOME\.codex\skills\chatgpt-web-delegate\"
```

对于 ORCA / OMP，把同一个 Skill 目录安装到对应 Host 的 Skill 搜索路径即可。

建议始终维护同一份 Skill 策略源，不要为 ORCA、Codex Desktop、Codex CLI 分别维护多套行为规则。

## SDK 模式

当运行环境存在兼容的 Codex Browser Bridge，或者能够提供自定义 `BrowserLike` 时，优先使用 `codex-chatgpt-control`：

```js
import { consultWithSdk } from "./src/sdk-consult.mjs";

const result = await consultWithSdk({
  prompt: "Review this implementation plan...",
  timeoutMs: 10 * 60_000
});
```

这个 Helper 会刻意使用：

```text
wait: false
read: false
```

先把 Prompt **提交一次**，然后轮询同一个 Assistant Turn，而不是把“等待超时”当成重新发送 Prompt 的理由。

## ORCA 模式

如果 ORCA 把浏览器作为 Agent Tool 暴露，而不是提供 JavaScript Browser Object，那么 Skill 会直接使用 ORCA 的内置 Browser Tool。

整个流程仍然遵守同一套：

```text
Submit once
→ Wait
→ Observe
→ Stable
→ Read
→ Resume local work
```

不会假装 ORCA 一定存在 `globalThis.agent`。

详细说明见 [`docs/ORCA_INTEGRATION.md`](docs/ORCA_INTEGRATION.md)。

## 安全原则

不要把 Secret 或与问题无关的敏感源码 / 数据发送给 ChatGPT。

项目内置的 Prompt Builder 会拦截部分明显的 Token / Private Key 模式，但这只是基础防护，并不能代替正式的 DLP 或企业安全控制。

更详细的安全要求见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 上游项目与设计参考

本项目的目标是补充而不是替代以下项目：

- `adamallcock/codex-chatgpt-control`
- `Tencent/BrowserSkill`

当 Browser Runtime 可用时，`codex-chatgpt-control` 仍然是首选的 ChatGPT 可见界面语义控制层。

本项目重点负责更上层的问题：

```text
什么时候应该找 ChatGPT？
应该问什么？
应该发送多少上下文？
ChatGPT 应该扮演什么角色？
应该等待多久？
超时后如何恢复？
ChatGPT 的建议返回后，本地 Agent 应该如何验证和执行？
```

## License

MIT
