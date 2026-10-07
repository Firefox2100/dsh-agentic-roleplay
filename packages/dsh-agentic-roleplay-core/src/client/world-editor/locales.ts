import type { Dictionaries } from '../i18n.ts'

export type WorldLocaleKey =
  | 'tab' | 'editorLoading' | 'editorLoadFailed' | 'notRoleplay' | 'editorRefresh' | 'sections' | 'soon'
  | 'characters' | 'places' | 'things' | 'factions' | 'noCharacters' | 'portraitMissing' | 'portraitGenerate' | 'portraitGenerating' | 'portraitRetry' | 'portraitFailed' | 'portraitSaveFirst' | 'portraitIdentityRequired'
  | 'playable' | 'npc' | 'principal' | 'supporting' | 'background' | 'person' | 'group' | 'player' | 'agent'
  | 'name' | 'age' | 'gender' | 'pronouns' | 'aliases' | 'aliasesHelp' | 'role' | 'tier' | 'kind' | 'control' | 'where' | 'noPlace' | 'position' | 'doing'
  | 'summary' | 'personality' | 'backgroundText' | 'appearance' | 'speech' | 'speechStyle' | 'speechExamples' | 'speechExamplesHelp'
  | 'visualIdentity' | 'visualDescription' | 'visualDescriptionHelp' | 'visualTags' | 'visualTagsHelp' | 'visualNegativeTags' | 'visualGlobalId'
  | 'state' | 'publicState' | 'innerState' | 'activity' | 'goals' | 'noGoals' | 'goalName' | 'goalDescription' | 'goalStatus' | 'goalPriority'
  | 'active' | 'paused' | 'completed' | 'failed' | 'abandoned'
  | 'unsaved' | 'save' | 'saving' | 'saved' | 'reset' | 'saveFailed' | 'invalidName' | 'invalidPlayable' | 'invalidPriority' | 'back'
  | 'noPlaces' | 'noThings' | 'description' | 'insidePlace' | 'features' | 'featureId' | 'addFeature' | 'removeFeature' | 'quantity' | 'quality' | 'notable' | 'hidden' | 'containerState' | 'open' | 'closed' | 'locked' | 'unique' | 'heldAt' | 'wearableAt' | 'ownedBy'
  | 'noFactions' | 'factionValues' | 'factionStructure' | 'members' | 'noMembers' | 'relationships' | 'inactive' | 'former'
  | 'allRelations' | 'relationCharacter' | 'relationKnowledge' | 'relationMembership' | 'relationSocial' | 'relationExit' | 'noRelations' | 'removeRelation' | 'removeRelationConfirm' | 'knowledgeNotice'
  | 'location' | 'item' | 'faction' | 'exit' | 'rank' | 'commitment' | 'publicMembership' | 'blocked' | 'travelSeconds' | 'note' | 'relationLabel' | 'familiarity' | 'trust' | 'affinity' | 'tension'
  | 'perspective' | 'objectiveWorld' | 'listView' | 'graphView' | 'addRelation' | 'from' | 'to' | 'relationCancel' | 'relationCreate'

