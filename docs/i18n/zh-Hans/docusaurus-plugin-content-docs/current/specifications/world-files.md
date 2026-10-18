---
title: 完整世界文件模式
description: 所有世界创作文件的准确字段、限制、默认值、引用和示例。
---

世界是角色扮演根目录 `worlds/` 下的一层文件夹。格式尽量兼容 world-simulation-engine 的导出格式，差异会明确说明。未列出的字段会被忽略，以便文件携带新版本数据。字段缺失、`null` 和空字符串都表示未设置。缺少预期文件的文件夹、普通文件和符号链接会跳过。

```text
worlds/<world folder>/
  world.json
  calendar.json
  characters/<character folder>/character.json
  factions/<faction folder>/faction.json
  locations/<location folder>/location.json
  items/<item folder>/item.json
  lore/<lore id>/lore.json
  plots.json
  variables.json
  triggers.json
```

## `world.json`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 世界的稳定身份，最多 100 字符，在全部世界中唯一。会话通过它引用世界。缺失时首次读取会生成并写回，之后保持不变。重复 ID 会报告，后出现的世界不列出。 |
| `name` | string | 必填。 |
| `description` | string | 世界卡片的提示说明。 |
| `opening_message` | string 或列表 | 可选开场。纯文本视为一段旁白；列表按阅读顺序包含 `{ "type": "narration", "text": "..." }` 或 `{ "type": "utterance", "character": "<character id>", "text": "..." }`。省略 `type` 表示旁白。角色必须存在。会话在玩家输入前直接写入该内容，不调用模型。 |
| `alternate_openings` | 列表 | 其他可选开场，每项为 `{title, text, character?}`；`character` 是某个可扮演角色的 id，带它的开场只提供给扮演该角色的玩家。开始会话时选择，写为首个完成回合。 |
| `starting_time` | ISO 8601 字符串 | 模拟故事起点。无偏移或 `Z` 时按 `time_zone` 的墙上时间解释，只有日期时为当天午夜。缺失则从创建会话的时刻开始。 |
| `rules` | 字符串或字符串列表 | 世界禁止事项，最多 30 条，每条最多 300 字符。开始会话时复制，主持人每回合都能看到；违反规则的玩家行动在故事内失败，违反规则的 OOC 命令被拒绝。 |
| `time_zone` | string | IANA 时区，默认 `UTC`。现实模式未在设置中指定时区时使用计算机时区。 |
| `author` | object | `name` 必填，`url` 可选。作者嵌入此处，不使用独立 `author.json`。 |
| `metadata.tags` | 字符串列表 | 目录标签。 |
| `cover_media_id` | string | 在 `media/manifest.jsonl` 中按 `id` 查找 `file`。文件必须位于世界内，格式为 png、jpg、jpeg、webp、gif 或 avif。缺失时显示占位图。 |
| `narration_voice` | string | 旁白的提供方声音 ID。开始会话时复制，之后可按会话修改。 |
| `variables` | object | 世界范围变量的初值，以变量键为属性。 |

## `calendar.json`

该可选文件定义世界节日及季节所依据的半球。`hemisphere` 为 `north` 或 `south`，默认 `north`。`holidays` 最多 60 项，每项包含唯一的 `id`、显示 `name` 和非空 `on` 日期标记列表。ID 最多 60 字符，由字母、数字、`-` 和 `_` 组成。

`on` 可使用 `mon` 到 `sun`、`jan` 到 `dec`、年度日期 `12-24`、一次性日期 `1912-09-21`、日期区间、`dom:1` 或 `dom:last`、`nth:mon:1` 或 `nth:fri:last`、`season:winter` 以及 `!` 排除项。节日定义不能引用 `holiday:`，避免循环。日程和触发器可通过 `holiday:<id>` 使用已定义节日。开始会话时日历复制到会话元数据。

## `characters/<folder>/character.json`

每个角色一份文件。定义在游玩中不变，`start` 表示故事刚开始后的存档点；后续状态只保存在会话中。

