import type { CommitEntry } from '../../src/host/orchestration/boundaries.ts'
import { CAST, PLAYER, type Who } from './attribution-cases.ts'
import type { Language } from './language.ts'

export type EntryBody = Omit<CommitEntry, 'name' | 'spoken' | 'commitment' | 'intent'>

/** What the records of a round must hold about claims, checked by structure and ids, never by wording. */
export type Expect =
  | { rule: 'claim-by'; who: Who }
  | { rule: 'no-claims' }
  /** Evidence for or against the claim already recorded (number 1): a link to an event of the round, only with these bearings. */
  | { rule: 'link'; allowed: readonly ('confirms' | 'contradicts' | 'supports' | 'undermines')[]; forbidden: readonly ('confirms' | 'contradicts' | 'supports' | 'undermines')[] }
  | { rule: 'no-decisive' }
  | { rule: 'rival-set'; between: readonly [Who, Who] }
  | { rule: 'no-question' }
  | { rule: 'hidden-from'; who: Who }

/**
 * One round whose records are due, with what was recorded before it. Each case probes one failure the claims layer is prone to: a claim made of a plain fact, a theory left unrecorded, evidence linked with
 * the wrong sign or as decisive when it is only talk, rival theories left unrelated or compatible ones related, a concealment missed.
 */
export interface ClaimsCase {
  id: string
  kind: 'theory' | 'plain' | 'against' | 'for' | 'talk' | 'replaced' | 'rivals' | 'compatible' | 'hidden'
  present: Who[]
  /** The events and claims recorded before the round: events are numbered from 1 in order; a claim is made in the event named. */
  prior: (language: Language) => { events: { text: string; seen: Who[] }[]; claims: { text: string; by: Who; event: number }[] }
  situation: (language: Language) => string
  entries: (language: Language) => EntryBody[]
  expect: Expect
}

const said = (character: Who, utterance: string, summary: string): EntryBody => ({ character, utterance, result: 'succeeded', summary, ...(character === PLAYER ? { player: true as const } : {}) })
const did = (character: Who, summary: string): EntryBody => ({ character, result: 'succeeded', summary, ...(character === PLAYER ? { player: true as const } : {}) })

type Texts = {
  situation: string
  entries: EntryBody[]
  prior?: { events: { text: string; seen: Who[] }[]; claims: { text: string; by: Who; event: number }[] }
}

const make = (made: Omit<ClaimsCase, 'situation' | 'entries' | 'prior'> & { en: Texts; zh: Texts }): ClaimsCase => ({
  id: made.id, kind: made.kind, present: made.present, expect: made.expect,
  situation: language => made[language].situation,
  entries: language => made[language].entries,
  prior: language => made[language].prior ?? { events: [], claims: [] },
})

const ledgerEn = { events: [{ text: 'Odile said she thinks Pavel took the ledger from the study.', seen: ['odile', 'mara'] as Who[] }], claims: [{ text: 'Pavel took the ledger from the study.', by: 'odile' as Who, event: 1 }] }
const ledgerZh = { events: [{ text: '周婉说她认为是吴峰从书房拿走了账本。', seen: ['odile', 'mara'] as Who[] }], claims: [{ text: '吴峰从书房拿走了账本。', by: 'odile' as Who, event: 1 }] }
const gardenEn = { events: [{ text: 'Odile said the figure in the garden last night was Pavel.', seen: ['odile', 'mara'] as Who[] }], claims: [{ text: 'The figure in the garden last night was Pavel.', by: 'odile' as Who, event: 1 }] }
const gardenZh = { events: [{ text: '周婉说昨晚花园里的人影是吴峰。', seen: ['odile', 'mara'] as Who[] }], claims: [{ text: '昨晚花园里的人影是吴峰。', by: 'odile' as Who, event: 1 }] }

