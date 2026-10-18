import type { Dictionaries } from '../i18n.ts'

export type TriggersLocaleKey =
  | 'title' | 'help' | 'helpStory' | 'none' | 'fileProblem' | 'when' | 'then' | 'problems' | 'fired' | 'firedCount' | 'dormant' | 'failed' | 'expired' | 'fromStory' | 'repeats' | 'cooldown' | 'chance' | 'priority' | 'expires' | 'announced'
  | 'timeFrom' | 'timeTo' | 'timeWindow' | 'timeDays' | 'place' | 'placeAt' | 'variable' | 'variableOf' | 'opEq' | 'opNe' | 'opLt' | 'opLe' | 'opGt' | 'opGe' | 'heldBy' | 'lyingIn' | 'event' | 'firedTrigger' | 'judged' | 'all' | 'any' | 'not'
  | 'editTrigger' | 'saveTrigger' | 'cancelTrigger' | 'removeTrigger' | 'removeConfirm' | 'addTrigger' | 'newKey' | 'notJson' | 'saveFailed' | 'editHelp' | 'editing' | 'saving'
  | 'edit' | 'beat' | 'cue' | 'everyone' | 'whoeverIn' | 'only'

export const dictionaries: Dictionaries<TriggersLocaleKey> = {
  en: {
    title: 'Triggers', help: 'What the world does by itself when something comes true. They are read from triggers.json; ask the authoring assistant to make or change them, or edit the file.', helpStory: 'What this story does by itself when something comes true, with how often each has fired. They come from the world, or were made in play by the world author.',
    none: 'This world has no triggers.', fileProblem: 'triggers.json cannot be shown: {message}', when: 'When', then: 'Then', problems: 'Names something the world does not have', fired: 'Fired', firedCount: 'fired {count} time(s)', dormant: 'Waiting', failed: 'Failed', expired: 'Expired', fromStory: 'Made in play',
    repeats: 'repeats', cooldown: 'at least {time} apart', chance: 'chance {percent}%', priority: 'priority {value}', expires: 'ends {at}', announced: 'announced beforehand',
    timeFrom: 'from {at}', timeTo: 'until {at}', timeWindow: 'between {from} and {to} each day', timeDays: 'on {days}', place: '{who} is in {where}', placeAt: '{who} is at {feature} in {where}', variable: '{name} {op} {value}', variableOf: '{name} of {subject} {op} {value}',
    opEq: 'is', opNe: 'is not', opLt: 'is below', opLe: 'is at most', opGt: 'is above', opGe: 'is at least', heldBy: '{item} is held by {who}', lyingIn: '{item} is in {where}', event: 'an event tagged “{tag}” was recorded', firedTrigger: '“{trigger}” has fired', judged: 'a model judges it true: “{text}”',
    all: 'all of: {parts}', any: 'any of: {parts}', not: 'not ({part})',
    editTrigger: 'Edit', saveTrigger: 'Save', cancelTrigger: 'Cancel', removeTrigger: 'Remove', removeConfirm: 'Remove “{key}” (kept in the world’s trash)', addTrigger: 'Add a trigger', newKey: 'Key (letters, digits and hyphens)', notJson: 'This is not valid JSON: {message}', saveFailed: 'Not saved: {message}', editHelp: 'Edit the trigger as it is written in triggers.json: when (a condition), effects (edit, beat or cue), and the optional repeat, cooldown_seconds, chance, priority, expires and announce. It is checked as a story start checks it, and refused with every problem when it names something the world does not have.', editing: 'Loading…', saving: 'Saving…',
    edit: 'changes the story’s records ({events} event(s))', beat: 'tells the game master: “{text}”', cue: '{audience} notice: “{text}”', everyone: 'everyone', whoeverIn: 'whoever is in {where}', only: 'only while {condition}',
  },
  zh: {
    title: '触发器', help: '世界在某件事成真时自行发生的事。它们读自 triggers.json；可以让创作助手来创建或修改，也可以直接编辑该文件。', helpStory: '这个故事在某件事成真时自行发生的事，以及各自触发过几次。它们来自世界，或是世界作者在游玩中创建的。',
    none: '这个世界没有触发器。', fileProblem: '无法显示 triggers.json：{message}', when: '当', then: '就', problems: '提到了世界里没有的东西', fired: '已触发', firedCount: '已触发 {count} 次', dormant: '等待中', failed: '失败', expired: '已过期', fromStory: '游玩中创建',
    repeats: '可重复', cooldown: '至少间隔 {time}', chance: '概率 {percent}%', priority: '优先级 {value}', expires: '{at} 结束', announced: '事先公布',
    timeFrom: '从 {at} 起', timeTo: '到 {at} 为止', timeWindow: '每天 {from} 到 {to}', timeDays: '在{days}', place: '{who}在{where}', placeAt: '{who}在{where}的{feature}', variable: '{name}{op}{value}', variableOf: '{subject}的{name}{op}{value}',
    opEq: '等于', opNe: '不等于', opLt: '低于', opLe: '不高于', opGt: '高于', opGe: '不低于', heldBy: '{who}持有{item}', lyingIn: '{item}在{where}', event: '记录了带有“{tag}”标签的事件', firedTrigger: '“{trigger}”已触发', judged: '模型判定为真：“{text}”',
    all: '以下全部成立：{parts}', any: '以下任一成立：{parts}', not: '不满足（{part}）',
    editTrigger: '编辑', saveTrigger: '保存', cancelTrigger: '取消', removeTrigger: '删除', removeConfirm: '删除“{key}”（保留在世界的回收文件夹里）', addTrigger: '添加触发器', newKey: '键（字母、数字和连字符）', notJson: '这不是有效的 JSON：{message}', saveFailed: '未保存：{message}', editHelp: '按 triggers.json 中的写法编辑这个触发器：when（条件）、effects（edit、beat 或 cue），以及可选的 repeat、cooldown_seconds、chance、priority、expires 和 announce。保存时会像开始故事时那样检查，若提到世界里没有的东西，会列出全部问题并拒绝。', editing: '正在加载…', saving: '正在保存…',
    edit: '修改故事记录（{events} 个事件）', beat: '告诉游戏主持人：“{text}”', cue: '{audience}察觉：“{text}”', everyone: '所有人', whoeverIn: '在{where}的人', only: '仅当{condition}时',
  },
}
