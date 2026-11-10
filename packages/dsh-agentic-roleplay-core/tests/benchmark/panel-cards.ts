import type { NormalizedCard } from '../../src/shared/import-card.ts'
import type { Language } from './language.ts'
import { pick } from './language.ts'

/**
 * Invented cards that carry their game state the way community cards do, in both languages. Each one is a style of status display that an import has met or may meet:
 *  - fence: a bar of values in a fenced block under every message, with an always-on entry that demands it;
 *  - html: a small block of markup with the values in it, with a template in an always-on entry;
 *  - tags: a layout of nested tags of the card's own invention under a header line (names in the card's language, fill-in placeholders, contact message blocks, options),
 *    an always-on entry that demands it, a second one about how the messages in it are written, and scripts that draw it;
 *  - state: a state-tracking framework: an entry of starting values and an entry that demands an update block after each message.
 * Nothing here is taken from a real card: the town, the people and the words are made up, and only the shapes are those of the real thing.
 */
export type PanelStyle = 'fence' | 'html' | 'tags' | 'state'
export const PANEL_STYLES: readonly PanelStyle[] = ['fence', 'html', 'tags', 'state']

export interface PanelCard {
  id: string
  style: PanelStyle
  language: Language
  card: NormalizedCard
  /** The panel as the card's first message ends with it, with values filled in: what a game master must never write into its narration. */
  filled: string
  /** The ids of the always-on entries that demand the display or its upkeep. */
  demanding: readonly string[]
  /** How many values the display shows that a world can track as numbers, flags or choices (a lower bound for the variables an import makes): the time, place, mood and clothes of the tags style are free text, which the world keeps elsewhere (clock, placements, feelings). */
  values: number
}

const t = (language: Language) => pick(language)

const entry = (index: number, title: string, content: string) => ({ id: `entry:${index}`, title, keys: [], secondaryKeys: [], content, enabled: true, constant: true, selective: false, position: 'before_char' })

function texts(language: Language) {
  const p = t(language)
  return {
    name: p('Lamp Quay', '灯码头'),
    description: p('Lamp Quay is a canal town of lantern-makers. Wren runs the ticket window on the north steps and distrusts strangers. Odo poles the night barge and knows every passenger by name.', '灯码头是一座以灯匠闻名的运河小镇。温在北台阶上守着售票窗，不信任陌生人。奥多撑夜航船，认得每一位乘客的名字。'),
    scenario: p('Early spring. The canal is high and the night barge has stopped twice this week.', '初春。运河水位很高，这周夜航船已经停了两次。'),
    story: p('The barge horn sounds across the water and Wren looks up from her window.\n\n"A ticket is two silver," she says, not smiling.', '船笛声越过水面传来，温从售票窗后抬起头。\n\n“一张票两枚银币。”她说，没有笑。'),
    other: p('Rain drums on the quay roof. Odo waves you aboard.', '雨点敲打着码头的顶棚。奥多朝你招手，让你上船。'),
    style: p('Write in third person, past tense, with short vivid paragraphs.', '用第三人称、过去时写作，段落短而生动。'),
    bank: p('The north steps hold the ticket window, a tea stall and the old lamp-crane. Mist sits low here in spring.', '北台阶上有售票窗、一个茶摊和那架旧吊灯机。春天这里的雾压得很低。'),
    example: p('{{user}}: How much is the crossing?\n{{char}}: *Wren taps the sill.* "Two silver. No haggling."', '{{user}}：过河要多少钱？\n{{char}}：*温敲了敲窗沿。*“两枚银币，不讲价。”'),
  }
}

const BAR = {
  en: 'Day 3 | Place: Lamp Quay | Trust: 20/100 | Silver: 15',
  zh: '第3天 | 地点：灯码头 | 信任：20/100 | 银币：15',
} as const

const HTML = {
  en: '<div class="status"><b>Day 1</b> · Trust <span>10</span>/100 · Silver <span>12</span></div>',
  zh: '<div class="status"><b>第1天</b> · 信任 <span>10</span>/100 · 银币 <span>12</span></div>',
} as const

