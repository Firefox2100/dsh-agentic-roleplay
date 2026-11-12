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
| 配置档案选中的套件层（重复 layer 警告） | `DSH_PROFILE_DIR`（环境事实）与配置档案自己的 `package.json`，只读；DSH 没有提供查询所选套件列表的服务 | `host/setup/rows.ts` |
| 会话对应的对话 | `ctx.sessionController.create/rename`、`ctx.workspaceRegistry.create/archiveSession`、`ctx.sessionPersistence` | `host/agent/` |
| 智能体预设 | `@deepseek-ai/dsh-agent-preset` 行及其 `plugins` | 套件的 `cordis.patch.yml` |
| 游戏主持人工具 | `ctx.tools.register(defineTool(...), { when })` | `host/orchestration/tools.ts`、`@dsh-agentic-roleplay/state` |
| 系统提示词 | `ctx.systemPrompt.section` | `orchestration.ts` |
| 系统提示词 | `ctx.systemPrompt.suppressRuntimeContext`、`ctx.systemPrompt.context` | `helper.ts` |
| 系统提示词（按作用域） | 在预设自己的作用域里注册同名的 `ctx.systemPrompt.section`/`context` 会遮蔽 profile 的那一条（空文本不贡献内容），各预设因此把 Web bundle 的引导文字挡在故事提示词之外 | `host/prompts/dev-context.ts` |
| 命令 | `ctx.commands.register`（在预设的插件里，作用于该预设的智能体）、`agent/created` 时的 `agent.ctx.inject(['commands'], ...)`（作用于某个聊天的智能体）、`agent.followup`；命令名只能用 DSH 的字符集（`[a-z][a-z0-9_-]*`），输入提示不能为空 | `host/commands/registry.ts`、`host/orchestration/player-commands.ts`、`host/checks/commands.ts`、`host/import/tools.ts` |
| 回合控制 | `agent/pre-step`、`agent/turn-stopping`、`agent.steer`、`exec.concludeTurn()`、`exec.agent`、`exec.signal` | `host/orchestration/hooks.ts`、`tools.ts` |
| 创作助手的模型选择 | 在 `agent/created` 中调用 `agent.model.current()`、`agent.model.select()` | `host/authoring/turn-guard.ts` |
| 无自有工具的编年史作者 | 带有自己的 `submit_result` 的 `runChild` 子智能体（见下） | `compaction/chronicler.ts` |
| 有专属工具的角色与记录员 | **不使用面向模型的 `subagent` 工具**，而是公开的 `ctx.subagents.startActivation()` 服务方法，外加子智能体自己的 `submit_result` 工具（见下文） | `agents/child.ts` |
| 消息来源 | 合并到 `MessageSourceMap` 的 `roleplay` | `hooks.ts` |
| 查找智能体 | `ctx.agents.get` | `orchestration.ts` |
| 上下文折叠 | `BasicCompactionEngine` 的 `summarize()` 与 `compactRegion()`，以及 `ctx.tokenMeter.measure(session)`、`session.surface.nodes`、`session.snapshotEvents()`、`session.header.origin` | `host/compaction/` |
| 会话事件 | 读取 `turn/start`、`user/message`、`tool/result`；通过 `Session.create` 与 `ctx.sessionPersistence` 写开场回合 | `compaction/range.ts`、`agent/opening.ts` |

预设的插件包括 persona、本项目的两个插件和 `compaction` 组。`BasicCompactionEngine` 是 `@deepseek-ai/dsh-compaction-basic` 的默认导出，只覆盖其文档列出的钩子。

## 浏览器端

客户端使用 `ctx.slots`，包括 `settings.section`、`sidebar.panellist`、主区域面板、`conversation.chat.node` 和 `conversation.view`；还使用 `ctx.locale`、`ctx.configForms`、`ctx.uiConversation`、`uiWorkspace.openSession`。客户端包格式由外壳模块加载器决定，并通过 `tsdown.config.ts` 检查。

