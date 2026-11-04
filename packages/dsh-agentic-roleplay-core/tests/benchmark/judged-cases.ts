import type { BenchCase, Expect } from './cases.ts'
import { add, edit, editList, matches } from './cases.ts'
import { cardTexts, cardWorld, type CardTexts } from './card-world.ts'
import type { Files, Language } from './language.ts'
import { pick } from './language.ts'
import { saltHarbor } from './salt-harbor.ts'
import { loreSet } from './pairs.ts'
import { LARGE_CASES } from './large-cases.ts'

export { matches }

type Change = (files: Files, language: Language) => void
const t = (language: Language) => pick(language)

function made(spec: Omit<BenchCase, 'build'> & { changes: readonly Change[] }, base: (language: Language) => Files = saltHarbor): BenchCase {
  const { changes, ...rest } = spec
  return { ...rest, build: (language) => { const files = base(language); for (const change of changes) change(files, language); return files } }
}

const variable = (key: string, name: string, description: string, subject = 'character') => ({ key, name, description, kind: 'number', subject, min: 0, max: 10, integer: true, default: 0, visibility: 'public' })
const addVariables = (...defs: Record<string, unknown>[]): Change => editList('variables.json', (list) => { list.push(...defs) })
const lore = (id: string, entry: (language: Language) => Record<string, unknown>): Change => add(`lore/${id}/lore.json`, language => ({ id, kind: 'history', scope: 'everyone', ...entry(language) }))

/** The same thing twice under other words: asked about by the closeness of their meaning, and a model says whether they are one. */
const SAME_VALUE = ['duplicate-values-meaning'] as const
const SAME_THING = ['name-near'] as const
const CONFLICT = ['lore-conflict'] as const

