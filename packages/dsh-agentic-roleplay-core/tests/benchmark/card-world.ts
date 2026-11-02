import type { ImportChoices, NormalizedCard } from '../../src/shared/import-card.ts'
import type { Files, Language } from './language.ts'
import { pick } from './language.ts'

export const CARD_WORLD_ID = { en: 'benchmark-card-en', zh: 'benchmark-card-zh' } as const

/** The texts an invented card says, one entry for each part of the world made from it: the same facts in both languages. */
export function cardTexts(language: Language) {
  const t = pick(language)
  return {
    name: t('Salt Harbor', '盐湾港'),
    mara: t('Mara Venn is 27 years old, the lighthouse keeper\'s daughter, tall and dry-witted.', '玛拉·文今年 27 岁，是守塔人的女儿，身材高挑，说话带着冷幽默。'),
    tomas: t('Tomas Reyes, 58, keeps the Anchor & Lamp inn and owes the guild 400 crowns.', '托马斯·雷耶斯，58 岁，经营锚与灯客栈，欠着公会 400 克朗。'),
    ines: t('Ines Calder is 46 and the harbor master.', '伊内斯·卡尔德今年 46 岁，是港务长。'),
    scenario: t('Salt Harbor lies under fog from October to March, and the fog bell rings on the pier every night at eight.', '盐湾港从十月到三月都笼罩在雾中，每晚八点，码头的雾钟都会敲响。'),
    lighthouse: t('The lighthouse was built in 1851 after a wreck killed forty fishermen. Its lamp has burned every night since.', '灯塔建于 1851 年，起因是一场海难夺去了四十名渔民的性命。此后灯夜夜不熄。'),
    founding: t('Salt Harbor was founded in 1789 by families of salt-panners who built its first pier from driftwood.', '盐湾港由晒盐人家族于 1789 年建立，第一座码头用浮木搭成。'),
    charter: t('The guild alone may grant moorings and may close any road in the harbor\'s land for repairs for up to thirty days.', '只有公会能批准泊位，并可以检修为由封闭港区土地上的任何道路，最长三十天。'),
    signal: t('Two long flashes and one short from the signal room mean a boat may land unseen.', '信号室打出两长一短的闪光，表示船可以悄悄靠岸。'),
  }
}

type Texts = ReturnType<typeof cardTexts>

const entry = (index: number, title: string, content: string) => ({ id: `entry:${index}`, title, keys: [title], secondaryKeys: [], content, enabled: true, constant: false, selective: false, position: 'before_char' })

/** The invented card whose pieces the benchmark world was made from. */
export function cardOf(language: Language, text: Texts = cardTexts(language)): NormalizedCard {
  const t = pick(language)
  return {
    sourceSpec: 'chara_card_v3', name: text.name, description: [text.mara, text.tomas, text.ines].join('\n\n'), personality: '', scenario: text.scenario,
    firstMessage: t('The ferry bell rings.', '渡船的钟声响起。'), alternateGreetings: [], messageExample: '', creatorNotes: '', systemPrompt: '', postHistoryInstructions: '', tags: [], creator: 'benchmark', characterVersion: '1',
    book: { name: t('Harbor book', '港口之书'), description: '', entries: [entry(0, t('The lighthouse', '灯塔'), text.lighthouse), entry(1, t('Founding', '建港'), text.founding), entry(2, t('The guild charter', '公会特许状'), text.charter), entry(3, t('The signal', '暗号'), text.signal)] },
    ignored: { scripts: 0, extensions: [] },
  }
}

export const CHOICES: ImportChoices = { name: 'Salt Harbor', disabledEntries: [], opening: { kind: 'first' } }

const characterNames = (language: Language) => pick(language)([['mara', 'Mara Venn'], ['tomas', 'Tomas Reyes'], ['ines', 'Ines Calder']], [['mara', '玛拉·文'], ['tomas', '托马斯·雷耶斯'], ['ines', '伊内斯·卡尔德']])

/** What the import kept of the card: how each piece was read and who the characters are, in the language of the card. */
function records(language: Language): { classification: Record<string, unknown>; roster: unknown[] } {
  const names = characterNames(language)
  return {
    classification: {
      'field:description': { roles: ['character'], targets: names.map(([, name]) => ({ name, kind: 'character' })) },
      'field:scenario': { roles: ['world'], targets: [] },
      'field:opening': { roles: ['scenario'], targets: [] },
      'entry:0': { roles: ['world'], targets: [] }, 'entry:1': { roles: ['world'], targets: [] }, 'entry:2': { roles: ['world'], targets: [] }, 'entry:3': { roles: ['world'], targets: [] },
    },
    roster: names.map(([key, name]) => ({ kind: 'character', key, name, aliases: [], player: false })),
  }
}

/**
 * A small world as an import of the card would leave it: the characters' sheets and the background entries say what the card says, in the world's language (the card may be
 * in the other). The import's own records are kept with it, so the checks can compare the two.
 */
export function cardWorld(options: { card?: Language; world?: Language; cardText?: (text: Texts) => Texts; worldText?: (text: Texts) => Texts } = {}): Files {
  const cardLanguage = options.card ?? 'en'
  const worldLanguage = options.world ?? cardLanguage
  const t = pick(worldLanguage)
  const text = (options.worldText ?? ((x: Texts) => x))(cardTexts(worldLanguage))
  const source = (options.cardText ?? ((x: Texts) => x))(cardTexts(cardLanguage))
  const files: Files = new Map()
  files.set('world.json', { id: CARD_WORLD_ID[worldLanguage], name: text.name, description: text.scenario })
  for (const [key, sentence] of [['mara', text.mara], ['tomas', text.tomas], ['ines', text.ines]] as const) {
    files.set(`characters/${key}/character.json`, { id: key, name: characterNames(worldLanguage).find(([id]) => id === key)![1], role: key === 'mara' ? 'playable' : 'npc', summary: sentence })
  }
  const lore: [string, string, string][] = [['lighthouse', t('The lighthouse', '灯塔'), text.lighthouse], ['founding', t('Founding', '建港'), text.founding], ['charter', t('The guild charter', '公会特许状'), text.charter], ['signal', t('The signal', '暗号'), text.signal]]
  for (const [id, title, body] of lore) files.set(`lore/${id}/lore.json`, { id, title, kind: 'history', scope: 'everyone', summary: body.split(/[.。]/)[0] ?? title, body })
  const kept = records(cardLanguage)
  files.set('.import/card.json', cardOf(cardLanguage, source))
  files.set('.import/choices.json', CHOICES)
  files.set('.import/classification.json', kept.classification)
  files.set('.import/roster.json', kept.roster)
  return files
}
export type { Texts as CardTexts }