快照存储是插件自己的（`src/client/store.ts`）。`hooks` 源和 `store` 注册只需要 `getSnapshot`/`subscribe` 这一对方法，所以运行时从不 require 外壳的存储包。它不在 `SHELL_MODULES` 里，打包边界会拒绝它的运行时导入。`@deepseek-ai/dsh-client-store` 仍留在 devDependencies 里，但只提供类型：插槽的类型声明引用它的 `PropsStore`/`StoreHandle` 形状，去掉这个包会让所有插槽 prop 退化成 `any`；运行时没有任何地方 import 它，产物里会被擦掉。

**控件是插件自己的一份副本。** 插件规范禁止把 Harness 客户端包当作模块加载：它们可能随版本变化，抛错会让插槽条目整块白掉；规范允许的做法是复制到插件自己的类名前缀下，只保留 `--dsw-alias-*` 主题 token。这份副本在 `src/client/ui/`：`Button`、`Input`、`Switch`、`SegmentedControl`、`Modal`、`Tooltip`、`Tag`、`Toast`、`ImageLightbox`、设置表单的外框与字段（`SettingsForm`、`SettingsValueField`、`settings-form.ts`），以及插件自己绘制的轮廓图标。外壳原本免费提供的行为都保留了：模态框把焦点关在里面、Escape 关闭并还原触发元素的焦点；开关是 `role="switch"` 加 `aria-checked`；分段控件用方向键在 tab 之间移动；提示气泡会按视口翻转并夹紧。`@deepseek-ai/dsh-client-ui-primitives` 已不再是依赖、也不在 `SHELL_MODULES` 里，运行时 import 它会被打包边界检查拒绝。

这份副本里有两处逻辑值得单独测试，它们是既不含 React 也不碰 DOM 的纯函数：`src/client/ui/place.ts`（气泡落在哪一侧、什么时候翻转、怎么夹紧）与 `src/client/ui/walk.ts`（tablist 的按键落到哪一段）。`tests/client/ui/place.spec.ts` 覆盖两者，改动这些行为不用打开浏览器就能被测试抓住。

有一个元素被放在插件自己的组件之外：界面包的背景层，它作为会话正文的第一个子元素插入，并给该正文的滚动元素做标记，使其升到这一层之上。聊天会绘制自己的背景，也没有提供位于背景之后的插槽，所以背景无法从插件的子树里渲染；滚动元素的类名由 `tests/support/dsh-contract.spec.ts` 读取并检查。抬升规则和界面包自己的皮肤是由 dock 组件渲染的 `<style>` 元素，而不是手工追加到文档里的节点。

## 辅助智能体

角色、记录员、世界作者、势力策略师及其他一次性辅助智能体都是拥有各自工具的子智能体：围绕 Alice 记忆建立的工具不能让并行运行的 Bob 得到任何内容，子智能体在循环之后通过 `submit_result` 工具结束（因此可以读取、写入、检查和修正）。`host/agents/child.ts` 中的 `runChild` 只用公开 API 做到这一点：

