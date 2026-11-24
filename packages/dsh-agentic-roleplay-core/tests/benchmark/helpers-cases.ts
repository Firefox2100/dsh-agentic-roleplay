import type { NarrationSegment } from '../../src/shared/narration.ts'
import type { Language } from './language.ts'
import { castName } from './attribution-cases.ts'

/**
 * The cases of the helper benchmark: a scene a suggester reads, the events and summaries a chronicler folds, an organisation and what has happened to its goals, and a story that has gone quiet. Invented
 * people only (Mara is the player; Elias keeps the kitchen, Pavel collects what is owed, Odile is a neighbour).
 */
export interface HelperCase {
  id: string
  helper: 'suggester' | 'chronicler' | 'strategist' | 'plot'
  suggester?: (language: Language) => { segments: NarrationSegment[]; cast: unknown[]; forbidden: string[]; player: string }
  chronicler?: (language: Language) => ChroniclerFixture
  strategist?: (language: Language) => StrategistFixture
  plot?: (language: Language) => PlotFixture
}

interface ChroniclerFixture {
  level: 'digest' | 'chapter'
  events: { turn: number; text: string; importance: number }[]
  summaries: { level: 'digest' | 'chapter'; fromTurn: number; toTurn: number; text: string }[]
  limits: { shortTermTokens: number; longTermTokens: number }
  uptoTurn: number
  playerInputs: string
  /** What the written passage must still hold, and what it must not (what the events correct). */
  keeps: string[]
  lacks: string[]
}

interface StrategistFixture {
  name: string
  summary: string
  values: string[]
  publicState: string
  innerState: string
  goals: { name: string; description: string; plan: string[] }[]
  events: string[]
  /** What the first goal must be afterwards: still going, fulfilled, or ended by what happened. */
  expectStatus: 'active' | 'completed' | 'ended'
}

interface PlotFixture {
  cast: { key: string; name: string; summary: string; player?: boolean }[]
  faction: { name: string; summary: string }
  place: string
  events: string[]
  /** A word from the story that a plot that grows from it must use. */
  uses: string[]
}

const t = (language: Language, en: string, zh: string): string => (language === 'en' ? en : zh)
const n = (key: 'mara' | 'elias' | 'odile' | 'pavel', language: Language): string => castName(key, language)
const narration = (text: string): NarrationSegment => ({ type: 'narration', text }) as NarrationSegment
const says = (name: string, text: string): NarrationSegment => ({ type: 'utterance', name, text }) as unknown as NarrationSegment

const player = (language: Language, place: string): unknown[] => [{ key: 'mara', character: { name: n('mara', language), control: 'player' }, place: { location: { name: place } } }]

const suggest = (id: string, scene: (language: Language) => NarrationSegment[], place: Pair, forbidden: (language: Language) => string[]): HelperCase => ({
  id: `suggester-${id}`, helper: 'suggester',
  suggester: language => ({ segments: scene(language), cast: player(language, place[language]), forbidden: forbidden(language), player: n('mara', language) }),
})
type Pair = { en: string; zh: string }

