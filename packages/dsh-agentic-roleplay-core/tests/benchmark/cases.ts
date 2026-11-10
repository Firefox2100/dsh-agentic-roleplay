import type { Files, Language } from './language.ts'
import { pick } from './language.ts'
import { saltHarbor } from './salt-harbor.ts'
import { TAG_LAYOUT } from './panel-cards.ts'
import { cardWorld, cardTexts, cardOf, CHOICES, type CardTexts } from './card-world.ts'

/** A finding a case expects: the check that makes it, its code, and where or what it says. */
export interface Expect {
  check: string
  code: string
  /** A part of where the finding points (a file or a key), the same in both languages. */
  where?: string
  /** A part of the message that is the same in both languages (a key, an id). */
  text?: string
}

export type CaseKind = 'defect' | 'clean' | 'ambiguous'

/** One world that has a known defect (or none), and the findings of the checks it is run with. */
export interface BenchCase {
  id: string
  title: string
  kind: CaseKind
  /** The checks run on it. */
  checks: readonly string[]
  /** Whether a model is needed to judge. */
  judged: boolean
  /** The card the world is compared with: the one it was made from, or the newer one waiting to update it. */
  card?: 'current' | 'new'
  build(language: Language): Files
  /** What must be found, and nothing else may be found except `allowed`. */
  expect: readonly Expect[]
  /** What may be found without counting against the case. */
  allowed?: readonly Expect[]
}

/** The one thing every case may find: the signal room has a rope down the cliff and no way back, which is the world's way of showing a way that goes one direction. */
export const BASELINE: readonly Expect[] = [{ check: 'world-graph', code: 'exit-no-way-back', where: 'signal-room->pier' }]

export const matches = (finding: { check: string; code: string; where: string; message: string }, expected: Expect): boolean =>
  finding.check === expected.check && finding.code === expected.code
  && (expected.where === undefined || finding.where.includes(expected.where) || finding.message.includes(expected.where))
  && (expected.text === undefined || finding.message.includes(expected.text))

type Change = (files: Files, language: Language) => void
export const edit = (path: string, change: (value: Record<string, unknown>, language: Language) => void): Change => (files, language) => {
  const value = files.get(path)
  if (typeof value !== 'object' || value === null) throw new Error(`the benchmark world has no ${path}`)
  const copy = structuredClone(value) as Record<string, unknown>
  change(copy, language)
  files.set(path, copy)
}
export const add = (path: string, make: (language: Language) => unknown): Change => (files, language) => { files.set(path, make(language)) }
export const drop = (path: string): Change => (files) => { files.delete(path) }
export const editList = (path: string, change: (list: Record<string, unknown>[]) => void): Change => (files) => {
  const list = structuredClone(files.get(path)) as Record<string, unknown>[]
  change(list)
  files.set(path, list)
}

/** A case made from the base world and a list of changes. */
function made(spec: Omit<BenchCase, 'build'> & { changes: readonly Change[] }, base: (language: Language) => Files = saltHarbor): BenchCase {
  const { changes, ...rest } = spec
  return { ...rest, build: (language) => { const files = base(language); for (const change of changes) change(files, language); return files } }
}

const CODE_CHECKS = ['world-valid', 'world-graph', 'duplicate-values', 'name-clashes', 'name-confusable', 'world-prompts', 'unread-fields', 'quality-cast', 'quality-places', 'quality-world', 'quality-panels', 'first-scene'] as const

const t = (language: Language) => pick(language)

