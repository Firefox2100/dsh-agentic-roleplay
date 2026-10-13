import { prefixed, withDictionaries, type Dictionaries } from '../i18n.ts'
import { dictionaries as galleryDictionaries, type GalleryLocaleKey } from '../widgets/gallery-view/locales.ts'

type OwnKey =
  | 'language' | 'sectionInfo' | 'sectionPrompts' | 'sectionImages' | 'infoTags' | 'infoTagsHelp' | 'infoRules' | 'infoRulesHelp' | 'infoOpening' | 'infoOpeningHelp' | 'infoOpeningParts' | 'infoStory' | 'sectionRoutines' | 'sectionVariables' | 'routinesNoCharacters' | 'routinesHelp' | 'routineFrom' | 'routineTo' | 'routineActivity' | 'routineDays' | 'routineDaysHelp' | 'routinePlace' | 'routineNoPlace' | 'routineFeature' | 'routinePosition' | 'routineInterruptible' | 'routineRemove' | 'routineAdd' | `day_${'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'}`
  | 'variablesHelp' | 'variablesNone' | 'variableKey' | 'variableKind' | 'variableSubject' | 'variableVisibility' | 'variableMin' | 'variableMax' | 'variableDefault' | 'variableOptions' | 'variableOnly' | 'variableBands' | 'variableBandsHelp' | 'variableInteger' | 'variableBaseline' | 'variableAlways' | 'variableRemove' | 'variableAdd' | `variableKind_${'number' | 'flag' | 'choice'}` | `variableSubject_${'character' | 'item' | 'location' | 'world'}` | `variableVisibility_${'public' | 'private' | 'hidden'}`
  | 'infoAlternates' | 'infoAlternatesHelp' | 'infoAlternateTitle' | 'infoAlternateText' | 'infoAlternateAdd' | 'infoAlternateRemove' | 'infoAuthor' | 'infoAuthorUrl' | 'infoTimeZone' | 'infoTimeZoneHelp' | 'infoStartingTime' | 'infoStartingTimeHelp' | 'infoVersion' | 'infoVersionHelp'
  | 'promptsLanguage' | 'promptsHelp' | 'promptProse' | 'promptRules' | 'promptCarried' | 'promptOwnText' | 'promptShippedText' | 'promptRulesWarning' | 'promptRevert'
  | 'tab' | 'noPlayableWarning' | 'editorLoading' | 'editorLoadFailed' | 'notRoleplay' | 'editorRefresh' | 'sections' | 'soon'
  | 'characters' | 'places' | 'things' | 'factions' | 'lore' | 'noLore' | 'loreAdd' | 'loreAddConfirm' | 'loreRemove' | 'loreRemoveConfirm' | 'loreTitle' | 'loreBody' | 'subjects' | 'relatedLore' | 'sources' | 'plots' | 'plotsHelp' | 'plotsJson' | 'addPlot' | 'plotProgress' | 'introduced' | 'rejected' | 'noCharacters' | 'portraitMissing' | 'portraitUpload' | 'portraitGenerate' | 'portraitGenerating' | 'portraitRetry' | 'portraitFailed' | 'portraitSaveFirst' | 'portraitIdentityRequired'
  | 'playable' | 'npc' | 'principal' | 'supporting' | 'background' | 'person' | 'group' | 'player' | 'agent'
  | 'name' | 'age' | 'gender' | 'pronouns' | 'aliases' | 'aliasesHelp' | 'role' | 'tier' | 'kind' | 'control' | 'where' | 'noPlace' | 'position' | 'doing'
  | 'summary' | 'personality' | 'backgroundText' | 'appearance' | 'speech' | 'speechStyle' | 'speechExamples' | 'speechExamplesHelp'
  | 'visualIdentity' | 'visualDescription' | 'visualDescriptionHelp' | 'visualTags' | 'visualTagsHelp' | 'visualNegativeTags' | 'visualGlobalId'
  | 'state' | 'publicState' | 'innerState' | 'activity' | 'goals' | 'noGoals' | 'goalName' | 'goalDescription' | 'goalStatus' | 'goalPriority'
  | 'active' | 'paused' | 'completed' | 'failed' | 'abandoned'
  | 'unsaved' | 'save' | 'saving' | 'saved' | 'reset' | 'saveFailed' | 'invalidName' | 'invalidPlayable' | 'invalidPriority' | 'back'
  | 'noPlaces' | 'noThings' | 'description' | 'insidePlace' | 'insideNothing' | 'ownerLabel' | 'ownerNobody' | 'features' | 'featureId' | 'addFeature' | 'removeFeature' | 'quantity' | 'quality' | 'notable' | 'hidden' | 'containerState' | 'open' | 'closed' | 'locked' | 'unique' | 'heldAt' | 'wearableAt' | 'ownedBy'
  | 'noFactions' | 'factionValues' | 'factionStructure' | 'members' | 'noMembers' | 'relationships' | 'inactive' | 'former'
  | 'voice' | 'voiceHelp' | 'narrationVoice'
  | 'allRelations' | 'relationCharacter' | 'relationKnowledge' | 'relationMembership' | 'relationSocial' | 'relationExit' | 'noRelations' | 'removeRelation' | 'removeRelationConfirm' | 'knowledgeNotice'
  | 'location' | 'item' | 'faction' | 'exit' | 'rank' | 'commitment' | 'publicMembership' | 'blocked' | 'travelSeconds' | 'note' | 'relationLabel' | 'familiarity' | 'trust' | 'affinity' | 'tension'
  | 'perspective' | 'objectiveWorld' | 'listView' | 'graphView' | 'addRelation' | 'from' | 'to' | 'relationCancel' | 'relationCreate'