### 定义

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | string | 文件夹名 | 世界内唯一，最多 100 字符，用于世界文件间引用。导入会映射为内部 ID。 |
| `name` | string | | 必填。 |
| `aliases` | 字符串列表 | `[]` | 昵称和其他称呼。头衔由角色行为体现，不列在此处。 |
| `age` | string 或 number | 未设置 | 可用自由文本。 |
| `gender`、`pronouns` | string | 未设置 | 代词可与性别不同。 |
| `kind` | `person` 或 `group` | `person` | group 表示作为一个参与者行动的群体或组织。 |
| `tier` | `principal`、`supporting`、`background` | `principal` | 主角自主行动；配角在场景涉及它时行动；背景角色只在世界变化时反应。 |
| `role` | `playable` 或 `npc` | `npc` | 世界可提供多个可扮演角色。playable 必须是 person 且不能为 background。 |
| `summary` | string | | 列表与预览使用的一两句话。 |
| `personality`、`background`、`appearance` | string | | 分别保存性格、经历和外观。 |
| `speech.style` | string | | 语域、节奏和语言习惯。 |
| `speech.examples` | 字符串列表 | `[]` | 示例台词。 |
| `voice` | string | 未设置 | 角色发言的提供方声音 ID。 |
| `visual_identity` | object | 未设置 | 稳定、与提供方无关的外观。`description` 必填，可选 `tags`、`negative_tags` 和会话内全局唯一的 `global_id`。不包含当前表情、衣着、活动或环境。 |

### `start`

| 字段 | 类型 | 说明 |
|---|---|---|
| `public_state` | string | 在场者可观察或推断的状态。 |
| `inner_state` | string | 只有角色自己知道的思想和感受。 |
| `activity` | string | 角色实际正在做什么，可与表面状态不同。 |
| `emotion.baseline` | object | `valence`、`arousal`、`dominance`，各为 -1 到 1，默认 0。存在 emotion 时必填。 |
| `emotion.immediate` | object | 当前情绪，同一结构；缺失时等于 baseline。 |
| `location` | string | 初始地点 ID；缺失时角色尚无位置。 |
| `position` | string | 地点内的文字位置，需要 `location`。 |
| `feature` | string | 所在地点的特征 ID，需要 `location`。 |
| `intents` | 列表 | 角色驱动力，格式见下文。 |
| `variables` | object | 角色范围变量初值。 |

### `relationships`

可选列表描述本角色指向其他角色的单向看法。另一方向在对方文件中另行定义，也可以不存在。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `to` | string | | 必填，另一角色 ID，每个目标最多一项。 |
| `label` | string | | 必填，一两个词，如 sister、rival。 |
| `summary` | string | | 关系来源和当前状态。 |
| `familiarity` | 0 到 1 | 0 | 从陌生到亲密。 |
| `trust` | -1 到 1 | 0 | 从不信任到完全信任。 |
| `affinity` | -1 到 1 | 0 | 从厌恶到喜爱。 |
| `tension` | 0 到 1 | 0 | 当前紧张程度。 |

每个角色最多 60 项。没有关系表示该角色不知道对方存在。仅知道存在时可用 familiarity 为 0 的中性关系。游玩中见面会建立中性 acquaintance，之后事件可改变标签和印象。

### `knowledge`

可选对象列出角色在开场时知道的非角色实体。知识采用闭世界模型，只表示能识别，不透露当前位置、持有者、内容、在场者或状态，也不会传递展开。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `locations` | ID 列表 | `[]` | 已知地点。起始地点及其可见目的地会自动获知。 |
| `items` | ID 列表 | `[]` | 已知物品。起始地点的可见物和携带物会自动获知。 |
| `exits` | 对象列表 | `[]` | `{ "from", "to" }` 的有向通路，必须有对应世界出口。起始地点可见出口自动获知。 |
| `lore` | ID 列表 | `[]` | 角色设定查询可返回的规范条目。 |

## `factions/<folder>/faction.json`

阵营是具有机构状态和策略的持久组织，不是场景演员。需要让巡逻队、人群或委员会在场景中发言行动时，应使用 `kind: "group"` 的角色。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | string | 文件夹名 | 世界内稳定。 |
| `name` | string | | 必填。 |
| `aliases` | 字符串列表 | `[]` | 其他检索名称。 |
| `summary`、`description` | string | | 简短与详细机构描述。 |
| `values` | 字符串列表 | `[]` | 组织声称或遵循的原则。 |
| `structure` | string | | 组织与领导方式。 |
| `start.public_state` | string | | 可公开观察的机构状态。 |
| `start.inner_state` | string | | 私下压力、争议或政策，不表示集体意识。 |
| `start.goals` | intent 列表 | `[]` | 战略目标，只影响成员，不代替成员行动。 |
| `members` | 列表 | `[]` | `character` 必填，另可含 `role`、`rank`、`status`、`public` 和 0 到 1 的 `commitment`。status 为 active、inactive 或 former，public 默认 true。 |
| `relationships` | 列表 | `[]` | 阵营出发的单向关系。`to` 为 `{ "kind": "character" 或 "faction", "id": "..." }`，其余字段同角色关系。 |

