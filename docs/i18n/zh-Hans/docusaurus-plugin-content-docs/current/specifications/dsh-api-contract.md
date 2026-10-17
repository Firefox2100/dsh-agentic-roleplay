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
| 无工具的编年史作者 | `ctx.subagents.start('spawn', ...)`、`SubagentRun.result/dispose` | `compaction/chronicler.ts` |
| 有专属工具的角色与记录员 | 不使用公开子智能体 API，见下文 | `agents/child.ts` |
| 消息来源 | 合并到 `MessageSourceMap` 的 `roleplay` | `hooks.ts` |
| 查找智能体 | `ctx.agents.get` | `orchestration.ts` |
| 上下文折叠 | `BasicCompactionEngine` 的 `summarize()` 与 `compactRegion()`，以及 `ctx.tokenMeter.measure(session)`、`session.surface.nodes`、`session.snapshotEvents()`、`session.header.origin` | `host/compaction/` |
| 会话事件 | 读取 `turn/start`、`user/message`、`tool/result`；通过 `Session.create` 与 `ctx.sessionPersistence` 写开场回合 | `compaction/range.ts`、`agent/opening.ts` |

预设的插件包括 persona、本项目的两个插件和 `compaction` 组。`BasicCompactionEngine` 是 `@deepseek-ai/dsh-compaction-basic` 的默认导出，只覆盖其文档列出的钩子。

## 浏览器端

客户端使用 `ctx.slots`，包括 `settings.section`、`sidebar.panellist`、主区域面板、`conversation.chat.node` 和 `conversation.view`；还使用 `ctx.locale`、`ctx.configForms`、`ctx.uiConversation`、`uiWorkspace.openSession`，以及 `Button`、`Input`、`Switch`、`Modal`、`Tag`、`Tooltip` 等外壳组件。客户端包格式由外壳模块加载器决定，并通过 `tsdown.config.ts` 检查。

## 唯一低于公开 API 的位置

角色和记录员是拥有各自工具的子智能体。公开子智能体 API 无法提供两项必要能力：只在某一个子智能体上注册工具，以及让子智能体循环读取、写入、检查和修正后，通过工具提交符合契约的最终结果。第一项确保围绕 Alice 记忆建立的工具不会把内容泄露给并行运行的 Bob。

因此，`host/agents/child.ts` 中的 `runChild` 通过 `parent.ctx.agents.create` 创建子智能体，并使用 DSH 为子智能体提供方导出的组合辅助函数：`applyChildComposition`、`childSessionMeta`、`resolveChildAgentOptions`、`resolveChildDepth`、`captureDelegatedPolicyOverrides`、`appendDelegatedPolicyOverrides`。这些函数来自 `@deepseek-ai/dsh-subagent`。参数验证使用 `@deepseek-ai/dsh-tools` 的 `validateJsonSchemaValue` 与 `ToolArgsError`。工具注册在子智能体自己的作用域，最终由 `submit_result` 工具接收结果参数并结束运行。

这是为支持每个智能体的专属工具而有意接受的边界，并通过以下规则控制风险：

- 软件包目前声明 DSH `>=0.2.0-rc.2 <0.2.1`。开发依赖与 `tests/support/dsh-contract.spec.ts` 均固定到经过测试的准确版本 `0.2.0-rc.2`。支持后续补丁版本前，必须先检查该准确版本的变更，移植所有受影响的集成，并在该版本上完成测试，然后才能扩大版本范围。
- 只有这一个文件在公开 API 下方创建智能体。DSH 正式支持每智能体工具后，只需替换 `runChild`。
- 这类子智能体不写内部的子智能体描述符，所以不会出现在父智能体的子智能体列表中。除此之外，它仍是普通子会话，真实循环测试会验证 DSH 的不变量。
- DSH 变化时，需要重新阅读 `docs/subsystems/subagent.md` 和 `packages/subagent/subagent-in-process-driver`，后者使用同样的组合方式，然后让 `runChild` 与新实现保持一致。

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