const EVENTS = (language: Language): { turn: number; text: string; importance: number }[] => [
  [1, t(language, `${n('mara', language)} arrived at the kitchen with a letter of introduction for ${n('elias', language)}.`, `${n('mara', language)}带着给${n('elias', language)}的介绍信来到厨房。`), 3],
  [2, t(language, `${n('elias', language)} agreed to let ${n('mara', language)} stay until the rent falls due on the fifth.`, `${n('elias', language)}答应让${n('mara', language)}住到五号房租到期。`), 4],
  [3, t(language, `${n('pavel', language)} demanded forty coins for the cart and gave ${n('mara', language)} until Friday.`, `${n('pavel', language)}为大车索要四十枚硬币，给${n('mara', language)}宽限到周五。`), 5],
  [4, t(language, `${n('odile', language)} lent a lamp and warned that the lane floods in rain.`, `${n('odile', language)}借出一盏灯，并提醒雨天小巷会积水。`), 2],
  [5, t(language, `${n('mara', language)} promised ${n('pavel', language)} she would pay by Friday.`, `${n('mara', language)}向${n('pavel', language)}保证周五前还钱。`), 5],
  [6, t(language, `${n('elias', language)} confided that the harbor master distrusts ${n('pavel', language)}.`, `${n('elias', language)}私下说港务长不信任${n('pavel', language)}。`), 4],
  [7, t(language, `${n('mara', language)} sold her mother's ring at the market for forty coins.`, `${n('mara', language)}在集市上以四十枚硬币卖掉了母亲的戒指。`), 4],
  [8, t(language, `${n('elias', language)} grew suspicious when ${n('mara', language)} came back without the ring.`, `${n('mara', language)}没戴戒指回来，${n('elias', language)}起了疑心。`), 3],
  [9, t(language, `${n('odile', language)} saw ${n('mara', language)} counting coins by the lamp.`, `${n('odile', language)}看见${n('mara', language)}在灯下数硬币。`), 2],
  [10, t(language, `On Friday ${n('mara', language)} paid ${n('pavel', language)} forty coins and he struck the debt from his book.`, `周五，${n('mara', language)}付给${n('pavel', language)}四十枚硬币，他在账本上划掉了这笔账。`), 5],
  [11, t(language, `${n('pavel', language)} promised the cart was ${n('mara', language)}'s now.`, `${n('pavel', language)}说大车现在归${n('mara', language)}了。`), 4],
  [12, t(language, `The harbor master visited the kitchen and asked ${n('elias', language)} about the letter.`, `港务长来到厨房，向${n('elias', language)}问起那封信。`), 4],
].map(([turn, text, importance]) => ({ turn: turn as number, text: text as string, importance: importance as number }))

const digests = (language: Language): ChroniclerFixture['summaries'] => [
  { level: 'digest', fromTurn: 1, toTurn: 3, text: t(language, `${n('mara', language)} arrived with a letter for ${n('elias', language)}, who let her stay until the rent falls due on the fifth. ${n('pavel', language)} demanded forty coins for the cart and gave her until Friday.`, `${n('mara', language)}带着给${n('elias', language)}的信来到这里，${n('elias', language)}让她住到五号房租到期。${n('pavel', language)}为大车索要四十枚硬币，给她宽限到周五。`) },
  { level: 'digest', fromTurn: 4, toTurn: 6, text: t(language, `${n('mara', language)} promised ${n('pavel', language)} payment by Friday. ${n('odile', language)} lent a lamp and warned that the lane floods. ${n('elias', language)} said the harbor master distrusts ${n('pavel', language)}.`, `${n('mara', language)}向${n('pavel', language)}保证周五前还钱。${n('odile', language)}借出一盏灯，并提醒小巷会积水。${n('elias', language)}说港务长不信任${n('pavel', language)}。`) },
  { level: 'digest', fromTurn: 7, toTurn: 9, text: t(language, `${n('mara', language)} sold her mother's ring at the market for forty coins. ${n('elias', language)} grew suspicious when she returned without it, and ${n('odile', language)} saw her counting coins by the lamp.`, `${n('mara', language)}在集市上以四十枚硬币卖掉了母亲的戒指。她没戴戒指回来，${n('elias', language)}起了疑心，${n('odile', language)}还看见她在灯下数硬币。`) },
  { level: 'digest', fromTurn: 10, toTurn: 12, text: t(language, `On Friday ${n('mara', language)} paid ${n('pavel', language)} forty coins and he struck the debt from his book, promising the cart was hers. The harbor master visited the kitchen and asked about the letter.`, `周五，${n('mara', language)}付给${n('pavel', language)}四十枚硬币，他划掉了账，说大车归她了。港务长来到厨房，问起那封信。`) },
]