export const SEMANTIC_CASES: readonly BenchCase[] = [
  // ---- tracked values
  made({ id: 'values-reputation-standing', title: 'two values for how the town sees someone, under different words', kind: 'defect', checks: SAME_VALUE, judged: true, changes: [addVariables(
    variable('reputation', 'Reputation', 'How well the town thinks of this person.'), variable('standing', 'Standing', 'Where this person stands in the eyes of the townsfolk.'),
  )], expect: [{ check: 'duplicate-values-meaning', code: 'duplicate-value', text: 'reputation' }] }),
  made({ id: 'values-reputation-standing-zh', title: 'the same, written in Chinese words', kind: 'defect', checks: SAME_VALUE, judged: true, changes: [(files, language) => {
    const list = structuredClone(files.get('variables.json')) as Record<string, unknown>[]
    list.push(variable('reputation', t(language)('Reputation', '声望'), t(language)('How well the town thinks of this person.', '镇上人对这个人的评价有多好。')), variable('standing', t(language)('Standing', '名望'), t(language)('Where this person stands in the eyes of the townsfolk.', '这个人在镇民眼中的地位。')))
    files.set('variables.json', list)
  }], expect: [{ check: 'duplicate-values-meaning', code: 'duplicate-value', text: 'reputation' }] }),
  made({ id: 'values-across-languages', title: 'one value written in two languages', kind: 'defect', checks: SAME_VALUE, judged: true, changes: [(files, language) => {
    const list = structuredClone(files.get('variables.json')) as Record<string, unknown>[]
    list.push(variable('courage', t(language)('Courage', '勇气'), t(language)('How bold the character is when frightened.', '角色在害怕时有多大胆。')), variable('nerve', t(language)('胆量', 'Nerve'), t(language)('角色在害怕时有多大胆。', 'How bold the character is when frightened.')))
    files.set('variables.json', list)
  }], expect: [{ check: 'duplicate-values-meaning', code: 'duplicate-value', text: 'courage' }] }),
  made({ id: 'values-needs-distinct', title: 'bodily needs that are close in meaning and not one value', kind: 'ambiguous', checks: SAME_VALUE, judged: true, changes: [addVariables(variable('thirst', 'Thirst', 'How thirsty the character is: 0 quenched, 10 parched.'), variable('warmth', 'Cold', 'How cold the character is: 0 warm, 10 freezing.'))], expect: [] }),
  made({ id: 'values-trust-affection-distinct', title: 'trust and affection: as close as gold and coins, and not one value', kind: 'ambiguous', checks: SAME_VALUE, judged: true, changes: [addVariables(variable('trust', 'Trust', 'How far this person trusts the player\'s character.'), variable('affection', 'Affection', 'How fond this person is of the player\'s character.'))], expect: [] }),

  // ---- names
  made({ id: 'place-twice', title: 'a place written twice under two names', kind: 'defect', checks: SAME_THING, judged: true, changes: [add('locations/lighthouse-tower/location.json', language => ({ id: 'lighthouse-tower', name: t(language)('The Lighthouse Tower', '灯塔塔楼'), description: t(language)('A stone tower on the headland. The great lamp is dark and the door stands unlatched.', '岬角上的石塔。大灯熄灭了，门虚掩着。'), parent: 'harbor', exits: [{ to: 'pier', description: 'the cliff road' }] }))], expect: [{ check: 'name-near', code: 'possible-duplicate', where: 'locations/lighthouse' }] }),
  made({ id: 'place-old-pier-distinct', title: 'an old pier and the pier: one name inside the other, two different places', kind: 'ambiguous', checks: SAME_THING, judged: true, changes: [add('locations/old-pier/location.json', language => ({ id: 'old-pier', name: t(language)('The Old Pier', '旧码头'), description: t(language)('A derelict pier across the cove, rotted through and used only by gulls. No boat has tied up there in thirty years.', '海湾对面一座废弃的码头，木头已经烂透，只有海鸥在上面停歇。三十年来没有船在那里系过缆。'), parent: 'harbor', exits: [{ to: 'pier', description: 'a rowing boat across the cove' }] }))], expect: [] }),
  made({ id: 'character-twice', title: 'a character written twice (the keeper and "the keeper")', kind: 'defect', checks: SAME_THING, judged: true, changes: [(files, language) => {
    const bram = structuredClone(files.get('characters/bram/character.json')) as Record<string, unknown>
    files.set('characters/keeper-bram/character.json', { ...bram, id: 'keeper-bram', name: t(language)('Bram the Keeper', '守塔人布拉姆'), aliases: [], start: { ...(bram['start'] as Record<string, unknown>), location: 'lighthouse', position: '' }, relationships: [], knowledge: undefined })
  }], expect: [{ check: 'name-near', code: 'possible-duplicate', where: 'characters/bram' }] }),
  made({ id: 'character-relatives-distinct', title: 'two people of one family name: a brother and sister, not one person', kind: 'ambiguous', checks: SAME_THING, judged: true, changes: [add('characters/rosa/character.json', language => ({ id: 'rosa', name: t(language)('Rosa Reyes', '罗莎·雷耶斯'), age: 52, gender: 'female', pronouns: 'she/her', role: 'npc', kind: 'person', tier: 'supporting', summary: t(language)('Tomas Reyes\'s sister, who bakes the harbor\'s bread and keeps out of every quarrel.', '托马斯·雷耶斯的姐姐，给全港烤面包，从不卷入任何争执。'), personality: t(language)('Practical, plain-spoken and fond of her brother.', '务实、直爽，很疼弟弟。'), background: t(language)('Widowed young; ran the bakery alone for twenty years.', '年轻守寡，独自经营面包房二十年。'), speech: { style: t(language)('Brisk and kindly.', '干脆而和善。'), examples: [] }, start: { public_state: t(language)('Kneading dough.', '正在揉面。'), activity: t(language)('Baking.', '烤面包。'), location: 'market' } }))], expect: [] }),
  made({ id: 'item-twice', title: 'a thing written twice (an iron key to the lighthouse)', kind: 'defect', checks: SAME_THING, judged: true, changes: [add('items/iron-key/item.json', language => ({ id: 'iron-key', name: t(language)('Iron key to the lighthouse', '通往灯塔的铁钥匙'), description: t(language)('A heavy iron key with a salt-white bow, for the lighthouse door.', '一把沉重的铁钥匙，柄环结着白盐，用来开灯塔的门。'), location: 'pier' }))], expect: [{ check: 'name-near', code: 'possible-duplicate', where: 'items/lighthouse-key' }] }),

  // ---- background that cannot both be true
  made({ id: 'lore-built-twice', title: 'two entries that give the lighthouse a different year and cause', kind: 'defect', checks: CONFLICT, judged: true, changes: [lore('lighthouse-fire', language => ({ title: t(language)('The lighthouse after the fire', '大火之后的灯塔'), summary: t(language)('The lighthouse was built in 1872 on the ruins of a burnt chapel.', '灯塔于 1872 年建在一座烧毁的小教堂的废墟上。'), body: t(language)('The lighthouse was built in 1872 on the ruins of a chapel destroyed by fire. No wreck had ever been recorded at Salt Harbor before it, and nobody was lost at sea that year.', '灯塔于 1872 年建在一座被火烧毁的小教堂的废墟上。在它建成之前，盐湾港从未记录过任何海难，那一年也没有人死于海上。'), subjects: [{ kind: 'location', id: 'lighthouse' }] }))], expect: [{ check: 'lore-conflict', code: 'lore-conflict', where: 'lore/lighthouse' }] }),
  made({ id: 'lore-who-closes-roads', title: 'two entries that give the right to close roads to different bodies', kind: 'defect', checks: CONFLICT, judged: true, changes: [lore('magistrate-roads', language => ({ title: t(language)('The magistrate and the roads', '地方官与道路'), summary: t(language)('Only the county magistrate may close a road in the harbor\'s land.', '只有郡地方官才能封闭港区土地上的道路。'), body: t(language)('Only the county magistrate may close a road in the harbor\'s land, and only by a signed order. The guild may ask for a road to be closed but has no power to close one itself.', '只有郡地方官才能封闭港区土地上的道路，且须有签署的命令。公会可以请求封路，但自己无权封路。'), subjects: [{ kind: 'faction', id: 'harbor-guild' }] }))], expect: [{ check: 'lore-conflict', code: 'lore-conflict', where: 'lore/guild-charter' }] }),
  made({ id: 'lore-law-changed', title: 'a new tide law that replaces the old one: apart in time, not a conflict', kind: 'ambiguous', checks: CONFLICT, judged: true, changes: [lore('new-tide-law', language => ({ title: t(language)('The new tide law', '新潮汐法'), summary: t(language)('Since 1886 the pier stays open at the spring tides.', '自 1886 年起，大潮期间码头保持开放。'), body: t(language)('Since the breakwater was finished in 1886 the pier has stayed open to all boats through the three days of the spring tides.', '自 1886 年防波堤建成以来，大潮的三天里码头始终向所有船只开放。'), starts_at: '1886-01-01' }))], expect: [] }),
  made({ id: 'lore-elaboration', title: 'an entry that adds detail to another and says nothing against it', kind: 'ambiguous', checks: CONFLICT, judged: true, changes: [lore('bell-ringer', language => ({ title: t(language)('Who rings the fog bell', '谁来敲雾钟'), summary: t(language)('The dock boy rings the fog bell each foggy night.', '雾夜里由码头的少年敲雾钟。'), body: t(language)('On foggy nights the dock boy rings the pier bell at eight, a task he was given by the harbor master and takes very seriously.', '雾夜里，码头的少年在八点敲响码头的钟。这是港务长交给他的差事，他对此十分认真。'), subjects: [{ kind: 'location', id: 'pier' }] }))], expect: [] }),
  made({ id: 'lore-first-pier', title: 'an entry about the first pier that fits the founding date', kind: 'ambiguous', checks: CONFLICT, judged: true, changes: [lore('first-pier', language => ({ title: t(language)('The first pier', '第一座码头'), summary: t(language)('The first pier was finished in 1790, a year after the founding.', '第一座码头在建镇一年后的 1790 年完工。'), body: t(language)('The salt-panners finished the first pier in 1790, a year after they settled the cove, and paid for it with the first harvest of salt.', '晒盐人定居海湾一年后的 1790 年建成了第一座码头，用头一茬的盐款支付了费用。'), subjects: [{ kind: 'location', id: 'pier' }] }))], expect: [] }),
]

