import type { Dictionaries } from '../i18n.ts'

export type ReferenceLocaleKey =
  | 'tab' | 'title' | 'description' | 'back' | 'navLabel' | 'refresh' | 'notRoleplay' | 'loading' | 'failed'
  | 'people' | 'places' | 'things' | 'noPeople' | 'noPlaces' | 'noThings'
  | 'profile' | 'noProfile' | 'aliases' | 'now' | 'doing' | 'feeling' | 'appearance' | 'personality' | 'background' | 'speech' | 'values' | 'goals' | 'groups' | 'recollections' | 'beliefs' | 'showing' | 'turn' | 'witnessed' | 'heard' | 'told' | 'inferred' | 'doubtful' | 'likely' | 'sure' | 'deadline'
  | 'relations' | 'relationsHint' | 'you'
  | 'quests' | 'questsHint' | 'noQuests' | 'questPromise' | 'questStory' | 'questSettled' | 'questSpan' | 'questWith'
  | 'map' | 'mapHint' | 'journal' | 'journalHint' | 'savedNotes' | 'savingNotes' | 'unsavedNotes' | 'saveFailed'
  | 'here' | 'youAreHere' | 'inside' | 'features' | 'ways' | 'closedWay' | 'carried' | 'worn' | 'lyingHere'

export const dictionaries: Dictionaries<ReferenceLocaleKey> = {
  en: {
    tab: 'Reference', title: 'Reference', description: 'Who you have met, where you have been, what you carry', back: 'Back', navLabel: 'Reference pages', refresh: 'Refresh', notRoleplay: 'This chat is not a roleplay session, so it has no reference.',
    loading: 'Loading…', failed: 'Could not load this page: {message}',
    profile: 'Profile', noProfile: 'There is no character of yours in this story yet.', aliases: 'Also called {list}', now: 'Now', doing: 'Doing', feeling: 'Inside', appearance: 'Appearance', personality: 'Personality', background: 'Background', speech: 'How you speak', values: 'Tracked', goals: 'What you want', groups: 'Groups', recollections: 'What you remember ({count})', beliefs: 'What you believe ({count})', showing: 'Showing the newest {shown} of {count}.', turn: 'turn {turn}', witnessed: 'saw', heard: 'heard', told: 'was told', inferred: 'worked out', doubtful: 'doubtful', likely: 'likely', sure: 'sure', deadline: 'by {when}',
    relations: 'Relations', relationsHint: 'The people you have met, with what each is to you. A dashed line is someone you are with but do not know yet.', you: 'You',
    quests: 'Quests', questsHint: 'What you have promised, arranged or been told of that is not finished. What the story keeps to itself is not here.', noQuests: 'Nothing yet. A promise you make, an appointment or a task you are told of appears here.', questPromise: 'promise', questStory: 'told', questSettled: 'settled, turn {turn}', questSpan: '{from} to {to}', questWith: 'With {list}',
    map: 'Map', mapHint: 'Places you know, set out by how many ways they are from where you are. A dashed line is a way that is closed.', journal: 'Journal', journalHint: 'Your own notes on the story. Only you read them.', savedNotes: 'Saved', savingNotes: 'Saving…', unsavedNotes: 'Not saved yet', saveFailed: 'Could not save: {message}',
    people: 'People', places: 'Places', things: 'Things',
    noPeople: 'Nobody yet. People you meet or are with appear here.', noPlaces: 'No places yet.', noThings: 'You carry nothing and see nothing lying around.',
    here: 'here', youAreHere: 'you are here', inside: 'inside {place}', features: 'Notable: {list}', ways: 'Ways out: {list}', closedWay: '{place} (closed)', carried: 'carried', worn: 'worn', lyingHere: 'lying here',
  },
  zh: {
    tab: '资料', title: '资料', description: '你遇见过谁、去过哪里、带着什么', back: '返回', navLabel: '资料页', refresh: '刷新', notRoleplay: '此对话不是角色扮演存档，没有资料。',
    loading: '正在加载…', failed: '无法加载此页：{message}',
    profile: '档案', noProfile: '这个故事里还没有你的角色。', aliases: '又称{list}', now: '此刻', doing: '正在做', feeling: '内心', appearance: '外貌', personality: '性格', background: '背景', speech: '说话方式', values: '状态数值', goals: '想要什么', groups: '所属团体', recollections: '你记得的事（{count}）', beliefs: '你的看法（{count}）', showing: '显示最近的 {shown} 条，共 {count} 条。', turn: '第 {turn} 回合', witnessed: '亲眼所见', heard: '听到', told: '听说', inferred: '推断', doubtful: '存疑', likely: '多半', sure: '确信', deadline: '期限：{when}',
    relations: '关系', relationsHint: '你遇见过的人，以及各自与你的关系。虚线表示同在一处但你还不认识的人。', you: '你',
    quests: '任务', questsHint: '你许下的承诺、约好的事和别人告诉你的、还没有了结的事。故事自己保密的内容不在这里。', noQuests: '暂时没有。你许下的承诺、约定或被告知的任务会出现在这里。', questPromise: '承诺', questStory: '听说', questSettled: '已了结，第 {turn} 回合', questSpan: '{from} 至 {to}', questWith: '同行：{list}',
    map: '地图', mapHint: '你知道的地方，按离你所在之处有几步路排列。虚线表示已关闭的路。', journal: '日志', journalHint: '你自己对故事的笔记，只有你能看到。', savedNotes: '已保存', savingNotes: '正在保存…', unsavedNotes: '尚未保存', saveFailed: '无法保存：{message}',
    people: '人物', places: '地点', things: '物品',
    noPeople: '还没有人。你遇见或同行的人会出现在这里。', noPlaces: '还没有地点。', noThings: '你身上没有东西，周围也没有看得见的东西。',
    here: '在这里', youAreHere: '你在这里', inside: '位于{place}内', features: '显眼之处：{list}', ways: '出路：{list}', closedWay: '{place}（关闭）', carried: '携带', worn: '穿戴', lyingHere: '放在这里',
  },
}