export const CODE_CASES: readonly BenchCase[] = [
  made({ id: 'clean', title: 'the sound world', kind: 'clean', checks: CODE_CHECKS, judged: false, changes: [], expect: [] }),

  // a story could not start from the world
  made({ id: 'start-place-unknown', title: 'a character starts in a place that is not in the world', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/mara/character.json', (c) => { (c['start'] as Record<string, unknown>)['location'] = 'nowhere' })], expect: [{ check: 'world-valid', code: 'invalid', text: 'nowhere' }], allowed: [{ check: 'first-scene', code: 'start-nowhere' }] }),
  made({ id: 'relationship-target-unknown', title: 'a relationship names a character who does not exist', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/tomas/character.json', (c) => { (c['relationships'] as Record<string, unknown>[]).push({ to: 'ghost', label: 'x' }) })], expect: [{ check: 'world-valid', code: 'invalid', text: 'ghost' }] }),
  made({ id: 'trigger-place-unknown', title: 'a trigger waits for a place that is not in the world', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [editList('triggers.json', (list) => { (list[3]!['when'] as Record<string, unknown>)['location'] = 'sea-cave' })], expect: [{ check: 'world-valid', code: 'invalid', text: 'sea-cave' }] }),
  made({ id: 'key-unknown', title: 'a lock is opened by a thing that does not exist', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('locations/pier/location.json', (c) => { ((c['exits'] as Record<string, unknown>[])[1]!)['opened_by'] = ['master-key'] })], expect: [{ check: 'world-valid', code: 'invalid', text: 'master-key' }] }),
  made({ id: 'value-undeclared', title: 'a character starts with a value the world never declares', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/kit/character.json', (c) => { c['variables'] = { courage: 4 } })], expect: [{ check: 'world-valid', code: 'invalid', text: 'courage' }] }),
  made({ id: 'lore-subject-unknown', title: 'a background entry is about a place that is not there', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('lore/fog-bell/lore.json', (c) => { c['subjects'] = [{ kind: 'location', id: 'bell-tower' }] })], expect: [{ check: 'world-valid', code: 'invalid', text: 'bell-tower' }] }),
  made({ id: 'faction-member-unknown', title: 'an organisation lists a member who does not exist', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('factions/harbor-guild/faction.json', (c) => { (c['members'] as Record<string, unknown>[]).push({ character: 'warden', role: 'x' }) })], expect: [{ check: 'world-valid', code: 'invalid', text: 'warden' }] }),
  made({ id: 'routine-place-unknown', title: 'a daily routine puts a character in a place that is not there', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/ines/character.json', (c) => { ((c['routine'] as Record<string, unknown>[])[1]!)['location'] = 'ferry'; })], expect: [{ check: 'world-valid', code: 'invalid', text: 'ferry' }] }),
  made({ id: 'exit-target-unknown', title: 'a way leads to a place that is not there', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('locations/market/location.json', (c) => { (c['exits'] as Record<string, unknown>[]).push({ to: 'chapel', description: 'x' }) })], expect: [{ check: 'world-valid', code: 'invalid', text: 'chapel' }] }),

  // the graph of a world that does start
  made({ id: 'place-no-exit', title: 'a place with no way in or out', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [add('locations/well/location.json', language => ({ id: 'well', name: t(language)('The Well', '水井'), description: t(language)('A stone well in a walled yard, long since dry.', '围墙小院里的一口石井，早已干涸。'), parent: 'harbor' }))], expect: [{ check: 'world-graph', code: 'location-no-exit', where: 'well' }] }),
  made({ id: 'place-unreachable', title: 'a place that leads out but cannot be reached', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [add('locations/attic/location.json', language => ({ id: 'attic', name: t(language)('The Attic', '阁楼'), description: t(language)('A dusty attic under the inn roof, stacked with old nets.', '客栈屋顶下积满灰尘的阁楼，堆着旧渔网。'), parent: 'harbor', exits: [{ to: 'inn-room', description: 'a ladder', one_way: true }] }))], expect: [{ check: 'world-graph', code: 'location-unreachable', where: 'attic' }], allowed: [{ check: 'world-graph', code: 'exit-no-way-back', where: 'attic->inn-room' }] }),
  made({ id: 'character-unplaced', title: 'a character who is placed nowhere', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/kit/character.json', (c) => { const start = c['start'] as Record<string, unknown>; delete start['location']; delete start['position'] })], expect: [{ check: 'world-graph', code: 'character-unplaced', where: 'kit' }], allowed: [{ check: 'first-scene', code: 'start-alone' }] }),

  // values, names, prompts and fields
  made({ id: 'values-synonym', title: 'two tracked values that are one (stamina and energy)', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [editList('variables.json', (list) => {
    list.push({ key: 'stamina', name: 'Stamina', description: 'How much strength is left.', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 10, visibility: 'public' })
    list.push({ key: 'energy', name: 'Energy', description: 'How much strength is left.', kind: 'number', subject: 'character', min: 0, max: 10, integer: true, default: 10, visibility: 'public' })
  })], expect: [{ check: 'duplicate-values', code: 'duplicate-value', text: 'stamina' }] }),
  made({ id: 'alias-clash', title: 'an alias that is another character\'s name', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/kit/character.json', (c, language) => { c['aliases'] = [t(language)('Tomas Reyes', '托马斯·雷耶斯')] })], expect: [{ check: 'name-clashes', code: 'alias-clash', text: 'kit' }] }),
  made({
    id: 'names-one-letter-apart', title: 'two characters whose names differ by one letter, who are not one person', kind: 'defect', checks: CODE_CHECKS, judged: false,
    changes: [(files, language) => {
      const kit = files.get('characters/kit/character.json') as Record<string, unknown>
      files.set('characters/kip/character.json', { ...structuredClone(kit), id: 'kip', name: t(language)('Kip Alder', '基特·奥尔得'), summary: t(language)('A rope-maker\'s apprentice from the upper town.', '上城绳匠的学徒。'), aliases: [], relationships: [], role: 'npc' })
    }],
    expect: [{ check: 'name-confusable', code: 'confusable-names', where: 'characters/kip' }],
  }),
  made({
    id: 'names-numbered-rooms', title: 'two rooms of one inn numbered one apart: a pattern, not a slip', kind: 'clean', checks: CODE_CHECKS, judged: false,
    changes: [(files, language) => {
      const room = files.get('locations/inn-room/location.json') as Record<string, unknown>
      files.set('locations/inn-room-4/location.json', { ...structuredClone(room), id: 'inn-room-4', name: t(language)('Room 4', '四号客房'), description: t(language)('The room next to Room 3, with the window onto the yard.', '三号客房隔壁的房间，窗子对着院子。'), exits: [{ to: 'inn-bar', description: t(language)('the stairs down to the bar', '通往酒吧的楼梯') }] })
      const bar = files.get('locations/inn-bar/location.json') as Record<string, unknown>
      files.set('locations/inn-bar/location.json', { ...structuredClone(bar), exits: [...(bar['exits'] as unknown[]), { to: 'inn-room-4', description: t(language)('the stairs up to Room 4', '通往四号客房的楼梯') }] })
    }],
    expect: [],
  }),
  made({ id: 'lore-title-twice', title: 'two background entries with one title', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('lore/fog-bell/lore.json', (c) => { c['title'] = (files => files)(c['title']) }), (files) => { const history = files.get('lore/lighthouse-history/lore.json') as Record<string, unknown>; const bell = structuredClone(files.get('lore/fog-bell/lore.json')) as Record<string, unknown>; bell['title'] = history['title']; files.set('lore/fog-bell/lore.json', bell) }], expect: [{ check: 'name-clashes', code: 'name-twice' }] }),
  made({ id: 'prompt-variable', title: 'a prompt the world carries uses a variable it is not given', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [(files, language) => { files.set(`prompts/${language}/roleplay/style.md`, 'Write as ${nobody} would.') }], expect: [{ check: 'world-prompts', code: 'prompt', where: 'style.md' }] }),
  made({ id: 'field-misspelt', title: 'a field written under a name the format does not have', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/mara/character.json', (c) => { c['starting_place'] = 'pier'; c['notes'] = 'x' })], expect: [{ check: 'unread-fields', code: 'field-unread', where: 'characters/mara', text: 'starting_place' }] }),

  // quality and first scene
  made({ id: 'sheet-summary-only', title: 'a supporting character with only a summary', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/kit/character.json', (c) => { c['personality'] = ''; c['background'] = ''; c['speech'] = { style: '', examples: [] } })], expect: [{ check: 'quality-cast', code: 'sheet-summary-only', where: 'characters/kit' }] }),
  made({ id: 'no-voice', title: 'a main character with no way of speaking', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/tomas/character.json', (c) => { c['speech'] = { style: '', examples: [] } })], expect: [{ check: 'quality-cast', code: 'no-voice', where: 'characters/tomas' }] }),
  made({ id: 'same-summary', title: 'two characters with one summary', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [(files) => { const bram = files.get('characters/bram/character.json') as { summary: string }; const kit = structuredClone(files.get('characters/kit/character.json')) as Record<string, unknown>; kit['summary'] = bram.summary; files.set('characters/kit/character.json', kit) }], expect: [{ check: 'quality-cast', code: 'same-summary' }] }),
  made({ id: 'place-undescribed', title: 'a place with no description', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('locations/market/location.json', (c) => { c['description'] = '' })], expect: [{ check: 'quality-places', code: 'place-undescribed', where: 'market' }] }),
  made({ id: 'place-thin', title: 'a place with a one-line description and no features', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('locations/inn-room/location.json', (c) => { c['description'] = 'A room.'; c['features'] = [] })], expect: [{ check: 'quality-places', code: 'place-thin', where: 'inn-room' }] }),
  made({ id: 'nobody-to-play', title: 'no character the player may play', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/mara/character.json', (c) => { c['role'] = 'npc' }), edit('characters/quill/character.json', (c) => { c['role'] = 'npc' }), edit('world.json', (w) => { delete w['alternate_openings'] })], expect: [{ check: 'quality-cast', code: 'no-playable' }] }),
  made({ id: 'panel-in-prompt', title: 'a style prompt that tells the narrator to end every reply with a status bar', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [(files, language) => { files.set(`prompts/${language}/roleplay/style.md`, t(language)('Keep paragraphs short.\nEnd every reply with a status bar: Day N | Place: X | Trust: N/100 | Coins: N.', '段落要简短。\n每次回复结尾附上状态栏：第N天 | 地点：X | 信任：N/100 | 金币：N。')) }], expect: [{ check: 'quality-panels', code: 'output-panel', where: 'style' }] }),
  made({ id: 'panel-in-opening', title: 'an opening that ends with a fenced status block', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('world.json', (w, language) => { w['opening_message'] = `${String(w['opening_message'] ?? t(language)('The fog lifts from the pier.', '雾从码头上散去。'))}\n\n\`\`\`\n${t(language)('Day 3 | Place: Pier | Trust: 20/100', '第3天 | 地点：码头 | 信任：20/100')}\n\`\`\`` })], expect: [{ check: 'quality-panels', code: 'output-panel', where: 'world.json' }] }),
  made({ id: 'panel-tags-in-lore', title: 'a background entry that is the layout of a status panel of invented tags', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('lore/fog-bell/lore.json', (c, language) => { c['body'] = `${String(c['body'])}\n\n${TAG_LAYOUT[language](false)}` })], expect: [{ check: 'quality-panels', code: 'output-panel', where: 'lore/fog-bell' }] }),
  made({ id: 'panel-tags-in-opening', title: 'an opening that ends with a filled status panel of invented tags', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('world.json', (w, language) => { w['opening_message'] = `${String(w['opening_message'] ?? t(language)('The fog lifts from the pier.', '雾从码头上散去。'))}\n\n${TAG_LAYOUT[language](true)}` })], expect: [{ check: 'quality-panels', code: 'output-panel', where: 'world.json' }] }),
  made({ id: 'world-bare', title: 'a world with no description, tags or opening', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('world.json', (w) => { delete w['description']; delete w['metadata']; delete w['opening_message']; delete w['alternate_openings'] })], expect: [{ check: 'quality-world', code: 'no-description' }, { check: 'quality-world', code: 'no-tags' }, { check: 'quality-world', code: 'no-opening' }] }),
  made({ id: 'start-empty', title: 'the player starts alone in a bare place', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [
    add('locations/dune/location.json', language => ({ id: 'dune', name: t(language)('The Dune', '沙丘'), description: t(language)('A bare dune behind the pier.', '码头后面的一座光秃秃的沙丘。'), parent: 'harbor', exits: [{ to: 'pier', description: 'a path' }] })),
    edit('characters/quill/character.json', (c) => { (c['start'] as Record<string, unknown>)['location'] = 'dune' }),
  ], expect: [{ check: 'first-scene', code: 'start-empty', where: 'quill' }] }),
  made({ id: 'start-alone', title: 'the player starts alone in a place that has things but nobody', kind: 'defect', checks: CODE_CHECKS, judged: false, changes: [edit('characters/quill/character.json', (c) => { (c['start'] as Record<string, unknown>)['location'] = 'inn-room'; delete (c['start'] as Record<string, unknown>)['position'] })], expect: [{ check: 'first-scene', code: 'start-alone', where: 'quill' }] }),
]

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// The world compared with the card it was made from

const FIDELITY_CODE = ['card-coverage', 'card-names', 'card-numbers'] as const
const mini = (language: Language): Files => cardWorld({ card: language })
const fromCard = (spec: Omit<BenchCase, 'build'> & { changes: readonly Change[] }): BenchCase => made(spec, mini)
const sentence = (key: keyof CardTexts, change: (text: string, language: Language) => string): Change => (files, language) => {
  const text = cardTexts(language)[key]
  const path = key === 'mara' || key === 'tomas' || key === 'ines' ? `characters/${key}/character.json` : `lore/${key === 'charter' ? 'charter' : key}/lore.json`
  const value = structuredClone(files.get(path)) as Record<string, unknown>
  const field = path.startsWith('characters') ? 'summary' : 'body'
  value[field] = change(text, language)
  if (field === 'body') value['summary'] = String(value[field]).split(/[.。]/)[0]
  files.set(path, value)
}

export const FIDELITY_CODE_CASES: readonly BenchCase[] = [
  fromCard({ id: 'card-faithful', title: 'a world that says what its card says', kind: 'clean', checks: FIDELITY_CODE, judged: false, card: 'current', changes: [], expect: [] }),
  fromCard({ id: 'card-piece-lost', title: 'a lorebook entry of the card that nothing in the world comes from', kind: 'defect', checks: FIDELITY_CODE, judged: false, card: 'current', changes: [drop('lore/charter/lore.json')], expect: [{ check: 'card-coverage', code: 'piece-uncovered', where: 'entry:2' }] }),
  fromCard({ id: 'card-name-invented', title: 'a character the card never names', kind: 'defect', checks: FIDELITY_CODE, judged: false, card: 'current', changes: [add('characters/zed/character.json', language => ({ name: pick(language)('Zed Okoro', '泽德·奥科罗'), role: 'npc', summary: pick(language)('A drifter.', '一个流浪者。') }))], expect: [{ check: 'card-names', code: 'name-not-in-card', where: 'characters/zed' }] }),
  fromCard({ id: 'card-number-lost', title: 'numbers the card gives that the world dropped', kind: 'defect', checks: FIDELITY_CODE, judged: false, card: 'current', changes: [
    sentence('tomas', (_text, language) => pick(language)('Tomas Reyes keeps the Anchor & Lamp inn and owes the guild money.', '托马斯·雷耶斯经营锚与灯客栈，欠着公会的钱。')),
    sentence('lighthouse', (_text, language) => pick(language)('The lighthouse was built after a wreck killed forty fishermen. Its lamp has burned every night since.', '灯塔建于一场海难夺去了四十名渔民的性命之后。此后灯夜夜不熄。')),
  ], expect: [{ check: 'card-numbers', code: 'number-lost', text: '58' }, { check: 'card-numbers', code: 'number-lost', where: 'entry:0', text: '1851' }] }),
  fromCard({ id: 'card-number-changed', title: 'a number the world changed', kind: 'defect', checks: FIDELITY_CODE, judged: false, card: 'current', changes: [sentence('ines', text => text.replace('46', '64'))], expect: [{ check: 'card-numbers', code: 'number-lost', text: '46' }] }),
]

const newerCard = (extra: (language: Language) => string): Change => (files, language) => {
  const card = cardOf(language)
  files.set('.import/update/card.json', { ...card, description: `${card.description}\n\n${extra(language)}` })
  files.set('.import/update/choices.json', CHOICES)
}
const kitSentence = (language: Language): string => pick(language)('Kit Alder is 16 and runs messages for the keeper; he saw who went up the lighthouse road.', '基特·奥尔德 16 岁，给守塔人跑腿送信；他看见了是谁走上灯塔路。')

export const UPDATE_CASES: readonly BenchCase[] = [
  fromCard({ id: 'update-pending', title: 'a newer card says something the world does not say yet', kind: 'defect', checks: ['card-update'], judged: false, card: 'new', changes: [newerCard(kitSentence)], expect: [{ check: 'card-update', code: 'update-pending', where: 'field:description' }] }),
  fromCard({ id: 'update-applied', title: 'a newer card whose change the world already has', kind: 'clean', checks: ['card-update'], judged: false, card: 'new', changes: [newerCard(kitSentence), (files, language) => {
    const mara = structuredClone(files.get('characters/mara/character.json')) as Record<string, unknown>
    mara['summary'] = `${String(mara['summary'])} ${kitSentence(language)}`
    files.set('characters/mara/character.json', mara)
  }], expect: [] }),
]