/** A world with many background entries that read alike, where the one contradiction is not among the twelve closest pairs by meaning. */
const crowdedLore: Change = (files, language) => {
  const filler = loreSet(language).texts.slice(0, 20)
  filler.forEach((text, at) => { files.set(`lore/filler-${at + 1}/lore.json`, { id: `filler-${at + 1}`, title: text.split(/[:：]/)[0], kind: 'history', scope: 'everyone', summary: text, body: text, subjects: [] }) })
}

export const CROWDED_CASES: readonly BenchCase[] = [
  made({ id: 'lore-crowded-conflict', title: 'a contradiction among many background entries that read alike', kind: 'defect', checks: CONFLICT, judged: true, changes: [crowdedLore, lore('lighthouse-fire', language => ({ title: t(language)('The lighthouse after the fire', '大火之后的灯塔'), summary: t(language)('The lighthouse was built in 1872 on the ruins of a burnt chapel.', '灯塔于 1872 年建在一座烧毁的小教堂的废墟上。'), body: t(language)('The lighthouse was built in 1872 on the ruins of a chapel destroyed by fire. No wreck had ever been recorded at Salt Harbor before it.', '灯塔于 1872 年建在一座被火烧毁的小教堂的废墟上。在它建成之前，盐湾港从未记录过任何海难。'), subjects: [{ kind: 'location', id: 'lighthouse' }] }))], expect: [{ check: 'lore-conflict', code: 'lore-conflict', where: 'lore/lighthouse' }] }),
  made({ id: 'lore-crowded-clean', title: 'many background entries that read alike and say nothing against each other', kind: 'clean', checks: CONFLICT, judged: true, changes: [crowdedLore], expect: [] }),
]

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a model judges about the authoring of the world

