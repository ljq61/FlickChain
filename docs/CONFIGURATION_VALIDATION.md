# FlickChain subagent 配置迁移验证

日期：2026-10-09｜状态：迁移与结构验证完成；当前目录配置激活待授权

## 1. 已迁入的文件

源：`/Users/jackie/.codex/.chatgpt-projects/g-p-6ac6089e381c8191b5239a3a669b5ac5`。目标：`/Users/jackie/FlickChain`。

- `.codex/config.toml`：主模型 gpt-6.1-sol / high，启用 agents，最多同时三个子 agent，默认 gpt-6.1-sol / high。
- `.codex/agents/`：七个角色 TOML 原样复制。
- `AGENTS.override.md`：迁入原职责与规则，更新工作区说明，加入本地 PRD、架构、任务计划入口；源镜像保持只读。

| 角色 | 模型 | 推理强度 | 权限约束 |
|---|---|---|---|
| physics-gameplay-engineer | gpt-6.1-sol | high | 按委派文件写入 |
| presentation-engineer | gpt-6.1-sol | xhigh | 按委派文件写入 |
| ai-level-engineer | gpt-6.1-sol | high | 按委派文件写入 |
| platform-engineer | gpt-6.1-sol | high | 按委派文件写入 |
| test-reviewer | gpt-6.1-sol | xhigh | read-only |
| repo-scanner | gpt-6.1-sol | low | read-only |
| escalation-engineer | gpt-6-astra | high | 默认只读调查，明确委派后才写 |

采用[官方 Subagents 文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)的项目独立 TOML 格式。未添加 hooks、exec 策略、凭证或运行时游戏服务。

## 2. 本轮执行的检查

| 检查 | 结果与边界 |
|---|---|
| Python tomllib 解析 | 主配置与七个角色均通过；必需字段完整，name与文件名一致 |
| 迁移原文件比对 | 八个 TOML 逐字节与源文件一致；AGENTS 工作区描述有意更新 |
| Codex strict-config doctor | CLI 0.162.0-alpha.2 的 `config.load` 为 ok；doctor 其他系统/网络项不等同配置检查 |
| App-server `config/read` | 成功读取当前工作区的项目层；该层被禁用，原因是当前目录未加入 trusted projects |
| 角色实际调度 | 本轮按角色职责、指定模型/强度和文件所有权手动委派文档写作及独立审查；不声称命名角色自动加载已生效 |
| 独立规划审查 | 规则、模式、AI权限/选币、超时恢复、回放与任务映射经只读复核；阻断契约冲突已修正，可作为 Phase 1 实施基线 |
| 文档结构检查 | 本地链接、配对代码围栏、编号和换行通过；21任务、12验收、11验证入口对应12产品需求；所有游戏验证仍未执行 |

实际加载检查原文：

```text
To load project-local config, hooks, and exec policies, add
/Users/jackie/FlickChain as a trusted project in
/Users/jackie/.codex/config.toml.
```

源镜像目录此前的信任不会自动迁移到新路径。当前七个角色文件已可审查；启用新目录的项目设置还需要单独信任该路径。

## 3. 待授权的最小激活改动

仅向用户配置加入以下项目条目，保留其他设置。现有本地配置没有新增 hooks，但信任会使该路径未来的本地配置、hooks 和执行策略也可生效。

```toml
[projects."/Users/jackie/FlickChain"]
trust_level = "trusted"
```

本轮在未得到当前路径激活授权前不应用此改动。授权后重新 `config/read`，要求该项目层 `disabledReason` 为空且有效 agents 设置包含三并发及指定默认模型，然后更新本记录。

## 4. 证据边界

以上是配置和文档验证。游戏物理、输入、AI、关卡、构建、真机和平台验收均未开始。

## 5. Codely CLI 角色迁移（2026-10-09）

仿照第 1 节的 codex 角色，在 `.codely-cli/agents/` 以 Codely 官方自定义子代理格式（[官方 FAQ](https://codely-docs.tuanjie.cn/faq/common-questions)）创建同名七个角色 TOML：`[agent]` id/description + `[agent.system_prompt]` role/behavior + `[agent.tools]` allowed。`description` 驱动自动委派，`behavior` 内容改编自 codex `developer_instructions` 并保留关键约束（先读 AGENTS.override.md、不派生嵌套 agent、文件所有权、公共硬币整杆契约、证据边界）。

| codex 字段 | Codely 对应 | 差异说明 |
|---|---|---|
| per-role `model` / `model_reasoning_effort` | 无对应字段 | 官方 agent TOML 不含模型字段；xhigh/low 差异无法按角色表达，意图并入 behavior 文本 |
| `default_subagent_model = gpt-6.1-sol` | settings.json 顶层 `defaultAgentModel: "codely-core"` | 官方 Model Slot Overrides 文档的 `defaultAgentModel` 槽位 |
| `sandbox_mode = "read-only"` | `[agent.tools]` 白名单 | test-reviewer、repo-scanner 仅保留 read_file/search_file_content/glob/list_directory，无 write/shell；escalation-engineer 保留写工具、行为约束默认只读（与 codex 一致） |

验证：tomlkit 解析 7/7 通过；id 与文件名一致；id/description/role/behavior/allowed 必需字段完整；settings.json JSON 解析通过且含 defaultAgentModel。激活边界：本会话启动时的内置 agent 列表不含以上角色，预期由后续新会话从项目目录加载；不声称命名角色自动调度已生效。codex 侧第 3 节的 trust 授权仍待用户决定，与本节相互独立。
