import type { Dictionaries } from '../i18n.ts'

export type QuestionsLocaleKey =
  | 'title' | 'help' | 'addQuestion' | 'removeQuestion' | 'questionId' | 'questionText' | 'addAnswer' | 'removeAnswer' | 'answerId' | 'answerLabel' | 'answerDescription'
  | 'rules' | 'opening' | 'openingNone' | 'startingTime' | 'clock' | 'clockNone' | 'clockSimulated' | 'clockReal' | 'keptElsewhere'

export const dictionaries: Dictionaries<QuestionsLocaleKey> = {
  en: {
    title: 'Questions before the story', help: 'The start dialog asks these and applies the chosen answer: extra rules, an alternate opening, a starting time, the clock, tool switches and a plot\'s starting state. What the player picks in the dialog itself wins over an answer. Between 2 and 8 answers each.',
    addQuestion: 'Add a question', removeQuestion: 'Remove the question', questionId: 'Id', questionText: 'Question', addAnswer: 'Add an answer', removeAnswer: 'Remove', answerId: 'Id', answerLabel: 'Answer', answerDescription: 'Explanation',
    rules: 'Rules it adds (one per line)', opening: 'Opening', openingNone: 'No change', startingTime: 'Starting time', clock: 'Clock', clockNone: 'No change', clockSimulated: 'Simulated', clockReal: 'Real time', keptElsewhere: 'Also sets tool switches or plots, which are kept as written in the file.',
  },
  zh: {
    title: '开始前的提问', help: '开始对话框会询问这些问题，并应用所选的回答：额外规则、备选开场、起始时间、时钟、工具开关和剧情线的起始状态。玩家在对话框里直接选的内容优先于回答。每个问题 2 到 8 个回答。',
    addQuestion: '添加问题', removeQuestion: '移除问题', questionId: '标识', questionText: '问题', addAnswer: '添加回答', removeAnswer: '移除', answerId: '标识', answerLabel: '回答', answerDescription: '说明',
    rules: '添加的规则（每行一条）', opening: '开场', openingNone: '不改变', startingTime: '起始时间', clock: '时钟', clockNone: '不改变', clockSimulated: '模拟', clockReal: '真实时间', keptElsewhere: '还设置了工具开关或剧情线，按文件中所写保留。',
  },
}
