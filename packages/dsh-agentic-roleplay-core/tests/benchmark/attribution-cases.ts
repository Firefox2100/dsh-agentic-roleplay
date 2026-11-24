import type { CommitEntry } from '../../src/host/orchestration/boundaries.ts'
import type { Language } from './language.ts'
import { pick } from './language.ts'

/** The invented cast of the attribution cases: the player's character and three others. */
export const PLAYER = 'mara'
export const CAST = ['mara', 'elias', 'odile', 'pavel'] as const
export type Who = (typeof CAST)[number]

/** The held-out set tells other stories with other names; the roles stay (the player, a keeper, a neighbour, a collector). */
const HELD_OUT = process.env['BENCH_CAST'] === 'held'

export const castName = (key: Who, language: Language): string => pick(language)(
  (HELD_OUT ? { mara: 'Rowan', elias: 'Bryn', odile: 'Sable', pavel: 'Lorcan' } : { mara: 'Mara', elias: 'Elias', odile: 'Odile', pavel: 'Pavel' })[key],
  (HELD_OUT ? { mara: '沈岚', elias: '袁松', odile: '顾蕊', pavel: '贺铮' } : { mara: '林夏', elias: '陈远', odile: '周婉', pavel: '吴峰' })[key],
)

/**
 * One round whose records are due, and what the records must not get wrong about who said, heard or did what. A fact that is only quoted, reported, claimed or gossiped about belongs to the
 * people in the conversation: the person it is about, who was not there, perceives nothing and changes in no way,.
 */
export interface AttributionCase {
  id: string
  /** What kind of failure the case probes. */
  kind: 'quoted' | 'reported' | 'gossip' | 'lie' | 'retold'
  /** Who is in the room (they perceive each other). */
  present: Who[]
  /** Not there: nothing may be recorded as perceived by, believed by or changing for them. */
  untouched: Who[]
  /** A person who spoke, who the records must show as involved in some event. */
  speaker: Who
  situation: (language: Language) => string
  entries: (language: Language) => Omit<CommitEntry, 'name' | 'spoken' | 'commitment' | 'intent'>[]
}

const said = (character: Who, utterance: string, summary: string): Omit<CommitEntry, 'name' | 'spoken' | 'commitment' | 'intent'> => ({ character, utterance, result: 'succeeded', summary, ...(character === PLAYER ? { player: true as const } : {}) })
const did = (character: Who, summary: string): Omit<CommitEntry, 'name' | 'spoken' | 'commitment' | 'intent'> => ({ character, result: 'succeeded', summary, ...(character === PLAYER ? { player: true as const } : {}) })

const make = (made: Omit<AttributionCase, 'situation' | 'entries'> & { en: { situation: string; entries: ReturnType<AttributionCase['entries']> }; zh: { situation: string; entries: ReturnType<AttributionCase['entries']> } }): AttributionCase => ({
  ...made,
  situation: language => made[language].situation,
  entries: language => made[language].entries,
})

