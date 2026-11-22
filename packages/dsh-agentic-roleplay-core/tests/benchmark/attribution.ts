import { createSessionStore, parseRecordsEdit, recordsEditSchema, type RecordsEdit } from '@dsh-agentic-roleplay/state'
import { describePrompt } from '../../src/host/orchestration/committer.ts'
import type { CommitEntry, CommitJob, TurnStore } from '../../src/host/orchestration/boundaries.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings.ts'
import type { Language } from './language.ts'
import { CAST, PLAYER, castName, type AttributionCase, type Who } from './attribution-cases.ts'

export interface Problem { rule: 'untouched' | 'speaker-missing' | 'unreadable'; detail: string }

/** The story at the start of the case: the invented cast and nothing recorded, so everything the keeper writes is its own. */
export function jobOf(made: AttributionCase, language: Language): { job: CommitJob; persona: string; prompt: string; schema: unknown } {
  const session = createSessionStore(':memory:', { id: `bench-${made.id}`, name: made.id, world: { id: 'bench', name: 'Bench' } })
  for (const key of CAST) {
    session.characters.add({ sourceId: key, name: castName(key, language), aliases: [], kind: 'person', tier: 'principal', role: key === PLAYER ? 'playable' : 'npc', control: key === PLAYER ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  }
  const room = session.locations.add({ sourceId: 'room', name: language === 'en' ? 'The parlor' : '客厅', description: '', features: [] })
  const away = session.locations.add({ sourceId: 'away', name: language === 'en' ? 'Elsewhere' : '别处', description: '', features: [] })
  for (const key of CAST) session.placements.place('character', session.characters.getBySourceId(key)!.id, { locationId: (made.present.includes(key) ? room : away).id })
  const settings = { ...DEFAULT_SETTINGS, prompts: { ...DEFAULT_SETTINGS.prompts, language } }
  const store = { story: session, cast: () => session.characters.list().map(character => ({ key: character.sourceId, character })), settings: () => settings, queryVector: async () => undefined } as unknown as TurnStore
  const entries = made.entries(language).map((entry): CommitEntry => ({ ...entry, name: castName(entry.character as Who, language), intent: entry.summary, commitment: 'medium', spoken: true }))
  const job: CommitJob = { chat: 'bench', store, rounds: [{ turn: 3, round: 1, situation: made.situation(language), place: { key: 'room', name: language === 'en' ? 'The parlor' : '客厅' }, present: made.present.map(character => ({ character, place: 'room' })), entries }] }
  const name = language === 'en' ? 'English' : 'Chinese'
  return { job, persona: shippedText('roleplay/record-keeper', language, { language: name }), prompt: describePrompt(job, settings.memory), schema: recordsEditSchema({ characters: CAST }) }
}

/** What the written records must not say: held against the structured edit the keeper produced, by who is named, never by wording. */
export function scoreEdit(answer: unknown, made: AttributionCase): Problem[] {
  let edit: RecordsEdit
  try { edit = parseRecordsEdit(answer) } catch (error) { return [{ rule: 'unreadable', detail: error instanceof Error ? error.message : String(error) }] }
  const problems: Problem[] = []
  const named = (character: string): string => character.trim().toLowerCase()
  const touched = new Map<string, string>()
  for (const event of edit.events ?? []) for (const seen of event.perceivedBy ?? []) touched.set(named(seen.character), `perceives "${event.text}"`)
  for (const added of edit.perceptionsAdded ?? []) touched.set(named(added.character), 'was given a perception')
  for (const belief of edit.beliefs ?? []) touched.set(named(belief.character), `believes "${belief.text}"`)
  for (const state of edit.states ?? []) touched.set(named(state.character), 'had a state written')
  for (const absent of made.untouched) if (touched.has(absent)) problems.push({ rule: 'untouched', detail: `${absent} ${touched.get(absent)}` })
  const involved = (edit.events ?? []).some(event => (event.involves ?? []).map(named).includes(made.speaker))
  if (!involved) problems.push({ rule: 'speaker-missing', detail: `no event involves ${made.speaker}` })
  return problems
}