成员关系与外界是否知晓分开。成员会中性地知道所属阵营，其他人是否知道其成员身份由感知和记忆决定。阵营关系始终有方向。

### 意图

| 字段 | 类型 | 默认值 |
|---|---|---|
| `name` | string | 必填 |
| `description` | string | 空 |
| `type` | `need`、`obligation`、`quest`、`agenda`、`aspiration`、`relationship`、`habit`、`reaction` | `agenda` |
| `status` | `active`、`paused`、`completed`、`failed`、`abandoned` | `active` |
| `horizon` | `immediate`、`short`、`day`、`long`、`open_ended` | `short` |
| `priority`、`urgency` | 0 到 1 | `0.5` |
| `plan`、`open_threads`、`constraints` | 字符串列表 | `[]` |
| `deadline` | ISO 8601 日期或日期时间 | 未设置 |

## `variables.json` 与初值

可选列表声明故事需要额外跟踪的值。内建情绪变量为 `valence`、`arousal`、`dominance`。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `key` | string | | 必填，以字母开头，只含小写字母、数字和 `_`。 |
| `name`、`description` | string | | name 必填。 |
| `kind` | `number`、`flag`、`choice` | `number` | |
| `subject` | `character`、`item`、`location`、`world` | `character` | 每个值的对象；world 只有一个全局值。 |
| `only` | ID 列表 | 全部 | 限定可使用该变量的对象。 |
| `min`、`max`、`integer` | 数值设置 | | 数字边界及是否只允许整数。 |
| `options` | 字符串列表 | | choice 的 2 到 12 个选项。 |
| `default` | 对应值 | 0、false 或第一选项 | 未修改时的值。 |
| `baseline` | boolean | false | 是否同时保存基线。 |
| `visibility` | `public`、`private`、`hidden` | `public` | private 只适用于角色变量。 |
| `bands` | `{up_to, label}` 列表 | | 按上限从低到高定义数字范围名称。 |
| `always` | boolean | false | 即使等于默认值也显示。 |

可在此重写内建变量的名称、描述、分段和可见性，但不能改变其本质。最多 60 个变量。初值写在 `character.json`、`item.json`、`location.json` 或 `world.json` 的 `variables` 对象中。角色的 `start.emotion` 设置三个情绪变量的基线和当前值。

### `routine`

`character.json` 的可选日程是按顺序匹配的时间窗，第一个匹配项生效。没有日程的角色停留原处，必要时世界作者可在游玩中补充。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `days` | `mon` 到 `sun` 列表 | 每天 | 跨午夜时间窗属于开始的那一天。 |
| `on` | 日期标记列表 | 每天 | 月份、日期、区间、每月日期、月内第几个星期、季节、节日及 `!` 排除项；与 `days` 同时满足。 |
| `from`、`to` | `HH:MM` | | 必填。to 早于 from 表示跨午夜，相等表示空窗。 |
| `activity` | string | | 必填。 |
| `location`、`feature`、`position` | string | | 地点、特征及文字位置；feature 需要 location。 |
| `interruptible` | boolean | true | 是否会为临时事件中断日程。 |

每个角色最多 24 个时间窗，按对话时区解释。

## `locations/<folder>/location.json`

世界可以没有地点，此时所有人视为在一起。每个地点最多 30 个特征和 30 个出口，世界最多 500 个地点。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | string | 文件夹名 | 世界内唯一。 |
| `name` | string | | 必填。 |
| `description` | string | | 告知所有在场者。 |
| `visual_identity` | object | 未设置 | 与角色相同结构。 |
| `parent` | string | 无 | 容纳该地点的地点 ID，只表达包含关系，不表达通路，不能成环。 |
| `features` | 列表 | `[]` | `{id, name, description}`。ID 只含字母、数字、`-`、`_`，在地点内唯一。每次最多向模型提供 12 个。 |
| `exits` | 列表 | `[]` | 离开此地的有向通路。 |
| `variables` | object | `{}` | 地点变量初值。 |