- **启动。** `ctx.get('subagents').startActivation({ provider: 'spawn', childId, delivery: 'caller', request: { parent, agentPreset: 'roleplay-helper', agentOptions, prompt } })`。调用方先预留子智能体的会话 id（`childId`），要交给子智能体的内容在它出现之前就以该 id 登记。（没有在所属插件上声明 `inject` 时，`parent.ctx.subagents` 会抛错；`ctx.get('subagents')` 不会。）
- **预设。** `roleplay-helper` 是 bundle 补丁里的一行 `@deepseek-ai/dsh-agent-preset`（所以单独安装 core 时没有辅助智能体）。它挂载 `core/helper` 插件：按会话 id 读取的系统提示段落给出角色设定，并在公开的 `agent/created` 事件里调用该子智能体的 `setup`。预设由所有使用它的智能体共享，所以每个子智能体自己的内容不放在插件里，而是按会话 id 查找。
- **专属工具。** spawn 出来的子智能体会继承所有全局工具（故事读取工具、DSH 的 working directory），所以 `setup` 先调用 `agent.ctx.tools.restrict({ allow })`（`allow` 只含任务放行的外部工具），再把子智能体的工具注册到 `agent.ctx` 上，`restrict` 不会影响这些。`submit_result` 工具、调用预算、重复调用保护和提醒也是同样注册的。
- **代价。** 每次运行都会在旁白主持人的日志里增加一条 `subagent/catalog` 事件（几百字节，回合结束后也可能出现，所以已结束回合的最后一个事件不一定是 `turn/end`）。DSH 同一父智能体最多同时容纳 `maxActiveSubagents` 个子智能体（默认 8），多的会被拒绝，因此 bundle 补丁把它提高到 32，以容纳一轮角色加上记录员、作者和建议。
- **经过测试的版本、使用范围的依赖。** 软件包声明 DSH `>=0.2.2-rc.1 <0.2.3`（`engines.dsh` 与 peer 依赖），而 `devDependencies` 与 workspace override 里的 DSH 子包使用同一范围，而不是某一个准确版本，这样升级 DSH 时它们会跟着走，而不是被落在后面。`scripts/dsh-compat.mjs` 是这些值唯一来源，同时记录已验证过的版本（`DSH_RELEASES`）：只要安装的版本不在这个清单里，`tests/support/dsh-contract.spec.ts` 就会失败。因此支持后续补丁版本意味着：检查该版本的变更、移植所有受影响的集成、在该版本上完成测试，然后才把它加入 `DSH_RELEASES` 并扩大范围。
- **工具执行器。** 从 0.2.2 起 `dsh-tools` 自己不执行任何调用：部署需要挂载一个执行器（`dsh-base` 挂载原生执行器），挂载工具服务的测试要在旁边挂载 `@deepseek-ai/dsh-tool-executor-native`。`ctx.tools.execute` 接受一批调用。
- **模型选择。** DSH 会在 `agent/request` 之前确定提供方、模型和推理强度。因此，创作预设会在智能体创建时验证所配置的推理强度，并通过 `agent.model.select()` 记录下来，不再改写已弃用的请求 hook。
- **DSH 变化时**，重新阅读 `docs/subsystems/subagent.md`，让 `runChild` 与之保持一致；`tests/host/orchestration/loop.spec.ts` 中的真实循环测试通过一个替身 `agentPresets` 服务挂载该辅助插件。

## 回退、归档与删除

- 替换标记使用公开的 `Session.append('user/message', ..., { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs })`，与 DSH 自己的折叠方式相同。它把一段模型对话排除在后续请求外；`surfaceOp: 'append'` 用于添加提示。中间范围之后即使已有新回合也可替换，下一回合第一步中也可执行。DSH 的 Chat 视图不会隐藏被替换的行，因此客户端的 `TurnsDock` 按 DSH 给出的行键自行过滤。被遮蔽的回合不会重新进入对话，重新前进时只添加说明。
- 公开事件 `session/event` 指示回合结束，从而确定它在日志中的位置。
- 客户端通过 `ctx.sessions.fork({ sessionId, atSeq, increaseTitle })` 创建分支，与 DSH 自带分支按钮相同。主机端的公开 `agent/created` 事件串行等待；新智能体的 header 带有 `isSeeded` 和 `parentSession`，会话带有 `inheritedEventCount`。角色扮演会话会在对话首次使用前创建，失败则拒绝分支。
- 归档与恢复使用 DSH 的 `workspaceRegistry.archiveSession`（带 `stopActivity`）和 `unarchiveSession`。
- DSH 没有永久删除对话的公开 API。`host/agent/purge.ts` 在停止并刷新对话后，删除 DSH 保存的目录：`<store>/--<project>--/<session id>/`，包括对话自身及其创建的子智能体会话。子会话通过 `sessionPersistence.list()` 中的 `origin: 'subagent'` 与 `parentSession` 找到。目录名按 DSH JSONL 存储的 `projectKey` 和 `encodeSegment` 规则生成。符号链接、名称不匹配或不含日志的目录会被拒绝。位置由 `sessionStorePath` 配置，默认 `~/.dsh/sessions`。DSH 的工作区计数和投影缓存仍保留该 ID；存在 `delete` 的缓存会收到删除通知，残留条目不会再次列出或读取。操作会发出 DSH 控制器同样使用的 `api-session/removed`。存储布局变化会先由 `tests/host/agent/purge.spec.ts` 和实时删除测试发现。