const chapters = (language: Language): ChroniclerFixture['summaries'] => [
  { level: 'chapter', fromTurn: 1, toTurn: 6, text: t(language, `${n('mara', language)} came to the kitchen and was allowed to stay until the rent on the fifth. ${n('pavel', language)} demanded thirty coins for the cart by Friday, and ${n('mara', language)} promised to pay. ${n('elias', language)} said the harbor master distrusts ${n('pavel', language)}.`, `${n('mara', language)}来到厨房，被允许住到五号交房租。${n('pavel', language)}为大车索要三十枚硬币，限周五之前，${n('mara', language)}答应还钱。${n('elias', language)}说港务长不信任${n('pavel', language)}。`) },
  { level: 'chapter', fromTurn: 7, toTurn: 12, text: t(language, `${n('mara', language)} sold her mother's ring and paid the debt on Friday; the cart became hers. The harbor master asked about the letter.`, `${n('mara', language)}卖掉母亲的戒指，周五还清了债，大车归她所有。港务长问起那封信。`) },
]

export const HELPER_CASES: HelperCase[] = [
  suggest('letter', language => [narration(t(language, `${n('elias', language)} wipes flour from his hands and sets an envelope on the table beside the lamp ${n('odile', language)} lent.`, `${n('elias', language)}擦掉手上的面粉，把一封信放在${n('odile', language)}借来的灯旁边的桌上。`)), says(n('elias', language), t(language, 'The harbor master left this for you this morning.', '港务长今早把这个留给你的。'))], { en: 'The kitchen', zh: '厨房' }, language => [n('pavel', language)]),
  suggest('rain', language => [narration(t(language, `Rain drums on the roof. ${n('odile', language)} pulls the shutters closed and lights the lamp, humming, while the lane outside begins to flood.`, `雨点敲打着屋顶。${n('odile', language)}拉上百叶窗，点亮灯，轻声哼着歌，门外的小巷开始积水。`))], { en: 'The kitchen', zh: '厨房' }, language => [n('pavel', language), n('elias', language)]),
  suggest('debt', language => [narration(t(language, `${n('pavel', language)} opens his ledger and taps the page.`, `${n('pavel', language)}翻开账本，用手指点了点那一页。`)), says(n('pavel', language), t(language, 'Forty coins, and the day is Friday.', '四十枚硬币，日子是周五。'))], { en: 'The kitchen', zh: '厨房' }, language => [n('odile', language), n('elias', language)]),
  { id: 'chronicler-digest', helper: 'chronicler', chronicler: language => ({ level: 'digest', events: EVENTS(language).slice(0, 6), summaries: [], limits: { shortTermTokens: 400, longTermTokens: 2500 }, uptoTurn: 6, playerInputs: t(language, 'I give the letter to Elias. I ask Pavel for time. I promise to pay by Friday.', '我把信交给陈远。我向吴峰求宽限。我保证周五前还钱。'), keeps: [t(language, 'forty', '四十'), t(language, 'Friday', '周五')], lacks: [] }) },
  { id: 'chronicler-chapter', helper: 'chronicler', chronicler: language => ({ level: 'chapter', events: EVENTS(language), summaries: digests(language), limits: { shortTermTokens: 100, longTermTokens: 2500 }, uptoTurn: 12, playerInputs: '', keeps: [t(language, 'forty', '四十'), t(language, 'ring', '戒指')], lacks: [] }) },
  { id: 'chronicler-condense', helper: 'chronicler', chronicler: language => ({ level: 'chapter', events: EVENTS(language), summaries: chapters(language), limits: { shortTermTokens: 5000, longTermTokens: 60 }, uptoTurn: 12, playerInputs: '', keeps: [t(language, 'forty', '四十')], lacks: [t(language, 'thirty', '三十')] }) },
  ...(['continues', 'achieved', 'moot'] as const).map((kind): HelperCase => ({
    id: `strategist-${kind}`, helper: 'strategist',
    strategist: (language): StrategistFixture => ({
      name: t(language, 'The Guild', '商会'), summary: t(language, 'The guild of harbor traders.', '港口商人的商会。'), values: [t(language, 'order', '秩序')],
      publicState: t(language, 'Respected and busy.', '受人尊敬，事务繁忙。'), innerState: t(language, 'Anxious about the market.', '为市场的事焦虑。'),
      goals: kind === 'continues'
        ? [{ name: t(language, 'Control the market', '掌控市场'), description: t(language, 'Bring the harbor market stalls under the guild\'s licence.', '让港口市场的摊位都归商会发牌。'), plan: [t(language, 'Win over the stall inspector', '拉拢摊位巡查')] }]
        : kind === 'achieved'
          ? [{ name: t(language, 'Win the market charter', '取得市场特许状'), description: t(language, 'Get the council to give the guild the market charter.', '让议会把市场特许状授予商会。'), plan: [t(language, 'Petition the council', '向议会请愿')] }]
          : [{ name: t(language, 'Deliver the spice cargo before the festival', '在庆典前交付香料货物'), description: t(language, 'Bring the spice ship\'s whole cargo to the harbor in time for the festival.', '让香料船的全部货物赶在庆典前运到港口。'), plan: [t(language, 'Meet the ship at the outer anchorage', '到外锚地接船')] }],
      events: kind === 'continues'
        ? [t(language, 'Odile held a small festival in the lane.', '周婉在小巷里办了一场小庆典。'), t(language, 'Rain washed out the evening market.', '雨水冲散了晚市。')]
        : kind === 'achieved'
          ? [t(language, 'The council signed the market charter over to the Guild at noon.', '议会在正午把市场特许状签给了商会。')]
          : [t(language, 'The spice ship broke up on the rocks in the night storm and its whole cargo was lost to the sea.', '香料船在夜里的风暴中撞上礁石解体，整船货物沉入海中。')],
      expectStatus: kind === 'continues' ? 'active' : kind === 'achieved' ? 'completed' : 'ended',
    }),
  })),
  { id: 'plot-quiet', helper: 'plot', plot: (language): PlotFixture => ({
    cast: [{ key: 'mara', name: n('mara', language), summary: t(language, 'A newcomer with a letter of introduction.', '带着介绍信的新来者。'), player: true }, { key: 'elias', name: n('elias', language), summary: t(language, 'Keeps the kitchen.', '经营厨房。') }, { key: 'odile', name: n('odile', language), summary: t(language, 'A neighbour who lends lamps.', '爱借灯的邻居。') }, { key: 'pavel', name: n('pavel', language), summary: t(language, 'Collects what is owed.', '专门讨债。') }],
    faction: { name: t(language, 'The Guild', '商会'), summary: t(language, 'The guild of harbor traders.', '港口商人的商会。') },
    place: t(language, 'The kitchen', '厨房'),
    events: [t(language, 'The debt for the cart was paid.', '大车的欠款已还清。'), t(language, 'The harbor master asked about a letter.', '港务长问起一封信。'), t(language, 'The lane flooded and then dried.', '小巷淹了水又干了。')],
    uses: [n('pavel', language), n('elias', language), n('odile', language), t(language, 'harbor master', '港务长'), t(language, 'Guild', '商会'), t(language, 'letter', '信')],
  }) },
  { id: 'plot-feud', helper: 'plot', plot: (language): PlotFixture => ({
    cast: [{ key: 'mara', name: n('mara', language), summary: t(language, 'A newcomer with a letter of introduction.', '带着介绍信的新来者。'), player: true }, { key: 'elias', name: n('elias', language), summary: t(language, 'Keeps the kitchen.', '经营厨房。') }, { key: 'odile', name: n('odile', language), summary: t(language, 'A neighbour who lends lamps.', '爱借灯的邻居。') }, { key: 'pavel', name: n('pavel', language), summary: t(language, 'Collects what is owed.', '专门讨债。') }],
    faction: { name: t(language, 'The Guild', '商会'), summary: t(language, 'The guild of harbor traders.', '港口商人的商会。') },
    place: t(language, 'The kitchen', '厨房'),
    events: [t(language, 'Pavel and Elias quarrelled over an old unpaid bill.', '吴峰和陈远为一笔旧账吵了一架。'), t(language, 'Odile said the Guild is raising the price of flour.', '周婉说商会要给面粉涨价。')],
    uses: [n('pavel', language), n('elias', language), n('odile', language), t(language, 'harbor master', '港务长'), t(language, 'Guild', '商会'), t(language, 'letter', '信')],
  }) },
]

