---
title: DSH API 契约
description: 主机与浏览器服务、私有组合边界、生命周期操作和升级检查。
---

DSH 尚未进入稳定版。其规则允许公开 API 在不同版本之间变化，并要求消费者同步更新。本插件的目标不是永不变化的 API，而是让升级可以机械检查：只使用 DSH 从软件包根目录导出并记录的接口，不导入 `.../src/*` 深层路径，也不依赖内部事件。所有使用点列在下方。

## 主机端

| 用途 | API | 位置 |
|---|---|---|
| 插件与服务 | Cordis 的 `Context`、`Service`、`ctx.inject`、`ctx.effect`、`ctx.provide` | 各处 |
| 配置 | Schemastery `Config`、volatile 字段、`loader/volatile-update` | `index.ts`、`host/config.ts` |
| 浏览器 HTTP API | `ctx.webServer.register`、`ctx.connection.requestRejection` | `host/http/` |
| 会话对应的对话 | `ctx.sessionController.create/rename`、`ctx.workspaceRegistry.create/archiveSession`、`ctx.sessionPersistence` | `host/agent/` |
| 智能体预设 | `@deepseek-ai/dsh-agent-preset` 行及其 `plugins` | 套件的 `cordis.patch.yml` |
| 游戏主持人工具 | `ctx.tools.register(defineTool(...))` | `host/orchestration/tools.ts`、`@dsh-agentic-roleplay/state` |
| 系统提示词 | `ctx.systemPrompt.section` | `orchestration.ts` |
| 回合控制 | `agent/pre-step`、`agent/turn-stopping`、`agent.steer`、`exec.concludeTurn()`、`exec.agent`、`exec.signal` | `host/orchestration/hooks.ts`、`tools.ts` |
| 无自有工具的编年史作者 | 带有自己的 `submit_result` 的 `runChild` 子智能体（见下） | `compaction/chronicler.ts` |
| 有专属工具的角色与记录员 | 不使用公开子智能体 API，见下文 | `agents/child.ts` |
| 消息来源 | 合并到 `MessageSourceMap` 的 `roleplay` | `hooks.ts` |
| 查找智能体 | `ctx.agents.get` | `orchestration.ts` |
| 上下文折叠 | `BasicCompactionEngine` 的 `summarize()` 与 `compactRegion()`，以及 `ctx.tokenMeter.measure(session)`、`session.surface.nodes`、`session.snapshotEvents()`、`session.header.origin` | `host/compaction/` |
| 会话事件 | 读取 `turn/start`、`user/message`、`tool/result`；通过 `Session.create` 与 `ctx.sessionPersistence` 写开场回合 | `compaction/range.ts`、`agent/opening.ts` |

预设的插件包括 persona、本项目的两个插件和 `compaction` 组。`BasicCompactionEngine` 是 `@deepseek-ai/dsh-compaction-basic` 的默认导出，只覆盖其文档列出的钩子。

## 浏览器端

客户端使用 `ctx.slots`，包括 `settings.section`、`sidebar.panellist`、主区域面板、`conversation.chat.node` 和 `conversation.view`；还使用 `ctx.locale`、`ctx.configForms`、`ctx.uiConversation`、`uiWorkspace.openSession`，以及 `Button`、`Input`、`Switch`、`Modal`、`Tag`、`Tooltip` 等外壳组件。客户端包格式由外壳模块加载器决定，并通过 `tsdown.config.ts` 检查。

## 辅助智能体

角色、记录员、世界作者、势力策略师及其他一次性辅助智能体都是拥有各自工具的子智能体：围绕 Alice 记忆建立的工具不能让并行运行的 Bob 得到任何内容，子智能体在循环之后通过 `submit_result` 工具结束（因此可以读取、写入、检查和修正）。`host/agents/child.ts` 中的 `runChild` 只用公开 API 做到这一点：