## 提示词、语言和代表用户发送的消息

- `ctx.systemPrompt.section` 接收每次装配时求值的 `(context) => string`。通过 `dsh-agent` 合并的 `context.agent` 表示当前智能体，因此提示词段可跟随对话语言。预设中 `prefix: ''` 的 `dsh-persona` 行会遮蔽部署 persona，并在渲染时消失，把 persona 段留给本插件。除非设定 `interpolate: false`，段中的 `{{...}}` 会被 DSH 当作提示词变量；本项目的提示词文件无论如何都避免使用它。
- **运行时上下文**（`ctx.systemPrompt.suppressRuntimeContext`、`ctx.systemPrompt.context`）：DSH 会给每个智能体的请求加上一段英文的运行时事实（工作目录、文件策略、审批、委派）。辅助智能体的预设会屏蔽其中可选的部分，并用空内容覆盖必需的工作目录条目，因为辅助智能体只处理故事的文字，没有文件。带着这一段时，要求写中文的辅助智能体常常一直写到输出上限（把记录下的一次反思请求在关闭思考的 35B 上重放：带这一段时四次中只有一次完成，去掉后四次全部完成）。
- `sessionController.prompt(request, signal)` 必须接收 `AbortSignal`，否则 DSH 内部会对 `undefined` 调用 `throwIfAborted`。插件通过它向对话发送普通消息；斜杠命令改走 `ctx.commands.execute`。
- 带开场内容的持久对话必须先以 `surfaceOp: 'append'` 追加一个空 `system/message`，再写其他表面节点。日志格式不允许系统提示词出现在其他节点之后。

## 刻意不用的接口

下面这些 DSH 服务看起来合适，其实不适用；以后复查时不必再推一遍：

- **会话投影（`ctx.sessionProjections`）。** 投影把会话日志折叠成 DSH 随对话推送的状态。故事在会话的 SQLite 里（记录、记忆、时间线），不在日志里，投影搬不动。浏览器从 `/roleplay-api` 读取所需的值。
- **`/api` 的 typert RPC 面。** 第三方服务要在上面提供接口，需要声明契约并生成客户端绑定。`/roleplay-api` 通过 `webServer.register` 注册，和 `/api` 在同一个鉴权连接与 `connection.requestRejection` 栅栏之后；没有会话凭据，浏览器碰不到它。

## 升级 DSH 时

在翻升级指南之前，先跑两个检查。`tests/support/dsh-contract.spec.ts` 读取已安装的声明文件，失败时会直接说出是哪个符号挪走了：`ctx.subagents.startActivation()`、`ctx.tokenMeter`、`SessionSurface.nodes`、`BasicCompactionEngine` 导出、插槽类型仍来自 `@deepseek-ai/dsh-client-store`、会话正文的滚动类名，以及安装版本是否在 `DSH_RELEASES` 里。然后 `pnpm release:check` 检查构建产物：客户端产物必须保持外壳的模块格式（`window.__ModuleLoader__.load({ id, ... })`），只允许 require `react`、`react/jsx-runtime`、`react-dom` 与 `@deepseek-ai/dsh-client-ui-slots`，且不得出现 primitives 或外壳的 store；宿主产物必须把私有模型包内联，且不得导入客户端包。

再阅读升级指南，并逐项核对本页。首先运行类型检查，因为类型就是契约；然后运行 `tests/host/orchestration/loop.spec.ts` 中的真实循环测试。该测试使用脚本模型执行真正的智能体循环、子智能体、工具注册表和上下文折叠。