export const ATTRIBUTION_CASES: AttributionCase[] = [
  make({
    id: 'quoted-claim', kind: 'quoted', present: ['mara', 'odile'], untouched: ['elias', 'pavel'], speaker: 'odile',
    en: { situation: 'In the kitchen, Mara asks Odile why the cellar is locked. Odile answers, repeating what Elias told her yesterday.', entries: [did('mara', 'Mara asked Odile why the cellar is locked.'), said('odile', '"Elias told me yesterday that the cellar key is lost, so nobody goes down."', 'Odile repeated what Elias had told her about the cellar key.')] },
    zh: { situation: '在厨房里，林夏问周婉地窖为什么上了锁。周婉转述了陈远昨天对她说的话。', entries: [did('mara', '林夏问周婉地窖为什么上了锁。'), said('odile', '“陈远昨天告诉我地窖的钥匙丢了，所以没人下去。”', '周婉转述了陈远关于地窖钥匙的话。')] },
  }),
  make({
    id: 'reported-sighting', kind: 'reported', present: ['mara', 'odile'], untouched: ['pavel'], speaker: 'mara',
    en: { situation: 'In the hall, Mara tells Odile that last night she saw Pavel slip out through the garden gate. Pavel is asleep upstairs and hears nothing.', entries: [said('mara', '"Last night I saw Pavel slip out through the garden gate."', 'Mara told Odile she had seen Pavel leave through the garden gate.'), did('odile', 'Odile listened and frowned.')] },
    zh: { situation: '在大厅里，林夏告诉周婉，昨晚她看见吴峰从花园门溜了出去。吴峰在楼上睡着，什么也没听见。', entries: [said('mara', '“昨晚我看见吴峰从花园门溜了出去。”', '林夏告诉周婉她看见吴峰从花园门离开。'), did('odile', '周婉听着，皱起了眉。')] },
  }),
  make({
    id: 'gossip-absent', kind: 'gossip', present: ['mara', 'odile'], untouched: ['elias', 'pavel'], speaker: 'odile',
    en: { situation: 'Mara and Odile talk over tea about Elias, who is out of town. Odile says he once left his own wedding before the vows.', entries: [did('mara', 'Mara poured the tea and asked about Elias.'), said('odile', '"They say Elias walked out of his own wedding before the vows."', 'Odile passed on a rumour about Elias leaving his wedding.')] },
    zh: { situation: '林夏和周婉喝茶闲谈，说起不在城里的陈远。周婉说他当年在誓言之前离开了自己的婚礼。', entries: [did('mara', '林夏倒了茶，问起陈远。'), said('odile', '“听说陈远当年在宣誓之前就离开了自己的婚礼。”', '周婉转述了一个关于陈远离开婚礼的传闻。')] },
  }),
  make({
    id: 'false-accusation', kind: 'lie', present: ['mara', 'odile', 'pavel'], untouched: ['elias'], speaker: 'pavel',
    en: { situation: 'In the study, Pavel tells Mara and Odile he saw Elias take the ledger. The narration makes clear that Elias was in another town all day; Pavel is lying to deflect blame.', entries: [said('pavel', '"I saw Elias take the ledger off the desk this morning."', 'Pavel falsely accused Elias of taking the ledger.'), did('mara', 'Mara watched Pavel closely.'), did('odile', 'Odile said nothing.')] },
    zh: { situation: '在书房里，吴峰对林夏和周婉说他看见陈远拿走了账本。叙述明确说明陈远整天都在另一座城里；吴峰是在撒谎转移责任。', entries: [said('pavel', '“今天早上我看见陈远把账本从桌上拿走了。”', '吴峰谎称陈远拿走了账本。'), did('mara', '林夏紧盯着吴峰。'), did('odile', '周婉没有说话。')] },
  }),
  make({
    id: 'two-speakers', kind: 'quoted', present: ['mara', 'odile', 'pavel'], untouched: ['elias'], speaker: 'pavel',
    en: { situation: 'At the table, Pavel says Odile once told him that Elias plans to sell the house. Odile answers that she said no such thing. Elias is not there.', entries: [said('pavel', '"Odile told me Elias plans to sell the house."', 'Pavel said Odile had told him Elias plans to sell the house.'), said('odile', '"I never said that."', 'Odile denied having said it.'), did('mara', 'Mara looked from one to the other.')] },
    zh: { situation: '在桌边，吴峰说周婉曾告诉他陈远打算卖掉房子。周婉说她从没说过这话。陈远不在场。', entries: [said('pavel', '“周婉告诉我陈远打算卖掉房子。”', '吴峰说周婉曾告诉他陈远打算卖房。'), said('odile', '“我从没说过这话。”', '周婉否认说过。'), did('mara', '林夏在两人之间来回看。')] },
  }),
  make({
    id: 'retold', kind: 'retold', present: ['mara', 'odile'], untouched: ['elias', 'pavel'], speaker: 'odile',
    en: { situation: 'Odile tells Mara what Pavel said to her this morning: that Elias is leaving the district. Neither Pavel nor Elias is present.', entries: [said('odile', '"This morning Pavel said Elias is leaving the district."', 'Odile repeated Pavel\'s remark that Elias is leaving the district.'), did('mara', 'Mara took in the news without comment.')] },
    zh: { situation: '周婉把吴峰今天早上对她说的话转告林夏：陈远要离开这个地区。吴峰和陈远都不在场。', entries: [said('odile', '“今天早上吴峰说陈远要离开这个地区了。”', '周婉转述了吴峰所说陈远要离开此地的话。'), did('mara', '林夏听了这消息，没有说什么。')] },
  }),
]
