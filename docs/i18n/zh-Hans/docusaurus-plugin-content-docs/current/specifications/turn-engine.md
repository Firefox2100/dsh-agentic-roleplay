---
title: 回合引擎规范
description: 游戏主持人协议、工具、阶段、时间线、分支和后台工作的准确契约。
---

角色扮演会话运行在使用 `roleplay` 智能体预设的 DSH 对话中。对话智能体是游戏主持人；所有非玩家控制角色由游戏主持人工具启动的一次性角色子智能体扮演。预设挂载 `@dsh-agentic-roleplay/core/orchestration`，其工具、钩子和指令只作用于角色扮演对话。

## 回合循环

一个回合包括一条玩家消息、一个或多个角色行动轮次，以及最终输出。

1. 玩家输入后，游戏主持人获得场景状态，`InputValidator` 检查输入。
2. `activate_characters` 开始一轮。主持人客观描述时刻，并从场景中选择确实能接触到该时刻的角色，最多 `maxCharacters` 个。异地角色不会自动感知；世界有地点时，没有位置的角色会被拒绝。角色各自并发返回结构化 `intent`、可选的逐字 `utterance`，以及 `low`、`medium` 或 `high` 的 `commitment`。
3. 主持人综合意图并调用 `resolve_round`，为每个角色提供 `succeeded`、`partial` 或 `failed` 的 `result`、实际发生内容 `summary`、他人可观察的 `public_state`，以及角色无法说出发言时的 `spoken: false`。
4. 失败且 commitment 为 high 的角色可在同一轮再行动一次。它知道其他人的行动和自己的失败结果。重试后不再重试。
5. 本轮结束时，引擎立即应用活动和公开状态，并把轮次可靠地排入记录员队列。只有主持人调用 `record_memory` 时才启动记录员，主持人无需等待。
6. 主持人判断故事是否自然延续。直接回应、自然反应或角色会继续处理的悬而未决事项可以开启下一轮，而且只激活当前时刻需要的角色。否则把控制交还玩家。提示词要求在第一个自然停顿点结束，硬性轮次上限提供兜底。
7. 主持人通过 `narrate` 提交有序的 narration 与 utterance 段。所有轮次中被接受的发言必须逐字、各一次、按说话顺序出现；重试发言取代第一次尝试。同一轮内部可自由排列。检查失败时会列出全部问题并要求重交；两次仍失败后，检查器会恢复原话、删除虚构或重复发言，并把遗漏内容放回对应轮次，标记 `repaired`。成功交付会结束回合，更新 `turns` 和 `lastPlayedAt`。结果编码在 `<roleplay-output>` 及包含 `segments`、`repaired` 的 JSON 中，由转录界面渲染。

关系只影响优先级、风险判断、语气和记忆线索，不形成第二套行动系统。场景给主持人带理由的激活建议，考虑直接点名、是否在场、紧张、不信任和亲近，但不能越过可达性。角色只收到自己指向相关人物的单向关系，并被提醒这是一种可能出错的态度，不是对方动机的证据。记录员只修改具体事件支持的方向和字段，不自动镜像另一方向。阵营目标和关系也只施加压力，不命令成员。

### 节奏与剧情

可选的 `plots.json` 保存带前置条件、风险、结局、指引及禁止建立内容的钩子和发展图。会话进度保存在带命名空间的元数据中，与世界原文件和事件分开。推荐只更新冷却；只有已解决游玩让发展可感知、玩家拒绝它或整个剧情已解决后，才通过 `record_plot_progress` 推进。

每回合开始时，确定性导演先检查近期事件和立即开放的线索。只有超过安静阈值、回合冷却和故事时间冷却后，才向主持人提供一个符合条件的机会。它只是建议，仍受可达性、角色自主、知识和结果规则约束。被拒绝的钩子不会重复推荐，前置条件阻止内容过早出现，剧情无需强制完成。没有脚手架的安静会话可调用 `author_plot`，让一次性子智能体基于当前状态建立分支脚手架；其中内容尚未发生，要等之后的节奏建议才能使用。

世界编辑器可编辑世界和实时会话中的同一套定义。世界保存原子替换 `plots.json`；会话保存替换元数据定义，并保留相同剧情 ID 的进度。所有参与实体 ID 在开始会话和编辑器保存时验证。

