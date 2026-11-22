import type { Language } from './language.ts'
import { pick } from './language.ts'
import { castName } from './attribution-cases.ts'
import type { SituationCase } from './situation-cases.ts'

/**
 * The planning benchmark: a player's move that sets up a moment the story is bound to reach (a deadline, a promised arrival, a coming frost) should be planned as a trigger; one that does not should not.
 * Mara is with Elias in the kitchen; the story's clock is at 1912-10-04 evening.
 */
export interface PlanCase { id: string; kind: 'plan' | 'none'; input: (language: Language) => string }

const both = (en: string, zh: string) => (language: Language): string => pick(language)(en, zh)
const elias = (language: Language): string => castName('elias', language)
const pavel = (language: Language): string => castName('pavel', language)

export const PLAN_CASES: PlanCase[] = [
  { id: 'deadline', kind: 'plan', input: language => language === 'en' ? `"The landlord gave us until noon on the fifth, ${elias(language)}. If the rent is not on his table by then, we are out," I say.` : `“房东说五号中午前交不上房租，我们就得搬走，${elias(language)}。”我说。` },
  { id: 'arrival', kind: 'plan', input: language => language === 'en' ? `I tell ${elias(language)}: "${pavel(language)} will be here at nine tomorrow morning to collect the cart. Make sure the gate is open."` : `我对${elias(language)}说：“${pavel(language)}明天早上九点会来取车，记得把门打开。”` },
  { id: 'frost', kind: 'plan', input: language => language === 'en' ? `I tell ${elias(language)}: "The first frost is due by Saturday night. Bring the pumpkins in before it hits."` : `我对${elias(language)}说：“周六夜里要下第一场霜，在那之前把南瓜都搬进来。”` },
  { id: 'smalltalk', kind: 'none', input: language => language === 'en' ? `I ask ${elias(language)} how his day was.` : `我问${elias(language)}今天过得怎么样。` },
  { id: 'immediate', kind: 'none', input: both('I pour myself some tea and sit down at the table.', '我给自己倒了杯茶，在桌边坐下。') },
  { id: 'passing', kind: 'none', input: both('I say that I might visit my aunt one day, when things are calmer.', '我说等事情平静些，哪天也许会去看看我姑姑。') },
]

/** The harness builds scenes from situation cases: this is the plan case in that shape. */
export const asSituation = (made: PlanCase): SituationCase => ({ id: made.id, kind: 'clean', earlier: () => '', input: made.input, forbidden: () => [], keeps: () => [] })