const own: Dictionaries<OwnKey> = {
  en: {
    language: 'en', sectionInfo: 'About', sectionPrompts: 'Prompts', sectionImages: 'Images',
    infoTags: 'Tags', infoTagsHelp: 'Separated by commas. They help people decide whether to play it.',
    infoRules: 'Rules of the world', infoRulesHelp: 'One short rule per line, for example "There is no magic". The game master checks what the player does against them.',
    infoOpening: 'Opening message', infoOpeningHelp: 'What the story begins with, before the player says anything. Leave empty for none.',
    infoOpeningParts: 'This opening has lines spoken by characters, so it cannot be edited here as plain text. Change it in the file, or ask the authoring assistant.',
    sectionRoutines: 'Daily life', sectionVariables: 'Tracked values', routinesNoCharacters: 'This world has no characters yet.',
    routinesHelp: 'The day a character normally lives: what it does, where and when. A routine is a default, not a rail: commitments and events override it. Characters away from the player follow it as time passes.',
    routineFrom: 'From', routineTo: 'Until', routineActivity: 'Activity', routineDays: 'Days', routineDaysHelp: 'None ticked means every day. A window that ends before it starts runs past midnight.', routinePlace: 'Place', routineNoPlace: 'None', routineFeature: 'Spot in the place', routinePosition: 'Where exactly', routineInterruptible: 'Would drop it for something that comes up', routineRemove: 'Remove window', routineAdd: 'Add a window',
    day_mon: 'Mon', day_tue: 'Tue', day_wed: 'Wed', day_thu: 'Thu', day_fri: 'Fri', day_sat: 'Sat', day_sun: 'Sun',
    variablesHelp: 'What the story tracks besides feelings: numbers, flags and choices about characters, things, places or the world. Values are set in the files of whatever has them; a value that no longer fits blocks the change.',
    variablesNone: 'This world declares nothing of its own.', variableKey: 'Key', variableKind: 'Kind', variableSubject: 'About', variableVisibility: 'Who can tell', variableMin: 'Least', variableMax: 'Most', variableDefault: 'Starts as', variableOptions: 'Options (comma separated)', variableOnly: 'Only for (keys, comma separated; empty for all)', variableBands: 'How it is told', variableBandsHelp: 'One per line, “up to: words”, for example “3: low”.', variableInteger: 'Whole numbers', variableBaseline: 'Has a temperament that it drifts back to', variableAlways: 'Always shown', variableRemove: 'Remove', variableAdd: 'Add a variable',
    variableKind_number: 'Number', variableKind_flag: 'Flag', variableKind_choice: 'Choice', variableSubject_character: 'A character', variableSubject_item: 'A thing', variableSubject_location: 'A place', variableSubject_world: 'The world', variableVisibility_public: 'Anyone present', variableVisibility_private: 'Only itself', variableVisibility_hidden: 'Nobody (game master only)',
    infoAlternates: 'Other openings', infoAlternatesHelp: 'Other ways the story can begin. The player picks one when starting a session; each is one narration, shown instead of the opening message.', infoAlternateTitle: 'Title', infoAlternateText: 'Narration', infoAlternateAdd: 'Add an opening', infoAlternateRemove: 'Remove',
    infoStory: 'Author and time', infoAuthor: 'Author', infoVersion: 'Version', infoVersionHelp: 'Your own label for this release of the world, such as 1.2. It is recorded in the sessions started from it.', infoAuthorUrl: 'Author link', infoTimeZone: 'Time zone', infoTimeZoneHelp: 'An IANA name such as Europe/London. Empty means UTC.',
    infoStartingTime: 'Story starts at', infoStartingTimeHelp: 'Date and time in that zone, like 1912-04-14T23:40:00.',
    promptsLanguage: 'Language', promptsHelp: 'The instructions the models are given. A prompt the world carries replaces the shipped one in every session started from this world afterwards; sessions already started keep theirs.',
    promptProse: 'Style', promptRules: 'Rules', promptCarried: 'This world\'s own', promptOwnText: 'This world carries its own version.', promptShippedText: 'Showing the shipped text; saving makes it this world\'s own.',
    promptRulesWarning: 'This prompt holds the rules of the game and how the tools are used. Change it only when you know what the models are told; ${name} marks values the program fills in and must stay.', promptRevert: 'Use the shipped one',
    tab: 'World', noPlayableWarning: 'This world has no playable character, so a session cannot be started. Add one, or ask the authoring assistant to.', editorLoading: 'Loading the world…', editorLoadFailed: 'Could not load the world: {message}', notRoleplay: 'This chat is not a roleplay session, so it has no world.',
    editorRefresh: 'Refresh', sections: 'Parts of the world', soon: 'Not built yet',
    lore: 'Lore', noLore: 'This story has no authored lore.', loreAdd: 'Add entry', loreAddConfirm: 'Create', loreRemove: 'Remove entry', loreRemoveConfirm: 'Remove this entry (kept in the world’s trash folder)', loreTitle: 'Title', loreBody: 'Canonical account', subjects: 'Subjects', relatedLore: 'Related lore', sources: 'Sources', plots: 'Plots', plotsHelp: 'Optional possibilities, not a required storyline. Edit the validated plots.json structure below; removing an entry removes the scaffold, not events that already happened.', plotsJson: 'Plot definitions as JSON', addPlot: 'Add plot', plotProgress: 'Session progress', introduced: 'Introduced', rejected: 'Rejected',
    characters: 'Characters', places: 'Places', things: 'Things', factions: 'Factions', noCharacters: 'This story has no characters.', portraitMissing: 'No portrait', portraitUpload: 'Upload a PNG portrait', portraitGenerate: 'Generate portrait', portraitGenerating: 'Generating…', portraitRetry: 'Regenerate portrait', portraitFailed: 'Could not generate portrait: {message}', portraitSaveFirst: 'Save the visual identity before generating.', portraitIdentityRequired: 'Add and save a visual identity before generating a portrait.',
    playable: 'Playable', npc: 'Character', principal: 'Principal', supporting: 'Supporting', background: 'Background', person: 'Person', group: 'Group', player: 'You play', agent: 'Played by an agent',
    name: 'Name', age: 'Age', gender: 'Gender', pronouns: 'Pronouns', aliases: 'Also called', aliasesHelp: 'Separate names with commas.', role: 'Role', tier: 'Part in the story', kind: 'Kind', control: 'Played by',
    where: 'Place', noPlace: 'No place', position: 'Where in it', doing: 'Doing',
    summary: 'Summary', personality: 'Personality', backgroundText: 'Background', appearance: 'Appearance', speech: 'Speech', speechStyle: 'Style', speechExamples: 'Examples', speechExamplesHelp: 'One example per line.',
    visualIdentity: 'Visual identity', visualDescription: 'Canonical appearance', visualDescriptionHelp: 'Stable physical facts only; leave out expression, pose, current clothing, lighting and surroundings.', visualTags: 'Stable traits', visualTagsHelp: 'Separate traits with commas.', visualNegativeTags: 'Avoid', visualGlobalId: 'Global identity ID',
    state: 'State', publicState: 'What others can see', innerState: 'Inner state', activity: 'Activity', goals: 'Goals', noGoals: 'No goals yet.',
    goalName: 'Goal', goalDescription: 'Description', goalStatus: 'Status', goalPriority: 'Priority (0 to 1)',
    active: 'Active', paused: 'Paused', completed: 'Completed', failed: 'Failed', abandoned: 'Abandoned',
    unsaved: 'Unsaved changes', save: 'Save', saving: 'Saving…', saved: 'Saved', reset: 'Discard changes', saveFailed: 'Could not save: {message}',
    invalidName: 'A name is needed.', invalidPlayable: 'A playable character must be a person and not a background character.', invalidPriority: 'A number from 0 to 1.', back: 'Back to the worlds',
    noPlaces: 'This story has no places.', noThings: 'This story has no things.', description: 'Description', insidePlace: 'Inside', insideNothing: '(not inside another place)', ownerLabel: 'Belongs to', ownerNobody: '(no one)', features: 'Features', featureId: 'Feature ID', addFeature: 'Add feature', removeFeature: 'Remove feature', quantity: 'Quantity', quality: 'Condition', notable: 'Always notable', hidden: 'Hidden', containerState: 'Container state', open: 'Open', closed: 'Closed', locked: 'Locked', unique: 'Unique', heldAt: 'At: {holder}', wearableAt: 'Wearable: {slot}', ownedBy: 'Owned by {owner}',
    noFactions: 'This story has no factions.', factionValues: 'Values', factionStructure: 'Structure', members: 'Members', noMembers: 'No members.', relationships: 'Relationships', inactive: 'Inactive', former: 'Former',
    voice: 'Voice', voiceHelp: 'Choose a listed provider voice or enter a voice id manually.', narrationVoice: 'Narrator voice', allRelations: 'All', relationCharacter: 'Character', relationKnowledge: 'Knowledge', relationMembership: 'Membership', relationSocial: 'Social', relationExit: 'Routes', noRelations: 'No matching relations.', removeRelation: 'Remove', removeRelationConfirm: 'Remove this relation? This cannot be undone.', knowledgeNotice: 'This explicit record means the character knows that the target exists. Remove it to make the target unknown.',
    location: 'Place', item: 'Thing', faction: 'Faction', exit: 'Route', rank: 'Rank', commitment: 'Commitment', publicMembership: 'Public membership', blocked: 'Blocked', travelSeconds: 'Travel time (seconds)', note: 'Note', relationLabel: 'Relationship', familiarity: 'Familiarity', trust: 'Trust', affinity: 'Affinity', tension: 'Tension',
    perspective: 'View as', objectiveWorld: 'Objective world', listView: 'List', graphView: 'Graph', addRelation: 'Add relation', from: 'From', to: 'To', relationCancel: 'Cancel', relationCreate: 'Create',
  },
  zh: {
    language: 'zh', sectionInfo: '关于', sectionPrompts: '提示词', sectionImages: '图片',
    infoTags: '标签', infoTagsHelp: '用逗号分隔，帮助人们决定是否游玩。',
    infoRules: '世界规则', infoRulesHelp: '每行一条简短规则，例如“这里没有魔法”。主持人会据此检查玩家的行动。',
    infoOpening: '开场白', infoOpeningHelp: '玩家开口之前故事的开头。留空表示没有。',
    infoOpeningParts: '这段开场白含有角色说的话，因此不能在这里按纯文本编辑。请在文件中修改，或请创作助手处理。',
    sectionRoutines: '日常', sectionVariables: '追踪数值', routinesNoCharacters: '这个世界还没有角色。',
    routinesHelp: '角色平时的一天：做什么、在哪里、何时。日程只是默认值而非轨道：约定和事件会覆盖它。不在玩家身边的角色会随时间推移按日程行动。',
    routineFrom: '从', routineTo: '到', routineActivity: '活动', routineDays: '星期', routineDaysHelp: '都不勾选表示每天。结束早于开始的时段会跨过午夜。', routinePlace: '地点', routineNoPlace: '无', routineFeature: '地点中的位置', routinePosition: '具体位置', routineInterruptible: '有事发生时会放下它', routineRemove: '移除时段', routineAdd: '添加时段',
    day_mon: '周一', day_tue: '周二', day_wed: '周三', day_thu: '周四', day_fri: '周五', day_sat: '周六', day_sun: '周日',
    variablesHelp: '故事在情绪之外追踪的内容：关于角色、物品、地点或世界的数值、开关和选项。数值写在持有者各自的文件中；已有数值不再符合时会阻止修改。',
    variablesNone: '这个世界没有自己声明的内容。', variableKey: '键', variableKind: '类型', variableSubject: '针对', variableVisibility: '谁能知道', variableMin: '最小', variableMax: '最大', variableDefault: '初始为', variableOptions: '选项（逗号分隔）', variableOnly: '仅限（键，逗号分隔；留空表示全部）', variableBands: '如何描述', variableBandsHelp: '每行一条，“上限: 文字”，例如“3: 低”。', variableInteger: '仅整数', variableBaseline: '有气质基线并会回归', variableAlways: '始终显示', variableRemove: '移除', variableAdd: '添加变量',
    variableKind_number: '数值', variableKind_flag: '开关', variableKind_choice: '选项', variableSubject_character: '角色', variableSubject_item: '物品', variableSubject_location: '地点', variableSubject_world: '世界', variableVisibility_public: '在场者皆可', variableVisibility_private: '仅自己', variableVisibility_hidden: '无人（仅主持人）',
    infoAlternates: '其他开场', infoAlternatesHelp: '故事的其他开始方式。玩家开始会话时选择其一；每个都是一段叙述，会代替开场白显示。', infoAlternateTitle: '标题', infoAlternateText: '叙述', infoAlternateAdd: '添加开场', infoAlternateRemove: '移除',
    infoStory: '作者与时间', infoAuthor: '作者', infoVersion: '版本', infoVersionHelp: '你为这个版本的世界取的标记，例如 1.2；从它开始的会话会记录这个版本。', infoAuthorUrl: '作者链接', infoTimeZone: '时区', infoTimeZoneHelp: 'IANA 名称，例如 Europe/London；留空为 UTC。',
    infoStartingTime: '故事开始于', infoStartingTimeHelp: '该时区的日期和时间，例如 1912-04-14T23:40:00。',
    promptsLanguage: '语言', promptsHelp: '提供给模型的指令。世界自带的提示词会替换此后由该世界开始的每个会话中的默认提示词；已开始的会话保留原来的。',
    promptProse: '文风', promptRules: '规则', promptCarried: '本世界自带', promptOwnText: '本世界带有自己的版本。', promptShippedText: '显示的是默认文本；保存后会成为本世界自己的版本。',
    promptRulesWarning: '这条提示词包含游戏规则和工具的用法。只有在清楚模型被告知了什么时才修改；${name} 是程序填入的值，必须保留。', promptRevert: '改用默认版本',
    tab: '世界', noPlayableWarning: '这个世界没有可扮演的角色，因此无法开始会话。请添加一个，或让创作助手添加。', editorLoading: '正在载入世界…', editorLoadFailed: '无法载入世界：{message}', notRoleplay: '这个对话不是角色扮演会话，没有世界。',
    editorRefresh: '刷新', sections: '世界的各部分', soon: '尚未实现',
    lore: '世界设定', noLore: '这个故事还没有已编写的世界设定。', loreAdd: '添加条目', loreAddConfirm: '创建', loreRemove: '移除条目', loreRemoveConfirm: '确认移除（保留在世界的回收文件夹中）', loreTitle: '标题', loreBody: '规范记载', subjects: '相关实体', relatedLore: '相关设定', sources: '来源', plots: '情节', plotsHelp: '这些是可选的发展可能，并非必须遵循的剧情线。可在下方编辑经验证的 plots.json 结构；删除条目只会删除情节框架，不会删除已经发生的事件。', plotsJson: 'JSON 格式的情节定义', addPlot: '添加情节', plotProgress: '会话进度', introduced: '已引入', rejected: '已拒绝',
    characters: '角色', places: '地点', things: '物品', factions: '阵营', noCharacters: '这个故事没有角色。', portraitMissing: '暂无肖像', portraitUpload: '上传 PNG 肖像', portraitGenerate: '生成肖像', portraitGenerating: '正在生成…', portraitRetry: '重新生成肖像', portraitFailed: '无法生成肖像：{message}', portraitSaveFirst: '请先保存视觉身份。', portraitIdentityRequired: '请先添加并保存视觉身份，再生成肖像。',
    playable: '可扮演', npc: '角色', principal: '主要', supporting: '次要', background: '背景', person: '个人', group: '群体', player: '由你扮演', agent: '由智能体扮演',
    name: '名称', age: '年龄', gender: '性别', pronouns: '代词', aliases: '又称', aliasesHelp: '用逗号分隔多个名字。', role: '身份', tier: '戏份', kind: '类型', control: '扮演者',
    where: '地点', noPlace: '不在任何地点', position: '具体位置', doing: '正在做',
    summary: '简介', personality: '性格', backgroundText: '背景', appearance: '外貌', speech: '言谈', speechStyle: '风格', speechExamples: '示例', speechExamplesHelp: '每行一个示例。',
    visualIdentity: '视觉身份', visualDescription: '规范外观', visualDescriptionHelp: '只写跨场景保持稳定的外观；不要写表情、姿势、当前衣着、光线或环境。', visualTags: '稳定特征', visualTagsHelp: '用逗号分隔。', visualNegativeTags: '避免出现', visualGlobalId: '全局身份 ID',
    state: '状态', publicState: '旁人可见', innerState: '内心', activity: '活动', goals: '目标', noGoals: '暂无目标。',
    goalName: '目标', goalDescription: '描述', goalStatus: '状态', goalPriority: '优先级（0 到 1）',
    active: '进行中', paused: '已暂停', completed: '已完成', failed: '已失败', abandoned: '已放弃',
    unsaved: '有未保存的更改', save: '保存', saving: '正在保存…', saved: '已保存', reset: '放弃更改', saveFailed: '无法保存：{message}',
    invalidName: '需要填写名称。', invalidPlayable: '可扮演的角色必须是个人，且不能是背景角色。', invalidPriority: '请填 0 到 1 之间的数。', back: '返回世界列表',
    noPlaces: '这个故事没有地点。', noThings: '这个故事没有物品。', description: '描述', insidePlace: '位于', insideNothing: '（不在其他地点内）', ownerLabel: '归属', ownerNobody: '（无人）', features: '地点特征', featureId: '特征 ID', addFeature: '添加特征', removeFeature: '删除特征', quantity: '数量', quality: '状态', notable: '始终重要', hidden: '隐藏', containerState: '容器状态', open: '打开', closed: '关闭', locked: '上锁', unique: '唯一', heldAt: '所在：{holder}', wearableAt: '可穿戴：{slot}', ownedBy: '属于 {owner}',
    noFactions: '这个故事没有阵营。', factionValues: '价值观', factionStructure: '组织结构', members: '成员', noMembers: '暂无成员。', relationships: '关系', inactive: '不活跃', former: '前成员',
    voice: '声音', voiceHelp: '可选择提供方列出的声音，也可手动输入声音标识。', narrationVoice: '旁白声音', allRelations: '全部', relationCharacter: '角色关系', relationKnowledge: '知识', relationMembership: '成员关系', relationSocial: '社会关系', relationExit: '路径', noRelations: '没有符合条件的关系。', removeRelation: '删除关系', removeRelationConfirm: '确定删除这条关系吗？此操作无法撤销。', knowledgeNotice: '这条显式记录表示该角色知道目标存在。删除后，目标对该角色即为未知。',
    location: '地点', item: '物品', faction: '阵营', exit: '路径', rank: '等级', commitment: '投入程度', publicMembership: '公开成员身份', blocked: '受阻', travelSeconds: '通行时间（秒）', note: '备注', relationLabel: '关系称谓', familiarity: '熟悉度', trust: '信任', affinity: '好感', tension: '紧张度',
    perspective: '视角', objectiveWorld: '客观世界', listView: '列表', graphView: '关系图', addRelation: '添加关系', from: '起点', to: '目标', relationCancel: '取消', relationCreate: '创建',
  },
}

export type WorldLocaleKey = OwnKey | `gallery_${GalleryLocaleKey}`

export const dictionaries: Dictionaries<WorldLocaleKey> = withDictionaries(own, prefixed(galleryDictionaries, 'gallery_'))
