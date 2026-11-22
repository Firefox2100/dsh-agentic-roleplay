import type { Language } from './language.ts'
import { pick } from './language.ts'
import { castName } from './attribution-cases.ts'

/**
 * The transfer benchmark: a round whose outcome has a thing change hands or place. The story's records move a thing only through the outcome's item_changes, so a summary that says it moved
 * and an outcome that records nothing leave the narration and the records apart. Elias holds the key; the lantern is on the table; the drawer is an open container in the kitchen.
 */
export interface TransferCase {
  id: string
  kind: 'snatch' | 'give' | 'drop' | 'put' | 'take' | 'none'
  input: (language: Language) => string
  /** What Elias, who was asked, intended and said. */
  elias: (language: Language) => { intent: string; utterance?: string }
  /** The record that must exist: who acts, which thing, the action, and what else it names; none when nothing moves. */
  expect: { actor: 'mara' | 'elias'; item: 'key' | 'lantern'; action: string; to?: string; from?: string } | undefined
}

const both = (en: string, zh: string) => (language: Language): string => pick(language)(en, zh)
const mara = (language: Language): string => castName('mara', language)
const elias = (language: Language): string => castName('elias', language)

export const TRANSFER_CASES: TransferCase[] = [
  {
    id: 'snatch', kind: 'snatch',
    input: both('While he looks at the window I slip the key off his belt and into my pocket.', '趁他看向窗外，我把钥匙从他腰带上摘下来，塞进自己的口袋。'),
    elias: () => ({ intent: '' }),
    expect: { actor: 'mara', item: 'key', action: 'take', from: 'elias' },
  },
  {
    id: 'give', kind: 'give',
    input: both('"Can I borrow the key?" I ask.', '“能把钥匙借我吗？”我问。'),
    elias: language => ({ intent: language === 'en' ? `${elias(language)} unhooks the key from his belt and hands it to ${mara(language)}.` : `${elias(language)}把钥匙从腰带上解下来，递给${mara(language)}。`, utterance: language === 'en' ? 'Take it. Bring it back before dark.' : '拿去吧，天黑前还回来。' }),
    expect: { actor: 'elias', item: 'key', action: 'give', to: 'mara' },
  },
  {
    id: 'drop', kind: 'drop',
    input: both('I tell him I do not trust him and wait to see what he does.', '我告诉他我不信任他，看他怎么做。'),
    elias: language => ({ intent: language === 'en' ? `${elias(language)} is angry and flings the key on the floor at ${mara(language)}'s feet.` : `${elias(language)}发了火，把钥匙扔在${mara(language)}脚边的地上。` }),
    expect: { actor: 'elias', item: 'key', action: 'drop' },
  },
  {
    id: 'put', kind: 'put',
    input: both('I put the lantern in the drawer and close my hand around nothing, smiling.', '我把提灯放进抽屉里，微笑着。'),
    elias: language => ({ intent: language === 'en' ? `${elias(language)} watches and nods.` : `${elias(language)}看着，点了点头。` }),
    expect: { actor: 'mara', item: 'lantern', action: 'put', to: 'drawer' },
  },
  {
    id: 'take', kind: 'take',
    input: both('I pick the lantern up off the table.', '我把提灯从桌上拿起来。'),
    elias: language => ({ intent: language === 'en' ? `${elias(language)} says nothing and goes on with his work.` : `${elias(language)}没有说话，继续干活。` }),
    expect: { actor: 'mara', item: 'lantern', action: 'take' },
  },
  {
    id: 'none', kind: 'none',
    input: both('I ask him what the key opens.', '我问他这把钥匙是开什么的。'),
    elias: language => ({ intent: language === 'en' ? `${elias(language)} jingles the key on his belt and says it opens the storeroom.` : `${elias(language)}晃了晃腰带上的钥匙，说它开的是储藏室。`, utterance: language === 'en' ? 'The storeroom. Nothing you need.' : '储藏室。你用不着。' }),
    expect: undefined,
  },
]

/** Elias's report for the snatch case: he does not notice. */
export const eliasOf = (made: TransferCase, language: Language): { intent: string; utterance?: string } => made.id === 'snatch'
  ? { intent: language === 'en' ? `${elias(language)} stares out of the window and does not notice anything.` : `${elias(language)}望着窗外，没有留意别的。` }
  : made.elias(language)