const sheetCheck = ['sheet-playable'] as const
const thinSheet = (summary: string): Change => edit('characters/kit/character.json', (c) => { c['summary'] = summary; c['personality'] = ''; c['background'] = ''; c['appearance'] = ''; c['speech'] = { style: '', examples: [] }; (c['start'] as Record<string, unknown>)['inner_state'] = ''; (c['start'] as Record<string, unknown>)['intents'] = [] })

export const QUALITY_CASES: readonly BenchCase[] = [
  made({ id: 'sheets-sound', title: 'every sheet of the sound world is enough to play', kind: 'clean', checks: sheetCheck, judged: true, changes: [], expect: [] }),
  made({ id: 'sheet-name-and-line', title: 'a supporting character who is only a name and a line', kind: 'defect', checks: sheetCheck, judged: true, changes: [(files, language) => thinSheet(t(language)('A dock boy.', '码头上的少年。'))(files, language)], expect: [{ check: 'sheet-playable', code: 'sheet-thin', where: 'characters/kit' }] }),
  made({ id: 'sheet-looks-only', title: 'a main character who is only a list of looks', kind: 'defect', checks: sheetCheck, judged: true, changes: [edit('characters/ines/character.json', (c, language) => { c['summary'] = t(language)('Tall, grey coat, ring of keys.', '身材高，灰外套，一串钥匙。'); c['personality'] = ''; c['background'] = ''; c['speech'] = { style: '', examples: [] }; (c['start'] as Record<string, unknown>)['intents'] = []; (c['start'] as Record<string, unknown>)['inner_state'] = '' })], expect: [{ check: 'sheet-playable', code: 'sheet-thin', where: 'characters/ines' }] }),
  made({ id: 'sheet-short-but-enough', title: 'a short sheet that still says who, how and what for', kind: 'ambiguous', checks: sheetCheck, judged: true, changes: [edit('characters/kit/character.json', (c, language) => { c['summary'] = t(language)('A hungry dock boy who runs errands for the keeper and fears the night watch.', '饥肠辘辘的码头少年，给守塔人跑腿，怕夜巡队。'); c['personality'] = t(language)('Cheerful, easily bribed with food.', '开朗，一点吃的就能收买。'); c['background'] = ''; c['appearance'] = ''; c['speech'] = { style: t(language)('Quick and slangy.', '语速快，带俚语。'), examples: [] } })], expect: [] }),
]

const openingCheck = ['opening-playable'] as const