- **启动。** `ctx.get('subagents').startActivation({ provider: 'spawn', childId, delivery: 'caller', request: { parent, agentPreset: 'roleplay-helper', agentOptions, prompt } })`。调用方先预留子智能体的会话 id（`childId`），要交给子智能体的内容在它出现之前就以该 id 登记。（没有在所属插件上声明 `inject` 时，`parent.ctx.subagents` 会抛错；`ctx.get('subagents')` 不会。）
- **预设。** `roleplay-helper` 是 bundle 补丁里的一行 `@deepseek-ai/dsh-agent-preset`（所以单独安装 core 时没有辅助智能体）。它挂载 `core/helper` 插件：按会话 id 读取的系统提示段落给出角色设定，并在公开的 `agent/created` 事件里调用该子智能体的 `setup`。预设由所有使用它的智能体共享，所以每个子智能体自己的内容不放在插件里，而是按会话 id 查找。
- **专属工具。** spawn 出来的子智能体会继承所有全局工具（故事读取工具、DSH 的 working directory），所以 `setup` 先调用 `agent.ctx.tools.restrict({ allow })`（`allow` 只含任务放行的外部工具），再把子智能体的工具注册到 `agent.ctx` 上，`restrict` 不会影响这些。`submit_result` 工具、调用预算、重复调用保护和提醒也是同样注册的。
- **代价。** 每次运行都会在旁白主持人的日志里增加一条 `subagent/catalog` 事件（几百字节，回合结束后也可能出现，所以已结束回合的最后一个事件不一定是 `turn/end`）。DSH 同一父智能体最多同时容纳 `maxActiveSubagents` 个子智能体（默认 8），多的会被拒绝，因此 bundle 补丁把它提高到 32，以容纳一轮角色加上记录员、作者和建议。
- **准确的测试版本。** 软件包声明 DSH `>=0.2.1-rc.2 <0.2.2`（`engines.dsh` 与 peer 依赖）。开发依赖与 `tests/support/dsh-contract.spec.ts` 固定到经过测试的准确版本，这些值都由 `scripts/dsh-compat.mjs` 这一份清单推导而来。支持后续补丁版本前，必须先检查该准确版本的变更，移植所有受影响的集成，并在该版本上完成测试，然后才能扩大版本范围。
- **DSH 变化时**，重新阅读 `docs/subsystems/subagent.md`，让 `runChild` 与之保持一致；`tests/host/orchestration/loop.spec.ts` 中的真实循环测试通过一个替身 `agentPresets` 服务挂载该辅助插件。

## 回退、归档与删除

- 替换标记使用公开的 `Session.append('user/message', ..., { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs })`，与 DSH 自己的折叠方式相同。它把一段模型对话排除在后续请求外；`surfaceOp: 'append'` 用于添加提示。中间范围之后即使已有新回合也可替换，下一回合第一步中也可执行。DSH 的 Chat 视图不会隐藏被替换的行，因此客户端的 `TurnsDock` 按 DSH 给出的行键自行过滤。被遮蔽的回合不会重新进入对话，重新前进时只添加说明。
- 公开事件 `session/event` 指示回合结束，从而确定它在日志中的位置。
- 客户端通过 `ctx.sessions.fork({ sessionId, atSeq, increaseTitle })` 创建分支，与 DSH 自带分支按钮相同。主机端的公开 `agent/created` 事件串行等待；新智能体的 header 带有 `isSeeded` 和 `parentSession`，会话带有 `inheritedEventCount`。角色扮演会话会在对话首次使用前创建，失败则拒绝分支。
- 归档与恢复使用 DSH 的 `workspaceRegistry.archiveSession`（带 `stopActivity`）和 `unarchiveSession`。
- DSH 没有永久删除对话的公开 API。`host/agent/purge.ts` 在停止并刷新对话后，删除 DSH 保存的目录：`<store>/--<project>--/<session id>/`，包括对话自身及其创建的子智能体会话。子会话通过 `sessionPersistence.list()` 中的 `origin: 'subagent'` 与 `parentSession` 找到。目录名按 DSH JSONL 存储的 `projectKey` 和 `encodeSegment` 规则生成。符号链接、名称不匹配或不含日志的目录会被拒绝。位置由 `sessionStorePath` 配置，默认 `~/.dsh/sessions`。DSH 的工作区计数和投影缓存仍保留该 ID；存在 `delete` 的缓存会收到删除通知，残留条目不会再次列出或读取。操作会发出 DSH 控制器同样使用的 `api-session/removed`。存储布局变化会先由 `tests/host/agent/purge.spec.ts` 和实时删除测试发现。

## 提示词、语言和代表用户发送的消息

- `ctx.systemPrompt.section` 接收每次装配时求值的 `(context) => string`。通过 `dsh-agent` 合并的 `context.agent` 表示当前智能体，因此提示词段可跟随对话语言。预设中 `prefix: ''` 的 `dsh-persona` 行会遮蔽部署 persona，并在渲染时消失，把 persona 段留给本插件。除非设定 `interpolate: false`，段中的 `{{...}}` 会被 DSH 当作提示词变量；本项目的提示词文件无论如何都避免使用它。
- `sessionController.prompt(request, signal)` 必须接收 `AbortSignal`，否则 DSH 内部会对 `undefined` 调用 `throwIfAborted`。插件通过它代表用户向对话发送消息，例如卡片导入的 `/import-st`。
- 带开场内容的持久对话必须先以 `surfaceOp: 'append'` 追加一个空 `system/message`，再写其他表面节点。日志格式不允许系统提示词出现在其他节点之后。

## 升级 DSH 时

先阅读升级指南，再逐项核对本页。首先运行类型检查，因为类型就是契约；然后运行 `tests/host/orchestration/loop.spec.ts` 中的真实循环测试。该测试使用脚本模型执行真正的智能体循环、子智能体、工具注册表和上下文折叠。