`agent/turn-stopping` 钩子阻止尚未交付输出的回合结束，并最多三次把缺失步骤告知主持人，避免顽固模型困住对话。角色子智能体不受此门控制，非角色扮演对话不受影响。

### 记录员

记录员是拥有专属工具的游戏主持人子智能体。它把轮次写入故事数据库，主持人和角色都拿不到这些工具。

- 主持人在决策、揭示、承诺、伤势、关系改变、场景或时间改变等阶段转换时调用 `record_memory`，可用 `focus` 指出重点。小谈话和常规移动无需立即记录。一次运行处理所有等待轮次，并与主持人后续工作并行。`memory.backlogRounds` 默认 6，达到后会在回合结束时自动启动。
- 失败不会进入玩家输出，轮次继续排队。下一次运行会看到已有事件并继续而非重复。主持人主动请求的失败任务在下一回合第一步再试一次。连续三次失败后，相关轮次标为已处理但无记忆，活动、公开状态、地点和物品变化仍保留，避免队列无限增长。
- 事件在验证期间可通过 `event_edits` 和 `event_retractions` 修正，完成后封存。感知和信念仍可修改，`perceptions_added` 可记录角色后来获知旧事件。
- 每次请求前缀是固定 persona，变化内容仅包括设置、待处理轮次、角色状态、近期事件、已写事件和开放线索。工具包括 `edit_records`、`read_records`、`search_events`、`list_threads` 与 `submit_result {complete, notes}`。`edit_records` 原子写入或返回全部问题，也会拒绝未提供轮次的引用。
- 默认的 `memory.verify` 是提交门槛。最后一次修改后，记录员必须用 `read_records` 读回，并检查无依据事件、遗漏、重复、错误感知者、缺少感知、状态泄露思想、无依据信念和失衡重要度。关闭后可在写入后直接提交。`complete: false` 表示仍有问题并使运行失败，最多允许 60 次调用。

可通过 `Committer` 边界替换记录员。未安装记录员时默认 `writesOutcomes`。主持人决定的活动与公开状态由引擎在记录轮次时应用，不交给记录员。

### 角色

每个角色使用相同子智能体结构，固定 persona 包含角色定义和规则，变化提示包含情境、在场者、回忆和已发生内容。开启 `memory.lookup` 时，专属的 `recall_my_memories` 只注册到该角色作用域，并发角色只能访问各自记忆。最终调用 `submit_result {intent, utterance, commitment}`。

### 提供方缓存

每次子智能体请求都先放固定 persona 和固定工具列表，把变化内容放在末尾。测试会断言固定前缀不变。游戏主持人对话在折叠之间也只在尾部增长，方便本地提供方复用前缀缓存。

### 每个对话的轮次限制

同一玩家消息中，以忽略大小写和标点后的同一情境重复询问同一角色会被拒绝。主持人必须说明变化、改问其他角色或交付输出。没有任何角色产出的空轮不计数。

`maxRounds` 范围 1 到 10，默认 3，保存在 `settings.json`。每轮重新读取，因此修改立即生效。达到上限后，`activate_characters` 会被拒绝并要求交付；每个已记录轮次也会告知剩余额度。设置通过 Chat settings 及 `GET`、`PUT /roleplay-api/sessions/settings?id=` 编辑。

## 扩展点

`TurnEngine` 位于 `src/host/orchestration/turn-engine.ts`，不依赖 DSH。可替换行为由 `boundaries.ts` 定义，`defaults.ts` 提供默认实现。`roleplayOrchestration` 服务保存当前实现；插件可调用 `ctx.roleplayOrchestration.replace({ ... })`，从下一次调用开始生效，并取得恢复函数。

| 边界 | 决定内容 | 默认实现 |
|---|---|---|
| `ActivationPlanner` | 激活哪些角色 | 所有非玩家角色，或主持人点名者 |
| `CharacterContextProvider` | 角色的 persona 与变化提示 | 共用场景加角色自身定义 |
| `CharacterOutputValidator` | 角色回答是否可用 | intent 非空 |
| `RetryPolicy` | 谁在首轮后重试 | 失败且 commitment 为 high |
| `InputValidator` | 玩家输入能否开始轮次 | 接受全部输入 |
| `Author` | 必要时创建和整合实体 | 世界作者；未安装时全部拒绝 |
| `Committer` | 写入等待轮次 | 记录员；未安装时为 `writesOutcomes` |
| `Narrator` | 谁写最终输出 | 默认由主持人写 |
| `NarrationChecker` | 发言是否逐字且有序，以及如何修复 | 忽略包裹引号和空白后逐字比较 |
| `SceneContextProvider` | 回合开始时主持人看到什么 | 角色公开状态和活动 |

