import { createSessionStore } from '@dsh-agentic-roleplay/state'
import { castSummary } from '../../src/host/orchestration/defaults.ts'
import { castOf, placeViewOf } from '../../src/host/orchestration/store.ts'
import { unknownNames, unknownProblem } from '../../src/host/orchestration/situation-check.ts'
import type { CastMember, TurnStore } from '../../src/host/orchestration/boundaries.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import type { Language } from './language.ts'
import { CAST, PLAYER, castName, type Who } from './attribution-cases.ts'
import { AWAY, PRESENT, type SituationCase } from './situation-cases.ts'

export interface Problem { rule: 'leak' | 'dropped' | 'asked-away' | 'unreadable'; detail: string }

export const ACTIVATION_SCHEMA = {
  type: 'object',
  properties: {
    characters: { type: 'array', items: { type: 'string' }, description: 'Keys of the characters to ask.' },
    reaches: { type: 'array', items: { type: 'object', properties: { character: { type: 'string' }, how: { type: 'string' } }, required: ['character', 'how'], additionalProperties: false }, description: 'For each character asked that is not where the player\'s character is: how the moment reaches it (a call, a message, a shout across a distance, a spell). Leave out when everyone asked is there.' },
    situation: { type: 'string', description: 'An objective description of the moment: what the player\'s character just did or said. Every character is told this and nothing more, so leave out anyone\'s private thoughts.' },
  },
  required: ['characters', 'situation', 'reaches'],
  additionalProperties: false,
}

/** The sentence added to the game master's instructions for this benchmark, which the `old` variant leaves out. */
const ADDED = { en: /The characters are told it as fact and know nothing else:.*?a character has no way of knowing\. /s, zh: /角色会把它当作事实，并且除此之外一无所知：.*?角色没有途径知道的人、地点或物品。/s }

type Story = Parameters<typeof castOf>[0]
export interface Built { session: Story; cast: CastMember[]; store: TurnStore; persona: string; prompt: string }

export function build(made: SituationCase, language: Language, variant: 'old' | 'new'): Built {
  const raw = createSessionStore(':memory:', { id: `bench-situation-${made.id}`, name: made.id, world: { id: 'bench', name: 'Bench' } })
  const session = raw as unknown as Story
  for (const key of CAST) {
    session.characters.add({ sourceId: key, name: castName(key, language), aliases: [], kind: 'person', tier: 'principal', role: key === PLAYER ? 'playable' : 'npc', control: key === PLAYER ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  }
  const room = session.locations.add({ sourceId: 'room', name: language === 'en' ? 'The kitchen' : '厨房', description: '', features: [] })
  const away = session.locations.add({ sourceId: 'away', name: language === 'en' ? 'Elsewhere' : '别处', description: '', features: [] })
  for (const key of CAST) session.placements.place('character', session.characters.getBySourceId(key)!.id, { locationId: (PRESENT.includes(key) ? room : away).id })
  const id = (key: Who): number => session.characters.getBySourceId(key)!.id
  for (const [from, to] of [['mara', 'elias'], ['elias', 'mara'], ['elias', 'pavel'], ['pavel', 'elias'], ['mara', 'odile'], ['odile', 'mara']] as const) session.relationships.upsert(id(from), id(to), { label: 'acquaintance' }, 0)
  const cast = castOf(session)
  const store = { story: session, place: (locationId: number) => placeViewOf(session, locationId) } as unknown as TurnStore
  const name = language === 'en' ? 'English' : 'Chinese'
  let master = shippedText('roleplay/game-master', language, { language: name, preview: '', dice: '', standing: '' })
  if (variant === 'old') master = master.replace(ADDED[language], '')
  const persona = `${shippedText('roleplay/persona', language, { language: name, style: '' })}\n\n${master}`
  const input = made.input(language)
  const scene = castSummary.scene({ cast, turn: 3, input, story: session, language, report: undefined } as never)
  const prompt = `${scene}\n\n${made.earlier(language)}\n\n${language === 'en' ? 'The player\'s message:' : '玩家的消息：'}\n${input}\n\n${language === 'en' ? 'Now call activate_characters: answer with its arguments.' : '现在调用 activate_characters：给出它的参数。'}`
  return { session, cast, store, persona, prompt }
}

/** What the situation must not carry, by who is named and by the words only the thought holds. */
type Answer = { characters?: string[]; reaches?: { character: string; how: string }[]; situation?: string }
export function score(answer: Answer, made: SituationCase, language: Language): Problem[] {
  const problems: Problem[] = []
  const situation = (answer.situation ?? '').toLowerCase()
  if (answer.situation === undefined || !Array.isArray(answer.characters)) return [{ rule: 'unreadable', detail: JSON.stringify(answer).slice(0, 120) }]
  for (const word of made.forbidden(language)) if (situation.includes(word)) problems.push({ rule: 'leak', detail: word })
  const kept = made.keeps(language)
  if (!kept.some(word => situation.includes(word))) problems.push({ rule: 'dropped', detail: kept.join(' | ') })
  const asked = answer.characters.filter(key => AWAY.includes(key as Who) && !(answer.reaches ?? []).some(entry => entry.character === key && entry.how.trim() !== ''))
  if (asked.length > 0) problems.push({ rule: 'asked-away', detail: asked.join(', ') })
  return problems
}

/** What the engine's check would send back for this situation, and the text of the refusal. */
export function refusal(built: Built, answer: Answer, refused: Map<string, number>): string | undefined {
  const reached = new Set((answer.reaches ?? []).filter(entry => entry.how.trim() !== '').map(entry => entry.character))
  const unreached = (answer.characters ?? []).filter(key => AWAY.includes(key as Who) && !reached.has(key)).map(key => built.cast.find(member => member.key === key)!)
  if (unreached.length > 0) return `${unreached.map(member => `${member.character.name} (${member.key})`).join(', ')} ${unreached.length === 1 ? 'is' : 'are'} not where the player's character is: ask them only if the moment really reaches them through something the world has (a call, a message, a shout across a distance, a spell), and say how in reaches; otherwise leave them out`
  const recipients = built.cast.filter(member => (answer.characters ?? []).includes(member.key))
  const found = unknownNames(answer.situation ?? '', recipients, built.cast, built.store, refused)
  for (const entry of found) for (const other of entry.names) refused.set(`${entry.recipient}|${other}`, (refused.get(`${entry.recipient}|${other}`) ?? 0) + 1)
  return found.length === 0 ? undefined : unknownProblem(found, built.cast)
}

export const GATE_MESSAGE = 'the situation tells the characters something they could not have perceived (what the player\'s character only thinks, feels or hides, or a person or thing only that mentions): write only what each of them could see or hear of the moment, and ask again'