出口的 `to` 必填。还可含 `description`、`one_way`、`back_description`、整数 `travel_time_seconds`、`state`、`note` 和 `opened_by`。`one_way` 默认 false，会自动生成反向通路。state 为 `open`、`locked` 或 `blocked`，默认 open。锁定出口的 `opened_by` 最多十个物品 ID，并作用于两个方向。角色通常只能沿开放出口移动；故事强制搬运可绕过。开始会话时地点复制到数据库，后续变化不修改世界文件。

## `items/<folder>/item.json`

所有可移动、持有、穿戴、打开或使用的实体都使用 item。不可移动的桌子和窗户应建为地点特征。世界最多 2000 个物品。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | string | 文件夹名 | 世界内唯一。 |
| `name` | string | | 必填。 |
| `description` | string | | |
| `visual_identity` | object | 未设置 | 与角色相同结构。 |
| `quantity` | 正整数 | 1 | 可堆叠物品数量。 |
| `unique` | boolean | false | 唯一物品不能拆分或合并，也没有 quantity。 |
| `quality` | string | | 文字状况。 |
| `notable` | boolean | false | 重要物品优先显示，不从短列表省略。 |
| `hidden` | boolean | false | 找到前无人可见。 |
| `wearable` | string | | 穿戴槽位 ID。 |
| `container` | object | | `state` 为 open、closed 或 locked，默认 closed；`opened_by` 最多十个开启物品 ID。 |
| `owner` | string | | 所有者角色 ID，与当前持有者分开。 |
| `variables` | object | `{}` | 物品变量初值。 |

物品必须且只能以一种方式开始：`location`，可带 `position` 和 `feature`；`held_by`；需要 wearable 的 `worn_by`，可带 position；或指向容器物品的 `inside`。feature 需要 location。

可选 `items/slots.json` 增补或覆盖身体槽位，格式为 `{ "id", "name", "capacity" }` 列表。默认提供 head、face、neck、容量 2 的 torso、back、waist、hands、容量 2 的 wrists、容量 4 的 fingers、legs 和 feet。世界只需声明尾巴、箭袋、翅膀等差异项。槽位属于数据，故事也可在需要时添加。

## 设定资料

规范背景知识位于 `lore/<id>/lore.json`。小条目便于只检索当前场景所需内容，也允许角色只知道私密世界设定的一部分。

字段包括 `id`、`title`、`kind`、`summary`、`body`、`subjects`、`related`、`sources`、`starts_at` 和 `ends_at`。kind 为 `history`、`culture`、`religion`、`politics`、`geography`、`science`、`custom`、`legend` 或 `other`。subject 可引用 character、faction、location、item 或 lore。related 只表示相关，不表示等价。日期是事实适用时间，不是创作时间。sources 用于作者和编辑器追踪来源，不是事实真伪标志。

角色默认不知道任何 lore。应在角色 `knowledge.lore` 中显式列出。游戏主持人可搜索全部规范设定，角色工具只返回有知识边的条目。

## `plots.json`

该可选列表保存开放式剧情脚手架，只描述可能性，不规定必须发生的场景。开始会话时定义复制到元数据，推荐、拒绝和完成进度随后只属于该会话。

每个剧情包含 `id`、`name`、`premise`、`themes`、`participants`、`hooks`、`developments`、`stakes`、`resolutions`、`start` 和 `pacing`。hook 与 development 有自己的 id、text、guidance 和 avoid。development 还包含 mode 和同一剧情内的 prerequisites。

start 为 `dormant`、`available`、`engaged`、`cooling`、`resolved` 或 `abandoned`。mode 为 `opportunity`、`reminder`、`character`、`consequence`、`escalation` 或 `breathing_room`。pacing 可含 `quiet_turns`、`cooldown_turns` 和 `cooldown_days`。冷却只是最短间隔，导演可以更久不推荐；推荐本身不会执行或完成任何内容。没有脚手架的安静会话可让剧情作者基于现有状态生成一份，但生成不表示其中事件已经发生。

## `triggers.json`

触发器描述条件成立时世界自行发生的事。世界最多 200 个。所有角色、地点、物品、变量和其他触发器引用在开始会话时验证，并一次列出全部路径问题。