const named = (language: Language) => ({ player: t(language, 'Rowan', '沈岚'), keeper: t(language, 'Bryn', '袁松'), neighbour: t(language, 'Sable', '顾蕊'), collector: t(language, 'Lorcan', '贺铮') })

/** Cases written after the prompts: another story (a river ferry and a tea cellar), other names, other wording. */
export const HELDOUT_HELPER_CASES: HelperCase[] = [
  ...(['continues', 'achieved', 'moot'] as const).map((kind): HelperCase => ({
    id: `strategist-h-${kind}`, helper: 'strategist',
    strategist: (language): StrategistFixture => ({
      name: t(language, 'The Toll House', '渡口税所'), summary: t(language, 'The office that taxes river traffic.', '向河上往来收税的衙门。'), values: [t(language, 'thrift', '节俭')],
      publicState: t(language, 'Busy before the thaw.', '解冻前忙碌。'), innerState: t(language, 'Short of coin.', '缺钱。'),
      goals: kind === 'continues'
        ? [{ name: t(language, 'Control the ferry crossing', '掌管渡口'), description: t(language, 'Put every ferry on the river under the office\'s permit.', '让河上每条渡船都领税所的牌照。'), plan: [t(language, 'Count the boats', '清点船只')] }]
        : kind === 'achieved'
          ? [{ name: t(language, 'Secure the bridge contract', '拿下造桥合同'), description: t(language, 'Be the office the prefect names for the new bridge.', '成为知府指定承建新桥的衙门。'), plan: [t(language, 'Lobby the prefect\'s clerk', '游说知府的书吏')] }]
          : [{ name: t(language, 'Hire the master stonemason', '聘请石匠大师'), description: t(language, 'Bring the one master stonemason of the valley into the office\'s pay.', '把山谷里唯一的石匠大师请进税所做事。'), plan: [t(language, 'Offer him a winter wage', '开出冬季工钱')] }],
      events: kind === 'continues'
        ? [t(language, 'Sable led a lantern night on the hill.', '顾蕊在山上办了一场灯夜。'), t(language, 'Fog settled on the path for two days.', '雾在小路上笼罩了两天。')]
        : kind === 'achieved'
          ? [t(language, 'The prefect signed the bridge contract over to the Toll House.', '知府把造桥合同签给了渡口税所。')]
          : [t(language, 'The master stonemason died of the winter fever, and no one else in the valley can cut the bridge stone.', '石匠大师死于冬季热病，山谷里再没有人能凿桥石。')],
      expectStatus: kind === 'continues' ? 'active' : kind === 'achieved' ? 'completed' : 'ended',
    }),
  })),
  ...(['ferry', 'cellar'] as const).map((kind): HelperCase => ({
    id: `plot-h-${kind}`, helper: 'plot',
    plot: (language): PlotFixture => ({
      cast: [{ key: 'mara', name: named(language).player, summary: t(language, 'A traveller with a sealed pass.', '带着封印通行证的旅人。'), player: true }, { key: 'elias', name: named(language).keeper, summary: t(language, 'Keeps the tea cellar.', '看管茶窖。') }, { key: 'odile', name: named(language).neighbour, summary: t(language, 'Rings the bell and mends nets.', '敲钟、补网。') }, { key: 'pavel', name: named(language).collector, summary: t(language, 'Collects the river toll.', '收河上的过路费。') }],
      faction: { name: t(language, 'The Toll House', '渡口税所'), summary: t(language, 'The office that taxes river traffic.', '向河上往来收税的衙门。') },
      place: t(language, 'The tea cellar', '茶窖'),
      events: kind === 'ferry'
        ? [t(language, 'The overdue ferry toll was paid in full.', '过期的渡口过路费已全部交清。'), t(language, 'The ferryman asked who owned the sealed pass.', '船夫问起那份封印通行证是谁的。')]
        : [t(language, 'The cellar was drained before the thaw.', '解冻前地窖已排干。'), t(language, 'Fog lay on the hill path two nights running.', '山路上的雾接连两夜不散。')],
      uses: [named(language).collector, named(language).keeper, named(language).neighbour, t(language, 'Toll House', '税所'), t(language, 'toll', '过路费'), t(language, 'pass', '通行证'), t(language, 'cellar', '地窖')],
    }),
  })),
]
