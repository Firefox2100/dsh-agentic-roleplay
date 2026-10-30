import { locationKey as placeKey } from '@dsh-agentic-roleplay/state'
import { AUTHORING_NEEDS, type Boundaries, type CreateReport, type TurnStore } from './boundaries.ts'
import { slug, uniqueKey } from '../import/run.ts'
import type { TurnOwner } from './turn-engine.ts'
import type { TurnState } from './turn-state.ts'
import { oocBlock } from './turn-rules.ts'

/** What the game master says of a thing it introduces. */
export interface ThingInput { name: string; description?: string; quantity?: number; quality?: string; notable?: boolean; hidden?: boolean; at?: string; heldBy?: string; inside?: string }

/**
 * The game master asks for something to be made up (a place the story has gone to, someone who has
 * joined): the world author decides whether the story genuinely needs it, and makes it or says why not.
 * The world may be closed, and only so many things may be made up in a turn.
 * @throws {Error} when the world is closed, the limit of the turn is reached, a round is open, or the request is empty.
 */
export async function expandWorld(boundaries: Boundaries, store: TurnStore, state: TurnState, owner: TurnOwner, input: { need: string; what: string }, signal: AbortSignal): Promise<CreateReport> {
  if (state.phase === 'resolving' || state.phase === 'retrying') throw new Error('resolve the round first: the world is extended between rounds, not in the middle of one')
  const blocked = oocBlock(state)
  if (blocked !== undefined) throw new Error(blocked)
  const need = AUTHORING_NEEDS.find(candidate => candidate === input.need)
  if (need === undefined) throw new Error(`"${input.need}" is not a reason to make something up; the reasons are: ${AUTHORING_NEEDS.join(', ')}`)
  const what = input.what.trim()
  if (what === '') throw new Error('say what is needed, from what the story has established: who or where, and why now')
  const { authoring } = store.settings()
  if (!authoring.enabled) throw new Error('this world is closed: nothing can be made up in it')
  // people and places have an allowance each: a turn that moved the story to a new place must still be able to bring someone into it
  const kind = need === 'scene_change' ? 'location' : need === 'arrival' || need === 'introduction' ? 'character' : undefined
  const made = store.story.consolidation.createdIn(owner.turn).filter(entry => kind === undefined || entry.kind === kind).length
  if (made >= authoring.perTurn) throw new Error(`${made} new ${kind === 'location' ? (made === 1 ? 'place was' : 'places were') : kind === 'character' ? (made === 1 ? 'character was' : 'characters were') : (made === 1 ? 'thing was' : 'things were')} already made up this turn, which is the most this chat allows: work with what exists, and do not ask again this turn`)
  return await boundaries.author.create({ chat: owner.chat, turn: owner.turn, need, what, store }, signal)
}

/**
 * The game master introduces a thing the story uses, as a table's game master would: it is made at once where the game master says
 * (a place, someone's hands, a container; the player's place when it says nothing), with no world author asked.
 * @throws {Error} when the world is closed, a round is open, the turn's allowance is used, or the thing cannot be put where it was said.
 */
export function introduceThing(store: TurnStore, state: TurnState, owner: TurnOwner, input: ThingInput): { key: string; name: string; where: string } {
  if (state.phase === 'resolving' || state.phase === 'retrying') throw new Error('resolve the round first: things are introduced between rounds, not in the middle of one')
  const blocked = oocBlock(state)
  if (blocked !== undefined) throw new Error(blocked)
  const name = input.name.trim()
  if (name === '') throw new Error('name the thing')
  const { authoring } = store.settings()
  if (!authoring.enabled) throw new Error('this world is closed: nothing can be made up in it')
  const kept = store.story.consolidation.createdIn(owner.turn).filter(entry => entry.kind === 'item').length
  if (kept >= authoring.thingsPerTurn) throw new Error(`${kept} thing${kept === 1 ? ' was' : 's were'} already introduced this turn, which is the most this chat allows`)
  const where = [input.at, input.heldBy, input.inside].filter(entry => entry !== undefined && entry.trim() !== '').length
  if (where > 1) throw new Error('say where it is in one way only: at a place, held by a character, or inside a thing')
  const player = store.cast().find(member => member.character.control === 'player')
  const here = player?.place?.location
  const placed = input.heldBy !== undefined && input.heldBy.trim() !== '' ? { heldBy: input.heldBy.trim() }
    : input.inside !== undefined && input.inside.trim() !== '' ? { inside: input.inside.trim() }
      : input.at !== undefined && input.at.trim() !== '' ? { at: { location: input.at.trim() } }
        : here === undefined ? undefined : { at: { location: placeKey(here) } }
  if (placed === undefined) throw new Error('say where it is: no place is known for the player, so name a place (at), a holder (held_by) or a container (inside)')
  const key = uniqueKey(slug(name, 'thing'), new Set(store.story.items.list().map(item => item.sourceId).filter((entry): entry is string => entry !== undefined)))
  store.story.edit({
    turn: owner.turn,
    items: [{ key, name, ...(input.description === undefined || input.description.trim() === '' ? {} : { description: input.description.trim() }), ...(input.quantity === undefined ? {} : { quantity: input.quantity }), ...(input.quality === undefined || input.quality.trim() === '' ? {} : { quality: input.quality.trim() }), ...(input.notable === undefined ? {} : { notable: input.notable }), ...(input.hidden === undefined ? {} : { hidden: input.hidden }), ...placed, note: 'introduced by the game master' }],
  })
  return { key, name, where: 'heldBy' in placed ? `held by ${placed.heldBy}` : 'inside' in placed ? `inside ${placed.inside}` : `at ${placed.at.location}` }
}