/** The layout a card of the tags style demands, with fill-in placeholders, and the same layout filled in as a message would end with it. */
export const TAG_LAYOUT = {
  en: (filled: boolean): string => {
    const v = (placeholder: string, value: string): string => (filled ? value : `{{${placeholder}}}`)
    return `[Quay Panel]
<clock>${v('time of day, such as 15:30 | Thursday', '15:30 | Thursday')}</clock>
<place>${v('current place', 'North steps')}</place>
<silver>${v('silver held, a number', '15')}</silver>
<subject_a>
<name>${v('name of A', 'Wren')}</name>
<mood>${v('A\'s mood', 'guarded')}</mood>
<dress>${v('what A wears', 'a grey oilcloth coat')}</dress>
</subject_a>
<doves_1>
<name>${v('sender', 'Odo')}</name>
<messages>
${v('first message', 'Barge at six, if the water drops')} [${v('time', '14:05')}]
${v('second message', 'Bring a lamp')} [${v('time', '14:07')}]
</messages>
</doves_1>
<choices>
<a>${v('choice a', 'Buy the ticket')}</a>
<b>${v('choice b', 'Ask about the barge')}</b>
</choices>`
  },
  zh: (filled: boolean): string => {
    const v = (placeholder: string, value: string): string => (filled ? value : `{{${placeholder}}}`)
    return `【灯码头面板】
<时刻>${v('当前时刻，如 15:30 | 周四', '15:30 | 周四')}</时刻>
<地点>${v('当前地点', '北台阶')}</地点>
<银币>${v('当前持有银币数字', '15')}</银币>
<对象甲>
<名字>${v('对象甲名字', '温')}</名字>
<心境>${v('对象甲心境', '戒备')}</心境>
<衣着>${v('对象甲衣着', '灰色油布外套')}</衣着>
</对象甲>
<飞鸽_1>
<名字>${v('寄信人', '奥多')}</名字>
<消息块>
${v('第一条消息', '水退了就六点开船')} [${v('时间', '14:05')}]
${v('第二条消息', '带上灯')} [${v('时间', '14:07')}]
</消息块>
</飞鸽_1>
<抉择>
<甲>${v('选项甲', '买票')}</甲>
<乙>${v('选项乙', '打听夜航船')}</乙>
</抉择>`
  },
} as const

function tiers(language: Language): string {
  return t(language)(
    `# Dove message tiers (mandatory)
### Stage one: reserved and humble
- tone: very formal, polite, a little afraid.
- address: always "Mx. {{user}}".
- example: "Pardon the trouble, Mx. {{user}}. Might I take your watch at the lamp-crane tomorrow?"
### Stage two: warming
- tone: shorter, with small jokes.
- example: "You came back. Good. The tea is still hot."`,
    `# 飞鸽消息分级（强制执行）
### 阶段一：拘谨而卑微
- 语气：极其正式、客气，带一点怯意。
- 称呼：一律称“{{user}}先生”。
- 示例：“打扰了，{{user}}先生。明天吊灯机的班，我可以替您值吗？”
### 阶段二：渐渐熟络
- 语气：变短，带点小玩笑。
- 示例：“你回来了。好。茶还热着。”`)
}

const MANDATORY = {
  en: (layout: string): string => `# Mandatory format
After the story of each reply, at the very end, output the global panel. It must follow this layout exactly (keep every tag and line break). Under each contact, list that contact's messages one per line, each ending with the time in brackets.

${layout}`,
  zh: (layout: string): string => `# 重要格式要求（强制执行）
在完成所有剧情后，请在回复的**绝对最末尾**输出全局面板。
面板必须严格遵循以下格式（保留所有标签与换行）。每位联系人名下的消息逐条换行罗列，每条末尾用方括号标注时间。

${layout}`,
} as const

