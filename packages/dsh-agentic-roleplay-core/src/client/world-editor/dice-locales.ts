import type { Dictionaries } from '../i18n.ts'

export type DiceLocaleKey =
  | 'help' | 'none' | 'add' | 'remove' | 'key' | 'name' | 'use' | 'useHelp' | 'dice' | 'diceHelp' | 'reading' | 'readTotal' | 'readSuccesses' | 'hit' | 'compare' | 'compareAbsolute' | 'compareOver' | 'compareUnder' | 'compareHelp'
  | 'modifier' | 'modifierHelp' | 'bands' | 'bandsHelp' | 'bandAdd' | 'bandRemove' | 'bandMin' | 'bandMax' | 'bandLabel' | 'bandResult' | 'resultSucceeded' | 'resultPartial' | 'resultFailed' | 'bandCritical' | 'checkTitle'

export const dictionaries: Dictionaries<DiceLocaleKey> = {
  en: {
    help: 'How uncertain attempts are settled. The game master rolls one of these checks and is told which band the roll fell in, so no number is ever made up. Each check says when it is used, the dice it rolls and what each result means; the bands together should cover every value the dice can give.',
    none: 'This world has no checks. Its game master can still roll plain dice for things that have none.', add: 'Add a check', remove: 'Remove this check', checkTitle: 'Check',
    key: 'Key', name: 'Name', use: 'When it is used', useHelp: 'Said to the game master in your words: what kind of attempt it is for, and how hard is hard (for example "target 10 moderate, 15 hard").',
    dice: 'Dice', diceHelp: '2d6+1, 1d20, 4d6kh3 (keep the highest 3), d100.', reading: 'Read as', readTotal: 'The total of the dice', readSuccesses: 'The number of dice that hit', hit: 'A die hits from',
    compare: 'Compared with', compareAbsolute: 'Nothing: the value itself', compareOver: 'A difficulty to meet or beat', compareUnder: 'A skill to roll under', compareHelp: 'With a difficulty or a skill, the game master gives the number, and the bands read how far over or under it the roll is.',
    modifier: 'Adds a quality of the character', modifierHelp: 'The key of a number about characters declared in Tracked values, or empty.',
    bands: 'Results', bandsHelp: 'The first band that holds the value is the result. Leave "from" or "to" empty for no end.', bandAdd: 'Add a result', bandRemove: 'Remove', bandMin: 'From', bandMax: 'To', bandLabel: 'Called', bandResult: 'Counts as', resultSucceeded: 'Success', resultPartial: 'Partial', resultFailed: 'Failure', bandCritical: 'Critical',
  },
  zh: {
    help: '不确定的尝试如何裁定。主持人掷出其中一个检定，并被告知掷出的结果落在哪个区段，因此不会有任何数字被编造。每个检定写明何时使用、掷什么骰子，以及每种结果意味着什么；各区段合起来应覆盖骰子可能给出的每个数值。',
    none: '这个世界没有检定。它的主持人仍然可以为没有检定的事掷普通骰子。', add: '添加检定', remove: '删除此检定', checkTitle: '检定',
    key: '标识', name: '名称', use: '何时使用', useHelp: '用你的话告诉主持人：它适用于哪一类尝试，以及怎样算难（例如“目标 10 为中等，15 为困难”）。',
    dice: '骰子', diceHelp: '2d6+1、1d20、4d6kh3（保留最高的 3 个）、d100。', reading: '读取方式', readTotal: '骰子的总和', readSuccesses: '命中的骰子数', hit: '骰子从多少起算命中',
    compare: '与什么比较', compareAbsolute: '不比较：直接读取数值', compareOver: '要达到或超过的难度', compareUnder: '要掷低于的技能值', compareHelp: '选择难度或技能值时，由主持人给出该数字，区段读取的是掷出的结果比它高出或低多少。',
    modifier: '加上角色的某项属性', modifierHelp: '在“追踪数值”中声明的、关于角色的数值的 key；留空为不加。',
    bands: '结果', bandsHelp: '第一个包含该数值的区段就是结果。“从”或“到”留空表示没有上限或下限。', bandAdd: '添加结果', bandRemove: '删除', bandMin: '从', bandMax: '到', bandLabel: '称为', bandResult: '算作', resultSucceeded: '成功', resultPartial: '部分成功', resultFailed: '失败', bandCritical: '关键',
  },
}