export const dictionaries: Dictionaries<WorldLocaleKey> = {
  en: {
    tab: 'World', editorLoading: 'Loading the world…', editorLoadFailed: 'Could not load the world: {message}', notRoleplay: 'This chat is not a roleplay session, so it has no world.',
    editorRefresh: 'Refresh', sections: 'Parts of the world', soon: 'Not built yet',
    characters: 'Characters', places: 'Places', things: 'Things', factions: 'Factions', noCharacters: 'This story has no characters.', portraitMissing: 'No portrait', portraitGenerate: 'Generate portrait', portraitGenerating: 'Generating…', portraitRetry: 'Regenerate portrait', portraitFailed: 'Could not generate portrait: {message}', portraitSaveFirst: 'Save the visual identity before generating.', portraitIdentityRequired: 'Add and save a visual identity before generating a portrait.',
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
    noPlaces: 'This story has no places.', noThings: 'This story has no things.', description: 'Description', insidePlace: 'Inside', features: 'Features', featureId: 'Feature ID', addFeature: 'Add feature', removeFeature: 'Remove feature', quantity: 'Quantity', quality: 'Condition', notable: 'Always notable', hidden: 'Hidden', containerState: 'Container state', open: 'Open', closed: 'Closed', locked: 'Locked', unique: 'Unique', heldAt: 'At: {holder}', wearableAt: 'Wearable: {slot}', ownedBy: 'Owned by {owner}',
    noFactions: 'This story has no factions.', factionValues: 'Values', factionStructure: 'Structure', members: 'Members', noMembers: 'No members.', relationships: 'Relationships', inactive: 'Inactive', former: 'Former',
    allRelations: 'All', relationCharacter: 'Character', relationKnowledge: 'Knowledge', relationMembership: 'Membership', relationSocial: 'Social', relationExit: 'Routes', noRelations: 'No matching relations.', removeRelation: 'Remove', removeRelationConfirm: 'Remove this relation? This cannot be undone.', knowledgeNotice: 'This explicit record means the character knows that the target exists. Remove it to make the target unknown.',
    location: 'Place', item: 'Thing', faction: 'Faction', exit: 'Route', rank: 'Rank', commitment: 'Commitment', publicMembership: 'Public membership', blocked: 'Blocked', travelSeconds: 'Travel time (seconds)', note: 'Note', relationLabel: 'Relationship', familiarity: 'Familiarity', trust: 'Trust', affinity: 'Affinity', tension: 'Tension',
    perspective: 'View as', objectiveWorld: 'Objective world', listView: 'List', graphView: 'Graph', addRelation: 'Add relation', from: 'From', to: 'To', relationCancel: 'Cancel', relationCreate: 'Create',
  },
  zh: {
    tab: '世界', editorLoading: '正在载入世界…', editorLoadFailed: '无法载入世界：{message}', notRoleplay: '这个对话不是角色扮演会话，没有世界。',
    editorRefresh: '刷新', sections: '世界的各部分', soon: '尚未实现',
    characters: '角色', places: '地点', things: '物品', factions: '阵营', noCharacters: '这个故事没有角色。', portraitMissing: '暂无肖像', portraitGenerate: '生成肖像', portraitGenerating: '正在生成…', portraitRetry: '重新生成肖像', portraitFailed: '无法生成肖像：{message}', portraitSaveFirst: '请先保存视觉身份。', portraitIdentityRequired: '请先添加并保存视觉身份，再生成肖像。',
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
    noPlaces: '这个故事没有地点。', noThings: '这个故事没有物品。', description: '描述', insidePlace: '位于', features: '地点特征', featureId: '特征 ID', addFeature: '添加特征', removeFeature: '删除特征', quantity: '数量', quality: '状态', notable: '始终重要', hidden: '隐藏', containerState: '容器状态', open: '打开', closed: '关闭', locked: '上锁', unique: '唯一', heldAt: '所在：{holder}', wearableAt: '可穿戴：{slot}', ownedBy: '属于 {owner}',
    noFactions: '这个故事没有阵营。', factionValues: '价值观', factionStructure: '组织结构', members: '成员', noMembers: '暂无成员。', relationships: '关系', inactive: '不活跃', former: '前成员',
    allRelations: '全部', relationCharacter: '角色关系', relationKnowledge: '知识', relationMembership: '成员关系', relationSocial: '社会关系', relationExit: '路径', noRelations: '没有符合条件的关系。', removeRelation: '删除关系', removeRelationConfirm: '确定删除这条关系吗？此操作无法撤销。', knowledgeNotice: '这条显式记录表示该角色知道目标存在。删除后，目标对该角色即为未知。',
    location: '地点', item: '物品', faction: '阵营', exit: '路径', rank: '等级', commitment: '投入程度', publicMembership: '公开成员身份', blocked: '受阻', travelSeconds: '通行时间（秒）', note: '备注', relationLabel: '关系称谓', familiarity: '熟悉度', trust: '信任', affinity: '好感', tension: '紧张度',
    perspective: '视角', objectiveWorld: '客观世界', listView: '列表', graphView: '关系图', addRelation: '添加关系', from: '起点', to: '目标', relationCancel: '取消', relationCreate: '创建',
  },
}
