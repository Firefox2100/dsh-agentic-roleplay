import type { Exit, LocationId, Move, MovePlan } from 'dsh-roleplay-model'
import { InvalidMoveError } from '../errors.ts'
import type { KnowledgeRepository, LocationRepository, PlacementRepository } from '../repositories.ts'

export interface MoveContext {
  locations: Pick<LocationRepository, 'get' | 'allExits'>
  placements: Pick<PlacementRepository, 'get' | 'place'>
}

export interface KnownMoveContext extends MoveContext {
  knowledge: Pick<KnowledgeRepository, 'knows'>
}

const name = (context: MoveContext, id: LocationId): string => context.locations.get(id)?.name ?? String(id)

/** The shortest way over exits that satisfy `usable`, as the exits taken in order, or `undefined` when there is none. */
function shortestWay(exits: readonly Exit[], from: LocationId, to: LocationId, usable: (exit: Exit) => boolean): Exit[] | undefined {
  const reached = new Map<LocationId, Exit[]>([[from, []]])
  const queue: LocationId[] = [from]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (next === to) return reached.get(next)
    for (const exit of exits) {
      if (exit.fromId !== next || reached.has(exit.toId) || !usable(exit)) continue
      reached.set(exit.toId, [...reached.get(next)!, exit])
      queue.push(exit.toId)
    }
  }
  return undefined
}

/**
 * Whether a character can go where a move says, and the way it would take. Moving to where it
 * already is only changes its position. Otherwise there must be a way over open exits, unless the
 * move ignores them.
 * @returns the plan, or the reasons it cannot be done.
 */
export function planMove(context: MoveContext, characterId: number, move: Move): { ok: true; plan: MovePlan } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const destination = context.locations.get(move.to)
  if (destination === undefined) return { ok: false, problems: [`there is no place ${move.to}`] }
  if (move.featureKey !== undefined && !destination.features.some(feature => feature.key === move.featureKey)) {
    problems.push(`${destination.name} has no feature "${move.featureKey}" (it has: ${destination.features.map(feature => feature.key).join(', ') || 'none'})`)
  }
  const from = context.placements.get('character', characterId)?.locationId
  if (from === move.to) return problems.length > 0 ? { ok: false, problems } : { ok: true, plan: { from, to: move.to, via: [] } }
  if (from === undefined || move.ignoreExits === true) return problems.length > 0 ? { ok: false, problems } : { ok: true, plan: { ...(from === undefined ? {} : { from }), to: move.to, via: [move.to] } }

  const exits = context.locations.allExits()
  const way = shortestWay(exits, from, move.to, exit => exit.state === 'open')
  if (way === undefined) {
    const blocked = shortestWay(exits, from, move.to, () => true)
    if (blocked === undefined) problems.push(`there is no way from ${name(context, from)} to ${destination.name}`)
    else {
      const stopper = blocked.find(exit => exit.state !== 'open')!
      problems.push(`the way from ${name(context, from)} to ${destination.name} is ${stopper.state} at ${name(context, stopper.fromId)} -> ${name(context, stopper.toId)}${stopper.note === '' ? '' : `: ${stopper.note}`}`)
    }
  }
  if (problems.length > 0 || way === undefined) return { ok: false, problems }
  const times = way.map(exit => exit.travelSeconds)
  return { ok: true, plan: { from, to: move.to, via: way.map(exit => exit.toId), ...(times.every(time => time !== undefined) ? { travelSeconds: times.reduce<number>((sum, time) => sum + time!, 0) } : {}) } }
}

/** Plan only through places and directed ways this character knows; forced movement remains the authoritative planner's job. */
export function planKnownMove(context: KnownMoveContext, characterId: number, move: Move): ReturnType<typeof planMove> {
  // a character in no place yet is being placed, not travelling: there is nothing it could know the way from
  const placed = context.placements.get('character', characterId) !== undefined
  if (move.ignoreExits !== true && placed && !context.knowledge.knows(characterId, 'location', move.to)) return { ok: false, problems: [`the character does not know place ${move.to}`] }
  if (move.ignoreExits === true) return planMove(context, characterId, move)
  return planMove({
    placements: context.placements,
    locations: { get: id => context.locations.get(id), allExits: () => context.locations.allExits().filter(exit => context.knowledge.knows(characterId, 'exit', exit.id)) },
  }, characterId, move)
}

/**
 * Move a character: where it stands changes to the destination, at the position or feature given.
 * @throws {InvalidMoveError} naming every reason when it cannot.
 */
export function moveCharacter(context: MoveContext, characterId: number, move: Move): MovePlan {
  const result = planMove(context, characterId, move)
  if (!result.ok) throw new InvalidMoveError(result.problems)
  if (result.plan.from === move.to && move.position === undefined && move.featureKey === undefined) return result.plan
  context.placements.place('character', characterId, { locationId: move.to, ...(move.position === undefined ? {} : { position: move.position }), ...(move.featureKey === undefined ? {} : { featureKey: move.featureKey }) })
  return result.plan
}