输入被拒绝时跳过轮次，主持人收到原因并可直接结束。单个角色失败或输出无效只报告给主持人，不阻止其他角色。

## 代码位置

`src/orchestration.ts` 是预设入口，构建为 `lib/orchestration.js`。它由所有使用该预设的对话共享，所以状态必须按对话保存。`tools.ts` 定义工具，`hooks.ts` 定义回合门和场景注入，`character-runner.ts` 启动角色，`store.ts` 映射角色扮演会话并写记录，`prompt.ts` 保存主持人指令。`tests/host/orchestration/` 同时使用假实现测试引擎，并使用脚本模型测试真实 DSH 循环。

## 渲染

`src/client/transcript/` 从 `narrate` 工具结果读取输出；Narrator 边界写入时则读取 `resolve_round` 结果。内容作为会话级节点显示在普通 Chat 中，不折入回合过程。旁白显示为段落，发言显示为带角色名、首字母头像和稳定角色颜色的气泡。修复过的输出带小提示。

本插件不另写自定义日志事件，因为 DSH 会拒绝重新加载包含未知事件类型的会话，追加 API 也不能把事件标为可忽略。

## 开场

世界的 `opening_message` 可以是纯文本，也可以是旁白和世界角色发言列表。新会话在玩家输入前直接显示开场，不调用模型，渲染方式与普通回合相同。系统在智能体创建前，以完成的第一回合和 `narrate` 结果写入日志，再按 ID 接管对话。智能体因此读取正确的回合计数，玩家第一条消息成为第 2 回合。没有开场的对话不变。由于初始已有消息，DSH 会立即按会话名称列出，而不是显示为新会话。

## 地点、世界扩展与物品

`resolve_round.moves_to` 可包含 `location`、`position`、`feature` 和 `ignore_exits`。`TurnStore.checkMove` 检查不可达、锁定或阻塞通路及失败意图，`finishRound` 在同一事务中应用移动。排队的 `RoundRecord` 保存场景 `place` 及各角色的 `at` 和 `moved`。角色只看到自己的地点和同处者，主持人通过 `castSummary` 看到全体位置。

`expand_world {need, what}` 只供主持人使用，并调用 `TurnEngine.expand`。激活与结算之间、原因不属于 `scene_change`、`arrival`、`introduction`、世界关闭或超过每回合上限时拒绝。`Author` 可创建或拒绝；新角色立即进入角色表。交付回合后，`consolidateIfDue` 在后台逐对话运行一次，失败只记录并保留队列。世界作者使用读取工具、`world_lint`、`edit_world`，整合时还使用 `list_consolidation` 与 `resolve_consolidation`。

`item_changes` 先在始终回滚的事务中连续试运行，后一步能看到前一步结果，失败意图不操作物品。正式提交顺序是先处理物品，再移动角色，因此操作发生在角色原位置。结果进入主持人的 `things` 和记录员的 `items`。角色简报含携带物和地点物品，`castSummary` 也得到包含隐藏信息的 `SceneItems`。

## 时间与角色日程

回合开始时更新现实模式时钟并处理日程补进度。每轮结算后调用 `endRound`，模拟模式增加 `elapsed_seconds` 或默认时长，同时受路径 `travel_seconds` 下限约束。`advance_time` 只能在轮次之间调用。时间变化会触发日程移动、到期事项和触发器检查。

角色简报中的 agenda 合并日程窗、约定和目标。离场角色到期事项在回合交付后后台处理。开启 `offstage.joint` 时，同一约定的角色依次回答，后答者会知道谁已经决定前往，避免各自独立猜测。

## 场景预览