export const PLAYABILITY_CASES: readonly BenchCase[] = [
  made({ id: 'openings-sound', title: 'the openings and first scenes of the sound world give something to do', kind: 'clean', checks: openingCheck, judged: true, changes: [], expect: [] }),
  made({ id: 'opening-bare', title: 'no opening, no want and a bare first place', kind: 'defect', checks: openingCheck, judged: true, changes: [
    edit('world.json', (w) => { delete w['opening_message']; delete w['alternate_openings']; w['description'] = '' }),
    add('locations/dune/location.json', language => ({ id: 'dune', name: t(language)('The Dune', '沙丘'), description: t(language)('A bare dune behind the pier.', '码头后面的一座光秃秃的沙丘。'), parent: 'harbor', exits: [{ to: 'pier', description: 'a path' }] })),
    edit('characters/quill/character.json', (c) => { c['summary'] = ''; (c['start'] as Record<string, unknown>)['location'] = 'dune'; delete (c['start'] as Record<string, unknown>)['position']; (c['start'] as Record<string, unknown>)['intents'] = []; (c['start'] as Record<string, unknown>)['activity'] = ''; (c['start'] as Record<string, unknown>)['public_state'] = ''; (c['start'] as Record<string, unknown>)['inner_state'] = '' }),
    add('locations/shingle/location.json', language => ({ id: 'shingle', name: t(language)('The Shingle', '碎石滩'), description: t(language)('A bare stretch of shingle beyond the pier.', '码头外面一片光秃秃的碎石滩。'), parent: 'harbor', exits: [{ to: 'pier', description: 'a path' }] })),
    edit('characters/mara/character.json', (c) => { c['summary'] = ''; (c['start'] as Record<string, unknown>)['location'] = 'shingle'; delete (c['start'] as Record<string, unknown>)['position']; (c['start'] as Record<string, unknown>)['intents'] = []; (c['start'] as Record<string, unknown>)['activity'] = ''; (c['start'] as Record<string, unknown>)['public_state'] = ''; (c['start'] as Record<string, unknown>)['inner_state'] = '' }),
  ], expect: [{ check: 'opening-playable', code: 'opening-flat', where: 'characters/mara' }, { check: 'opening-playable', code: 'opening-flat', where: 'characters/quill' }] }),
  made({ id: 'opening-short-flat', title: 'a one-word opening, no want and a bare first place', kind: 'defect', checks: openingCheck, judged: true, changes: [
    edit('world.json', (w, language) => { w['opening_message'] = t(language)('Morning.', '清晨。'); delete w['alternate_openings']; w['description'] = '' }),
    add('locations/dune/location.json', language => ({ id: 'dune', name: t(language)('The Dune', '沙丘'), description: t(language)('A bare dune behind the pier.', '码头后面的一座光秃秃的沙丘。'), parent: 'harbor', exits: [{ to: 'pier', description: 'a path' }] })),
    edit('characters/quill/character.json', (c) => { c['summary'] = ''; (c['start'] as Record<string, unknown>)['location'] = 'dune'; delete (c['start'] as Record<string, unknown>)['position']; (c['start'] as Record<string, unknown>)['intents'] = []; (c['start'] as Record<string, unknown>)['activity'] = ''; (c['start'] as Record<string, unknown>)['public_state'] = ''; (c['start'] as Record<string, unknown>)['inner_state'] = '' }),
    add('locations/shingle/location.json', language => ({ id: 'shingle', name: t(language)('The Shingle', '碎石滩'), description: t(language)('A bare stretch of shingle beyond the pier.', '码头外面一片光秃秃的碎石滩。'), parent: 'harbor', exits: [{ to: 'pier', description: 'a path' }] })),
    edit('characters/mara/character.json', (c) => { c['summary'] = ''; (c['start'] as Record<string, unknown>)['location'] = 'shingle'; delete (c['start'] as Record<string, unknown>)['position']; (c['start'] as Record<string, unknown>)['intents'] = []; (c['start'] as Record<string, unknown>)['activity'] = ''; (c['start'] as Record<string, unknown>)['public_state'] = ''; (c['start'] as Record<string, unknown>)['inner_state'] = '' }),
  ], expect: [{ check: 'opening-playable', code: 'opening-flat', where: 'characters/mara' }, { check: 'opening-playable', code: 'opening-flat', where: 'characters/quill' }] }),
  made({ id: 'opening-short-playable', title: 'a short, quiet opening that still gives a place, a person and a want', kind: 'ambiguous', checks: openingCheck, judged: true, changes: [edit('world.json', (w, language) => { w['opening_message'] = t(language)('The tide turns and gulls wheel over the pier.', '潮水转向，海鸥在码头上空盘旋。'); delete w['alternate_openings'] })], expect: [] }),
]

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a model finds missing from a world to play it well: a gap is planted and must be named; the gaps named elsewhere are counted as noise.

const gapCheck = ['world-gaps'] as const

