import { ENGAGEMENT_GRACE, parseInstant, type Session } from 'dsh-roleplay-state'
import { describeWhen } from './story-clock.ts'

type OffSceneSession = Pick<Session, 'characters' | 'placements' | 'locations' | 'engagements' | 'intents' | 'metadata'>

const HANDLED = 'offscene.handled'
/** Only the most recent of what was handled is remembered: what is older is long past being due. */
const KEPT = 500

/** Something that fell due for characters who are not with the player, and what to tell them of it. */
export interface OffSceneItem {
  key: string
  kind: 'engagement' | 'goal'
  /** When it fell due. */
  at: number
  /** The characters (by key) who have it to deal with. */
  characters: string[]
  /** The key of the place the characters would go to for it, when there is one. */
  place?: string
  /** What the characters are told, in the second person. */
  text: string
}

const keyOf = (character: { id: number; sourceId?: string }): string => character.sourceId ?? String(character.id)

function handledKeys(session: OffSceneSession): Set<string> {
  const stored = session.metadata.getValue(HANDLED)
  return new Set(Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [])
}

/** Remember that these were dealt with, so that they are not dealt with again. */
export function markHandled(session: OffSceneSession, keys: readonly string[]): void {
  session.metadata.setValue(HANDLED, [...handledKeys(session), ...keys].slice(-KEPT))
}

/**
 * What has fallen due for characters who are not with the player and who have not dealt with it yet: commitments
 * whose time has come with everyone to do with them away from the scene, and goals whose deadline has passed.
 * Oldest first.
 */
export function dueOffScene(session: OffSceneSession, zone: string, now: number): OffSceneItem[] {
  const handled = handledKeys(session)
  const characters = session.characters.list()
  const player = characters.find(character => character.control === 'player')
  const playerPlace = player === undefined ? undefined : session.placements.get('character', player.id)?.locationId
  const away = (id: number): boolean => playerPlace !== undefined && session.placements.get('character', id)?.locationId !== playerPlace
  const agents = new Map(characters.filter(character => character.control === 'agent').map(character => [character.id, character]))
  const items: OffSceneItem[] = []
  for (const engagement of session.engagements.list({ status: 'pending', to: now + 1 })) {
    const key = `e${engagement.id}`
    if (handled.has(key) || now < engagement.at + 1) continue
    const everyone = engagement.participants
    if (everyone.some(id => !agents.has(id) || !away(id))) continue
    const place = engagement.locationId === undefined ? undefined : session.locations.get(engagement.locationId)
    items.push({
      key, kind: 'engagement', at: engagement.at, characters: everyone.map(id => keyOf(agents.get(id)!)),
      ...(place === undefined ? {} : { place: place.sourceId ?? String(place.id) }),
      text: `You were to ${engagement.title}${place === undefined ? '' : ` at ${place.name}`}, at ${describeWhen(engagement.at, now, zone)}${engagement.note === '' ? '' : ` (${engagement.note})`}. It is ${describeWhen(now, now, zone)} now${now > engagement.at + ENGAGEMENT_GRACE ? ' and the time has passed' : ''}. It was with: ${everyone.map(id => agents.get(id)!.name).join(', ')}. You are not with the player's character, and nothing of this happens in front of anyone: decide what you do about it.`,
    })
  }
  for (const character of agents.values()) {
    if (!away(character.id)) continue
    for (const goal of session.intents.list(character.id, { status: 'active' })) {
      const key = `g${goal.id}`
      let deadline: number | undefined
      try { deadline = goal.deadline === undefined ? undefined : parseInstant(goal.deadline, zone) } catch { deadline = undefined }
      if (handled.has(key) || deadline === undefined || deadline >= now) continue
      items.push({ key, kind: 'goal', at: deadline, characters: [keyOf(character)], text: `The time you had for "${goal.name}" has passed (${describeWhen(deadline, now, zone)}; it is ${describeWhen(now, now, zone)} now)${goal.description === '' ? '' : `: ${goal.description}`} You are not with the player's character and nothing of this happens in front of anyone: decide what you do about it.` })
    }
  }
  return items.sort((a, b) => a.at - b.at)
}