每项包含最多 64 字符的 `key`、供作者识别且不向模型显示的 `name`、`when`、一到六个 `effects`，以及可选 `announce`、`repeat`、`priority`、`cooldown_seconds`、`chance` 和 `expires`。key 只含小写字母、数字、连字符和下划线。

`when` 条件包括：

- `time`：可含 `from`、`to`、跨午夜的 `window`、`days` 和 `on` 日期标记，均按故事时区解释。
- `place`：角色位于地点及可选特征。
- `variable`：变量与值按 `eq`、`ne`、`lt`、`le`、`gt` 或 `ge` 比较；flag 和 choice 只用 eq、ne。
- `item`：恰好使用 `held_by` 或 `at`，判断物品被角色持有或位于地点，包括容器内。
- `event`：已记录带指定标签的事件。
- `fired`：另一触发器已触发，用于建立序列。
- `judged`：最长 300 字符、无法由结构化记录直接判断的故事陈述。后台模型每回合最多判断 `triggers.judgedPerTurn` 条，未判断前为 false，代码在下次检查时使用判定。
- `all`、`any` 和 `not`：最多嵌套四层，总计最多 24 个部分。

effect 可为 `edit`、`beat` 或 `cue`。edit 使用记录员的编辑格式，原子修改事件、变量、出口、物品、移动、目标和约定。缺少时间、轮次、重要度、标签和涉及角色的事件会使用触发时刻、重要度 3 和空列表。带 location 且未指定 `perceived_by` 的事件由在场角色感知；`perceived_by: "everyone"` 表示所有角色都以被告知方式获知。

beat 交给游戏主持人编入故事，cue 在目标角色下一次行动时提供。受众可用 `characters`，或 `audience: "everyone"`、`{characters: [...]}`、`{place: id}`。beat 和 cue 不一定在触发时立即说出，分别受 `triggers.beatTurns` 与 `triggers.cueTurns` 限制。

文本在实际交付时根据当时状态渲染。可用 `{character:key}`、`{place:key}`、`{item:key}`、`{where:character}`、`{holder:item}`、`{value:variable}`、`{value:variable:subject}` 和 `{time}`。无法识别的模板种类在读取文件时拒绝，其他普通花括号不受影响。`while` 使用与 when 相同的条件语法，但不允许 judged，并必须在交付时仍成立；否则 note 标为 lapsed 并保存撤回原因。引用实体不存在时同样撤回，不猜测。cue 可在 while 和文本中用 `@self` 代表每位受众，beat 和 edit 不可用。

`announce` 区分预定且公开与秘密事件。它包含与 cue 相同形式的 `audience`、只说明公开面的 `text`、可选的 `from` 和 `at`。省略 from 表示从开始便知；at 可从简单 time.from 条件推导。主持人看到所有公告和知情者，角色最多看到自己受众内最近三项。触发、失败或过期后停止显示。没有 announce 时，触发前保持秘密。

触发器在条件由假变真时触发，首次检查已为真时立即触发。检查点为回合开始、每轮后和每次跳时后，按较高 priority 优先，每次最多 `triggers.maxFires` 个。默认只触发一次。`repeat: true` 允许条件先变假再变真后重触发，`cooldown_seconds` 规定故事时间最短间隔。chance 按触发器、回合和轮次确定性取样，重放结果一致，失败的概率检查会消耗本次上升沿。expires 按故事本地时间结束。任何效果无法应用时，触发器标为 failed，不再重试。

## 玩家化身

不属于某个世界的角色位于 `<root>/avatars/characters/<key>/character.json`，媒体位于 `<root>/avatars/images/`。Avatars 标签页通过特殊世界 `@avatars` 使用同一编辑器。新化身只需名称，并设为 playable。

化身可以复制进世界，也可只在开始会话时带入。两种方式使用同一适配：保持 playable，生成世界内唯一 ID，放到世界可扮演角色的起点或第一个地点，只保留指向该世界已有角色的关系，并删除原世界专属的知识、日程和变量。复制进世界时连同肖像写入世界；只带入会话时不修改世界文件。

## `prompts/<language>/<group>/<name>.md`

世界可携带覆盖随附提示词的可选文件。可用 ID 和变量见提示词系统规范。文件指向不存在的提示词、为空或使用未提供变量时，会话开始被拒绝并列出问题。开始会话时，世界提示词复制到会话。

## 尚未属于格式的内容

作者预先写好的记忆和猜测暂不属于世界格式。