export const GAP_CASES: readonly BenchCase[] = [
  made({ id: 'gaps-sound', title: 'the sound world: whatever a model names is noise', kind: 'clean', checks: gapCheck, judged: true, changes: [], expect: [] }),
  made({ id: 'gap-empty-chapel', title: 'a described place with nobody in it and nothing to do', kind: 'defect', checks: gapCheck, judged: true, changes: [add('locations/chapel/location.json', language => ({ id: 'chapel', name: t(language)('The Chapel of St. Elmo', '圣艾尔摩小教堂'), description: t(language)('A small stone chapel above the market, with a bell that has never rung, candle stubs on every sill, and a vestry door nobody has opened in years.', '集市上方的一座石砌小教堂，钟从未敲响过，每个窗台上都有烛头，圣器室的门多年没人打开。'), parent: 'harbor', exits: [{ to: 'market', description: 'a flight of steps' }] }))], expect: [{ check: 'world-gaps', code: 'gap', where: 'chapel' }] }),
  made({ id: 'gap-feud-nobody-carries', title: 'a feud the background mentions that no character or organisation carries', kind: 'defect', checks: gapCheck, judged: true, changes: [lore('ashby-rook-feud', language => ({ title: t(language)('The Ashby–Rook feud', '阿什比与鲁克两家的世仇'), kind: 'politics', summary: t(language)('The Ashby and Rook families have fought over the north moorings for three generations.', '阿什比家和鲁克家为北边的泊位争了三代人。'), body: t(language)('The Ashby and Rook families have fought over the north moorings for three generations, with burnt nets, cut lines and one drowned boy. Neither family has a member left in town, but the quarrel is remembered in every tavern.', '阿什比家和鲁克家为北边的泊位争了三代人，烧过渔网、割过缆绳，还淹死过一个孩子。两家如今在镇上都没有人了，但这场争吵在每家酒馆里都还被人提起。'), subjects: [] }))], expect: [{ check: 'world-gaps', code: 'gap', where: 'ashby-rook-feud' }] }),
]

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// The world against its card, where a model reads

const fidelityChecks = ['card-coverage', 'card-names', 'card-numbers', 'card-fidelity'] as const
const mini = (language: Language): Files => cardWorld({ card: language })
const loreOf = (id: string, field: 'body' | 'summary', change: (text: string, language: Language) => string): Change => (files, language) => {
  const value = structuredClone(files.get(`lore/${id}/lore.json`)) as Record<string, unknown>
  value[field] = change(String(value[field]), language)
  files.set(`lore/${id}/lore.json`, value)
}
const miniMade = (spec: Omit<BenchCase, 'build'> & { changes: readonly Change[] }): BenchCase => made(spec, mini)

/** The card in one language and the world in the other: the two say the same, and the checks have to find that by meaning. */
const crossLanguage = (language: Language): Files => cardWorld({ card: language === 'en' ? 'zh' : 'en', world: language })

export const FIDELITY_JUDGED_CASES: readonly BenchCase[] = [
  miniMade({ id: 'fact-dropped', title: 'a document that lost a fact its card states', kind: 'defect', checks: fidelityChecks, judged: true, card: 'current', changes: [
    loreOf('lighthouse', 'body', (_text, language) => t(language)('The lighthouse was built in 1851. Its lamp has burned every night since.', '灯塔建于 1851 年。此后灯夜夜不熄。')),
    loreOf('lighthouse', 'summary', (_text, language) => t(language)('The lighthouse was built in 1851', '灯塔建于 1851 年')),
  ], expect: [{ check: 'card-fidelity', code: 'fact-dropped', where: 'lore/lighthouse' }] }),
  miniMade({ id: 'fact-invented', title: 'a document that states a fact its card does not give', kind: 'defect', checks: fidelityChecks, judged: true, card: 'current', changes: [
    loreOf('founding', 'body', (text, language) => `${text} ${t(language)('A pirate captain paid for the first pier and is buried beneath it.', '一位海盗船长出资建了第一座码头，并葬在码头下面。')}`),
  ], expect: [{ check: 'card-fidelity', code: 'fact-invented', where: 'lore/founding' }] }),
  miniMade({ id: 'paraphrase-faithful', title: 'an entry rewritten in other words with the same facts', kind: 'clean', checks: fidelityChecks, judged: true, card: 'current', changes: [
    loreOf('charter', 'body', (_text, language) => t(language)('Moorings are the guild\'s alone to grant, and it may also shut any road on harbor land while repairs are made, for no more than thirty days.', '泊位只有公会才能批准；公会还可以在检修期间封闭港区土地上的任何道路，但不得超过三十天。')),
    loreOf('charter', 'summary', (_text, language) => t(language)('Moorings are the guild\'s alone to grant', '泊位只有公会才能批准')),
  ], expect: [] }),
  made({ id: 'translated-faithful', title: 'a world in the other language than its card, with the same facts', kind: 'clean', checks: fidelityChecks, judged: true, card: 'current', changes: [], expect: [], allowed: [{ check: 'card-names', code: 'names-elsewhere' }] }, crossLanguage),
]

export const ALL_JUDGED: readonly BenchCase[] = [...SEMANTIC_CASES, ...CROWDED_CASES, ...QUALITY_CASES, ...PLAYABILITY_CASES, ...GAP_CASES, ...FIDELITY_JUDGED_CASES, ...LARGE_CASES]
export type { CardTexts, Expect }
void cardTexts