开启 `preview.enabled` 时，主持人在判断玩家行动后、激活角色前必须调用 `preview_scene`，以不超过 700 字符的早期叙述显示眼前变化，不替角色决策。每条玩家消息最多一次。缺少预览时，`activate_characters` 和闲置的 `resolve_round` 会被拒绝。结果编码为 `<roleplay-preview>{json}</roleplay-preview>` 并作为会话级 `roleplay-preview` 节点渲染；后续出现 `roleplay-narration` 节点后，旧预览不再显示，但仍保存在日志中。角色看不到预览。关闭该设置时，提示词中没有相关指令，主持人也没有该工具。

## 建议行动与临时说明

交付输出后，`TurnEngine.suggestAfter` 在后台调用 suggester，生成恰好 `suggestions.count` 条玩家可直接发送的第一人称短句，默认 3，0 为关闭。生产实现只看到玩家刚读到的输出、玩家角色和地点，不接触秘密。每条不超过 200 字符，不能为空、不能重复，并在提交前与引擎内各检查一次。

结果作为 `notes` 元数据返回，不进入对话。`GET /roleplay-api/sessions/notes?id=` 提供内容；下回合第一步清空，回合结束后才到达的旧结果丢弃。客户端在输入框上方显示建议标签，并在新输出后约一分钟内每两秒轮询；回合运行中或玩家已经发送新内容后隐藏。`away` note 显示 *Meanwhile* 卡片，`world` note 在会话开始时显示最多八项 `lintWorld` 问题，首回合后清除。

交付后还会运行阵营策略师、触发器判断器和反思。策略师每回合最多处理 `factions.perTurn` 个达到 `factions.everyDays` 冷却且有活动目标的组织，更新状态与目标并写入无人感知的封存事件。判断器每次最多处理 `triggers.judgedPerTurn` 个休眠触发器的 `judged` 陈述，把判定写入 `triggers.judged`，下一次检查仍由代码确定性触发。

反思按 `reflection.*` 设置把角色感知整理为信念。自动反思受 `minTurns`、`everyTurns`、场景变化、`sceneDays`、`perRun` 和 `minNew` 控制。每个角色一次 `runChild`，最多看 40 条感知和 40 条信念。新信念通常需要两个回合或一条重要度至少 4 的事件；新建 `sure` 需要两个回合的支持，降低确信程度需要反驳证据。每个角色最多新增 4 条、总修改 10 条。信念编辑和游标在一个事务中写入。`POST /sessions/reflect?id=` 可手工启动，运行中的回合或反思返回 409，成功接受返回 202。

beat 与 cue 在实际交付时才写入，而不是触发时。`while` 必须在交付时仍成立，模板变量按当时故事状态渲染；失败或引用不存在时标为 lapsed，不凭猜测输出。最近 100 条撤回原因保存在 `triggers.withdrawn` 并显示在设置中。

每个带 trace 的辅助运行把标签、模型、时长、调用次数和错误写入元数据 `activity`，保留最近 60 条。`models.characters`、`models.records`、`models.suggestions` 和 `models.authoring` 可分别选择模型。

## 后台记录与图片

`narrate` 在输出检查后立即返回。记录员、世界整合、离场行动、建议和自动场景图都在后台运行。每个会话一次只写一批记录。新回合的 `judge_action` 与 `preview_scene` 可在旧记录尚未完成时开始；所有需要回忆或修改状态的操作会先调用 `TurnEngine.settle` 等待，并在较晚回合重试一次失败写入。回合开始快照包含 `pending_commits`，回退后仍会恢复等待轮次。`reasoning.children` 控制辅助智能体推理级别。

图片任务遵守 `off`、`manual` 和 `every-turn`。回退取消运行中的任务，图片失败不改变已交付回合。

## 回合中的触发器

引擎在回合第一步、每轮记录后和跳时后调用 `runTriggers`。第一步在时钟补进度之后，因此玩家离开期间成立的条件会触发。每轮后，时间、移动、物品和变量已写入。结果 `TriggerReport` 包含触发器名、事件、cue 和带 ID 的 beat，并进入场景或 `resolve_round`、`advance_time` 结果。

cue 在角色下一次激活时提供，重试仍收到同一内容。`narrate.addressed` 报告已处理 beat，未知 ID 会被拒绝。未采用的 note 在回合开始时按设置失效。触发器应用失败会报告问题并放弃，但一次检查失败不会阻止轮次继续。

`upcoming` 给主持人列出所有已宣布而未触发的事项及知情者，`upcomingFor` 为角色列出受众包含它的最近三项。cue 受众在触发时解析，玩家角色通过主持人获知。