export const CLAIMS_CASES: ClaimsCase[] = [
  make({
    id: 'theory', kind: 'theory', present: ['mara', 'odile'], expect: { rule: 'claim-by', who: 'odile' },
    en: { situation: 'In the study, Mara asks who could have taken the ledger. Odile says she suspects Pavel, because he was alone in the house that evening, but she has no proof.', entries: [did('mara', 'Mara asked who could have taken the ledger.'), said('odile', '"I think it was Pavel. He was alone in the house that evening."', 'Odile suspected Pavel of taking the ledger, without proof.')] },
    zh: { situation: '在书房里，林夏问谁可能拿走了账本。周婉说她怀疑是吴峰，因为那天晚上他一个人在家，但她没有证据。', entries: [did('mara', '林夏问谁可能拿走了账本。'), said('odile', '“我觉得是吴峰。那天晚上他一个人在家。”', '周婉怀疑吴峰拿走了账本，但没有证据。')] },
  }),
  make({
    id: 'plain-fact', kind: 'plain', present: ['mara', 'elias'], expect: { rule: 'no-claims' },
    en: { situation: 'In the hall, Elias unlocks the cellar door and shows Mara that the cellar is empty. Nobody offers any opinion about why.', entries: [did('elias', 'Elias unlocked the cellar door and showed Mara the empty cellar.'), did('mara', 'Mara looked into the empty cellar.')] },
    zh: { situation: '在大厅里，陈远打开地窖门，让林夏看到地窖是空的。没有人对原因发表任何看法。', entries: [did('elias', '陈远打开了地窖门，让林夏看了空空的地窖。'), did('mara', '林夏朝空空的地窖里看了看。')] },
  }),
  make({
    id: 'evidence-against', kind: 'against', present: ['mara', 'elias'], expect: { rule: 'link', allowed: ['contradicts', 'undermines'], forbidden: ['confirms', 'supports'] },
    en: { situation: 'In the study, Mara finds the ledger in Elias\'s own desk drawer, under his papers.', entries: [did('mara', 'Mara found the missing ledger in Elias\'s desk drawer.'), did('elias', 'Elias stared at the ledger in his own drawer.')], prior: ledgerEn },
    zh: { situation: '在书房里，林夏在陈远自己的书桌抽屉里、他的文件下面找到了账本。', entries: [did('mara', '林夏在陈远的书桌抽屉里找到了丢失的账本。'), did('elias', '陈远盯着自己抽屉里的账本。')], prior: ledgerZh },
  }),
  make({
    id: 'evidence-for', kind: 'for', present: ['mara', 'pavel'], expect: { rule: 'link', allowed: ['confirms', 'supports'], forbidden: ['contradicts', 'undermines'] },
    en: { situation: 'In the study, Mara walks in on Pavel with the ledger under his arm. He admits he took it from the study last night.', entries: [did('mara', 'Mara saw Pavel carrying the ledger.'), said('pavel', '"Yes, I took it from the study last night."', 'Pavel admitted he took the ledger from the study.')], prior: ledgerEn },
    zh: { situation: '在书房里，林夏撞见吴峰腋下夹着账本。他承认昨晚是他从书房拿走的。', entries: [did('mara', '林夏看见吴峰拿着账本。'), said('pavel', '“是的，昨晚是我从书房拿走的。”', '吴峰承认是他从书房拿走了账本。')], prior: ledgerZh },
  }),
  make({
    id: 'talk-only', kind: 'talk', present: ['mara', 'elias'], expect: { rule: 'no-decisive' },
    en: { situation: 'In the hall, Elias tells Mara that Pavel would never touch the ledger and that Odile is wrong. He has seen nothing and offers no evidence.', entries: [said('elias', '"Pavel would never touch that ledger. Odile is wrong, believe me."', 'Elias insisted Pavel is innocent, with nothing to show for it.'), did('mara', 'Mara listened.')], prior: ledgerEn },
    zh: { situation: '在大厅里，陈远告诉林夏，吴峰绝不会碰那本账本，周婉说错了。他什么也没看见，也拿不出任何证据。', entries: [said('elias', '“吴峰绝不会碰那本账本。周婉说错了，相信我。”', '陈远坚称吴峰是清白的，但拿不出任何东西。'), did('mara', '林夏听着。')], prior: ledgerZh },
  }),
  make({
    id: 'replaced', kind: 'replaced', present: ['mara', 'pavel'], expect: { rule: 'link', allowed: ['contradicts', 'undermines'], forbidden: ['confirms', 'supports'] },
    en: { situation: 'In the garden, Mara and Pavel examine the tracks in the mud by the gate. The tracks are a fox\'s, not a person\'s.', entries: [did('mara', 'Mara examined the tracks by the gate and found they were a fox\'s.'), did('pavel', 'Pavel crouched beside the fox tracks.')], prior: gardenEn },
    zh: { situation: '在花园里，林夏和吴峰查看门边泥地上的脚印。那是狐狸的脚印，不是人的。', entries: [did('mara', '林夏查看了门边的脚印，发现是狐狸的。'), did('pavel', '吴峰蹲在狐狸的脚印旁边。')], prior: gardenZh },
  }),
  make({
    id: 'rivals', kind: 'rivals', present: ['mara', 'odile', 'pavel'], expect: { rule: 'rival-set', between: ['odile', 'pavel'] },
    en: { situation: 'After the fire in the barn, Odile says it was an accident: the lamp tipped over. Pavel says no, someone set it on purpose. Neither has proof, and Mara cannot yet tell.', entries: [said('odile', '"It was an accident. The lamp tipped over."', 'Odile claimed the barn fire was an accident.'), said('pavel', '"No. Someone set it on purpose."', 'Pavel claimed the barn fire was set on purpose.')] },
    zh: { situation: '谷仓失火后，周婉说那是意外：油灯翻倒了。吴峰说不对，是有人故意放的火。两人都拿不出证据，林夏也还判断不了。', entries: [said('odile', '“是意外。油灯翻倒了。”', '周婉声称谷仓的火是意外。'), said('pavel', '“不对。是有人故意放的火。”', '吴峰声称谷仓的火是人为放的。')] },
  }),
  make({
    id: 'compatible', kind: 'compatible', present: ['mara', 'odile', 'pavel'], expect: { rule: 'no-question' },
    en: { situation: 'In the cellar, Odile says it is damp down here. Pavel says the door to the cellar was locked when he came.', entries: [said('odile', '"It is damp down here."', 'Odile said the cellar is damp.'), said('pavel', '"The cellar door was locked when I came."', 'Pavel said the cellar door was locked when he came.')] },
    zh: { situation: '在地窖里，周婉说这下面很潮。吴峰说他来的时候地窖的门是锁着的。', entries: [said('odile', '“这下面很潮。”', '周婉说地窖很潮。'), said('pavel', '“我来的时候地窖的门是锁着的。”', '吴峰说他来的时候地窖的门是锁着的。')] },
  }),
  make({
    id: 'hidden', kind: 'hidden', present: ['mara', 'elias', 'odile'], expect: { rule: 'hidden-from', who: 'elias' },
    en: { situation: 'In the parlor, while Elias stands at the window with his back to the room, Mara slips the letter from the table into her sleeve. Odile sees it and says nothing. Mara is deliberately hiding the letter from Elias.', entries: [did('mara', 'Mara slipped the letter from the table into her sleeve, hiding it from Elias.'), did('odile', 'Odile saw Mara take the letter and said nothing.'), did('elias', 'Elias stood at the window with his back to the room.')] },
    zh: { situation: '在客厅里，陈远背对房间站在窗边时，林夏把桌上的信塞进了袖子。周婉看见了，什么也没说。林夏是有意把信瞒着陈远。', entries: [did('mara', '林夏把桌上的信塞进了袖子，瞒着陈远。'), did('odile', '周婉看见林夏拿走了信，什么也没说。'), did('elias', '陈远背对房间站在窗边。')] },
  }),
]

export { CAST }