export function panelCards(language: Language): PanelCard[] {
  const x = texts(language)
  const p = t(language)
  const base = (): NormalizedCard => ({
    sourceSpec: 'chara_card_v3', name: x.name, description: x.description, personality: '', scenario: x.scenario, firstMessage: x.story, alternateGreetings: [x.other], messageExample: '', creatorNotes: '',
    systemPrompt: x.style, postHistoryInstructions: '', tags: [], creator: 'benchmark', characterVersion: '1', ignored: { scripts: 0, extensions: [] },
    book: { name: x.name, description: '', entries: [{ id: 'entry:9', title: p('North steps', '北台阶'), keys: [p('steps', '台阶')], secondaryKeys: [], content: x.bank, enabled: true, constant: false, selective: false, position: 'before_char' }] },
  })
  const withBook = (card: NormalizedCard, entries: ReturnType<typeof entry>[]): NormalizedCard => ({ ...card, book: { name: card.book!.name, description: '', entries: [...entries, ...card.book!.entries] } })

  const fence = base()
  fence.firstMessage = `${x.story}\n\n\`\`\`\n${BAR[language]}\n\`\`\``
  fence.alternateGreetings = [`${x.other}\n\n\`\`\`\n${BAR[language]}\n\`\`\``]
  fence.messageExample = `<START>\n${x.example}\n\`\`\`\n${BAR[language]}\n\`\`\``
  fence.systemPrompt = `${x.style}\n${p('Always end every reply with a status bar in a code block, exactly in this format: Day N | Place: X | Trust: N/100 | Silver: N. Never skip it.', '每次回复的结尾都必须附一个代码块状态栏，格式严格为：第N天 | 地点：X | 信任：N/100 | 银币：N。不许省略。')}`

  const html = base()
  html.firstMessage = `${x.story}\n\n${HTML[language]}`
  html.alternateGreetings = [`${x.other}\n\n${HTML[language]}`]
  html.messageExample = `<START>\n${x.example}\n${HTML[language]}`

  const tags = base()
  tags.firstMessage = `${x.story}\n\n${TAG_LAYOUT[language](true)}`
  tags.alternateGreetings = [`${x.other}\n\n${TAG_LAYOUT[language](true)}`]
  tags.ignored = { scripts: 2, regexScripts: 1, helperScripts: 1, extensions: ['regex_scripts', 'tavern_helper'] }

  const state = base()
  state.alternateGreetings = [x.other]

  return [
    { id: 'fence', style: 'fence', language, filled: BAR[language], demanding: ['entry:0'], values: 3, card: withBook(fence, [entry(0, p('Status format', '状态栏格式'), `${p('IMPORTANT: end each response with this status bar in a code block:', '重要：每条回复的末尾都要附上这个代码块状态栏：')}\n\`\`\`\n${p('Day {day} | Place: {place} | Trust: {trust}/100 | Silver: {silver}', '第{day}天 | 地点：{place} | 信任：{trust}/100 | 银币：{silver}')}\n\`\`\``)]) },
    { id: 'html', style: 'html', language, filled: HTML[language], demanding: ['entry:0'], values: 3, card: withBook(html, [entry(0, p('Status template', '状态模板'), `${p('Render this block after every reply, filling in the values:', '每次回复后渲染这个区块，并填入数值：')}\n<div class="status"><b>${p('Day {{day}}', '第{{day}}天')}</b> · ${p('Trust', '信任')} <span>{{trust}}</span>/100 · ${p('Silver', '银币')} <span>{{silver}}</span></div>`)]) },
    { id: 'tags', style: 'tags', language, filled: TAG_LAYOUT[language](true), demanding: ['entry:0', 'entry:1'], values: 1, card: withBook(tags, [entry(0, p('Panel format', '面板格式'), MANDATORY[language](TAG_LAYOUT[language](false))), entry(1, p('Dove messages', '飞鸽消息'), tiers(language))]) },
    { id: 'state', style: 'state', language, filled: '', demanding: ['entry:1'], values: 3, card: withBook(state, [
      entry(0, 'InitVar', 'silver: 15\ntrust: 20\nday: 3'),
      entry(1, p('Variable rules', '变量规则'), p("After each reply output an <UpdateVariable> block with lines like _.set('trust', 20, 25); // reason. Trust rises by 5 when {{user}} is kind to Wren and falls by 10 when {{user}} lies. Silver goes down by the price of anything bought.", "每次回复后输出一个 <UpdateVariable> 区块，每行形如 _.set('trust', 20, 25); // 原因。{{user}} 对温友善时信任加 5，撒谎时减 10。买东西时银币按价格减少。")),
    ]) },
  ]
}

/** What a game master that imitated the opening would write at the end of its narration. */
export const leakedNarration = (card: PanelCard): string => `${texts(card.language).story}\n\n${card.filled === '' ? `<UpdateVariable>\n_.set('trust', 20, 25);\n</UpdateVariable>` : card.filled}`

/** A check of the benchmark's own, independent of the product's: whether a text still holds a status bar, a block of tags, a fill-in placeholder or an update call. */
export const leaks = (text: string): boolean =>
  /```|<\/?[\p{L}][\p{L}\p{N}_-]*>|\{\{(?!\s*(?:user|char|bot)\s*\}\})|(?:\s[|｜]\s[^|｜\n]+){2,}|_\.set\(|^【[^】\n]{1,30}】\s*$/mu.test(text)
