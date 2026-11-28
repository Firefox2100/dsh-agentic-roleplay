import { createSessionStore } from '@dsh-agentic-roleplay/state'
import { sharedContext } from '../../src/host/orchestration/defaults.ts'
import type { CharacterRequest } from '../../src/host/orchestration/boundaries.ts'
import { CHARACTER_ACTION_SCHEMA } from '../../src/host/orchestration/protocol.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { CAST, PLAYER, castName } from './attribution-cases.ts'
import type { Language } from './language.ts'

export type Stance = 'affirms' | 'rejects' | 'unsure'

/**
 * A character is asked about something it has heard said and is told how it stands by what it saw itself (a settled claim, the standing its own events give it). A character that saw the
 * claim borne out should stand by it, one that saw it refuted should reject it, one that saw nothing should not pretend to know.
 */
export interface HeardCase {
  id: string
  standing: 'true' | 'false' | 'unresolved'
  stance: Stance
  /** The character asked. */
  who: (typeof CAST)[number]
  text: (language: Language) => { situation: string; claim: string; by: string }
}

const ask = (standing: HeardCase['standing'], stance: Stance, id: string): HeardCase => ({
  id, standing, stance, who: 'elias',
  text: language => ({
    situation: language === 'en' ? `In the hall, ${castName('odile', 'en')} turns to ${castName('elias', 'en')} and asks: "${castName('pavel', 'en')} was the figure in the garden last night, wasn't he? You were there. Tell me plainly."` : `在大厅里，${castName('odile', 'zh')}转向${castName('elias', 'zh')}问：“昨晚花园里的人影是${castName('pavel', 'zh')}，对不对？你当时在场，直接告诉我。”`,
    claim: language === 'en' ? `The figure in the garden last night was ${castName('pavel', 'en')}.` : `昨晚花园里的人影是${castName('pavel', 'zh')}。`,
    by: castName('odile', language),
  }),
})

export const HEARD_CASES: HeardCase[] = [ask('true', 'affirms', 'borne-out'), ask('false', 'rejects', 'refuted'), ask('unresolved', 'unsure', 'nothing-seen')]

/** The request a character gets in play, with the claim it heard in its own words and standing; the persona and prompt are what the product would send. */
export function heardRequest(made: HeardCase, language: Language): { persona: string; prompt: string; schema: unknown } {
  const session = createSessionStore(':memory:', { id: `bench-${made.id}`, name: made.id, world: { id: 'bench', name: 'Bench' } })
  const members = CAST.map((key) => {
    const character = session.characters.add({ sourceId: key, name: castName(key, language), aliases: [], kind: 'person', tier: 'principal', role: key === PLAYER ? 'playable' : 'npc', control: key === PLAYER ? 'player' : 'agent', summary: language === 'en' ? 'A member of the household.' : '这户人家的一员。', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    return { key, character }
  })
  const member = members.find(entry => entry.key === made.who)!
  const said = made.text(language)
  const request = {
    member, cast: members.filter(entry => entry.key !== PLAYER), situation: said.situation, attempt: 1, language, turn: 3, lookup: false,
    text: (id: string, variables?: Record<string, string | number>) => shippedText(id, language, { language: language === 'en' ? 'English' : 'Chinese', ...variables }),
    heard: [{ text: said.claim, by: said.by, standing: made.standing === 'true' ? 'true' : made.standing === 'false' ? 'false' : 'unresolved' }],
  } as unknown as CharacterRequest
  const { persona, prompt } = sharedContext.brief(request)
  session.close()
  return { persona, prompt, schema: CHARACTER_ACTION_SCHEMA }
}

/** The question a judging model answers about what the character said and meant. */
export const STANCE_QUESTION: Record<Language, string> = {
  en: 'You read what a character answered when asked whether a claim is so. Decide the stance: affirms (it stands by the claim, says or implies it is so), rejects (it denies the claim, says or implies it is not so) or unsure (it says it cannot tell, does not know, or gives no answer either way). Judge only from the character\'s own words and intent, never from what you think is true.',
  zh: '你要读一个角色在被问到某个说法是否属实时的回答，判断它的态度：affirms（坚持这个说法，明说或暗示确有其事）、rejects（否认这个说法，明说或暗示并非如此）或 unsure（说无法判断、不知道，或没有给出任何一边的答案）。只依据角色自己的话和意图来判断，不要依据你认为什么是真的。',
}

export const STANCE_SCHEMA = { type: 'object', properties: { stance: { type: 'string', enum: ['affirms', 'rejects', 'unsure'] } }, required: ['stance'], additionalProperties: false } as const