## 玩家输入与脱离角色命令

普通输入在代码层全部接受，但主持人必须先调用 `judge_action`。判定前，`activate_characters`、`resolve_round` 和 `preview_scene` 都会被拒绝。`rule_check` 要求逐条核对世界规则和 `settings.rules.own`。不可行或违反规则的行动在故事内失败；判定不成立时不激活其他角色、不显示预览，玩家角色结果只能为 `failed`。

`judge_action.at` 可声明行动地点。与玩家位置相同、互为包含、角色无位置或世界无地点时，代码不推翻模型判断；完全不同的地点会强制判定失败并说明必须先前往。未知地点键会被拒绝。

以 `/ask` 开头的消息只回答脱离角色的问题。主持人唯一动作是 `ooc_answer`，不能用 `ooc_ruling` 或改变故事。`answerRunner` 只拿到玩家角色可获得的地点、同伴、相关记忆、已知实体、携带物和关系，不拿角色表或秘密，回答最多 1200 字符。随后无 segments 调用 `narrate`，输出标记 `legal: true` 和 `question: true`。

以 `/ooc` 开头的命令单独占一个回合。它不显示预览，也不激活角色。主持人先用 `ooc_ruling(rule_check, legal, reason)` 判断，只受世界规则和玩家规则约束。合法命令可创建内容、强制任意角色行动或移动、改变变量和推进时间，但仍通过普通状态检查。非法判定前后都不能修改状态。强制结果写成 decree 轮次，记录员只记录角色经历的事实，不记录命令来源。该回合仍可回退、重新生成和分支。

## 回退故事

`<session>/timeline.json` 是数据库外的追加树，每个 `TimelineNode` 保存父节点、玩家消息 `userSeq`、回合范围、输入、输出和回合后状态快照名，`head` 指向当前故事位置。回合开始、交付和日志结束时分别补充节点。`TurnEngine.quiesce` 等待记录、整合和离场角色稳定后，把状态保存为 `snapshots/after-<id>.sqlite`。`start` 保存首回合前状态。`rewind.keepSnapshots` 默认保留最近 30 个；没有快照的回合不能返回。

`Timelines.move` 取消运行任务、释放连接并从快照恢复数据库。离开的回合在模型对话中被替换为标记，重新进入的回合各用一次提示说明；日志本身只追加。客户端提供 regenerate、rewind、切换同一父节点下的版本和 forward。HTTP 接口为 `GET /roleplay-api/sessions/timeline?id=` 与 `POST .../timeline/move?id=&to=`，`start` 表示起点，没有状态时返回 409。

## 故事分支

分支是在独立对话中，从某回合后的状态建立新会话，原会话不变。DSH 先创建截止到切点的 `session-<uuid>` 对话。主机监听 `agent/created`，通过 `Timelines.adopt` 和 `roleplayState.fork` 复制相应快照、设置、保留快照、继承时间线，并改写新会话身份和递增名称。没有可用切点状态时拒绝且不创建。打开新对话后要求玩家命名，并同步修改对话标题。非角色扮演对话的分支仍完全由 DSH 处理。

## 归档与删除

`POST /sessions/archive` 停止并隐藏对话，在数据库旁写入带 `archivedAt` 的 `status.json`。会话仍在列表中显示为已归档，恢复前打开会返回 409。`POST /sessions/restore` 只由角色扮演 Sessions 页面提供。`DELETE /sessions/item` 先删除对话及其启动的子智能体日志，再删除会话目录；对话未能完全清除时保留会话，允许重试。

## 回合耗时报告

`node scripts/turn-report.mjs <roleplay session uuid> [turns]` 读取 DSH 日志，需要系统中的 `zstd`，并报告最近回合总耗时、首请求等待、主持人每次调用及拒绝，以及并行运行的角色、记录员、作者和建议任务。

## 主持人直接引入的物品

`introduce_thing` 可立即创建故事即将使用的普通物品，例如路障、工具或纸条，无需调用世界作者。它可放在地点、默认的玩家处、某人手中或容器中。每回合受 `authoring.thingsPerTurn` 限制，默认 4，0 为关闭；封闭世界不可用。创建物品仍进入整合队列。复杂或重要到需要专门设计的物品继续使用 `expand_world` 的 `object` 原因。
