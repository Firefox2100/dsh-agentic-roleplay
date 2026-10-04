import type { CharacterId, ExitState, Holder, Item, ItemId, LocationId } from 'dsh-roleplay-model'
import { InvalidMoveError } from '../errors.ts'
import type { CharacterRepository, ItemRepository, LocationRepository, PlacementRepository } from '../repositories.ts'
import { characterKey, locationKey } from './edit-types.ts'

/** The name by which models and tools refer to an item: its id in the world, or its number when it was made up in play. */
export const itemKey = (item: Pick<Item, 'id' | 'sourceId'>): string => item.sourceId ?? String(item.id)

export const ITEM_ACTIONS = ['take', 'drop', 'give', 'put', 'wear', 'remove', 'open', 'close', 'lock', 'unlock', 'reveal'] as const
export type ItemAction = (typeof ITEM_ACTIONS)[number]

/** What a character does with an item, by keys. */
export interface ItemChangeSpec {
  item: string
  action: ItemAction
  /** For give: the character it goes to. For put: the container it goes into. */
  to?: string
  /** For wear: the slot, when it has to be named. */
  slot?: string
  /** How many, of something that comes in numbers; all of it when left out. */
  quantity?: number
  /** For drop and put: where in the place or container. */
  position?: string
  /** For drop: the feature of the place it is left at. */
  feature?: string
  /** For lock and unlock: the item used. */
  with?: string
  /** For lock and unlock of a way instead of an item: the key of the place the way leads to. */
  exit?: string
  /** For open, lock and unlock: the story breaks it open or shut instead (picked, smashed). */
  forced?: boolean
}

export interface ItemContext {
  items: ItemRepository
  locations: Pick<LocationRepository, 'get' | 'getExit' | 'list' | 'updateExit'>
  placements: Pick<PlacementRepository, 'get'>
  characters: Pick<CharacterRepository, 'get' | 'list'>
}

/** What changes if the action is done. */
export type ItemPlan =
  | { action: 'move'; spec: ItemChangeSpec; item: Item; quantity: number; holder: Holder; summary: string }
  | { action: 'container'; spec: ItemChangeSpec; item: Item; state: 'open' | 'closed' | 'locked'; summary: string }
  | { action: 'exit'; spec: ItemChangeSpec; from: LocationId; to: LocationId; state: ExitState; summary: string }
  | { action: 'reveal'; spec: ItemChangeSpec; item: Item; summary: string }

/** What was done, for the record of the round. */
export interface ItemEffect {
  item: { key: string; name: string }
  action: ItemAction
  /** In words: "now carried by Bob", "now in the chest". */
  summary: string
}

type Reach = { kind: 'held' } | { kind: 'here' } | { kind: 'other'; by: string } | { kind: 'blocked'; why: string } | { kind: 'elsewhere' }

/** How a character can get at an item: carrying it, with it in the place it is in, or not at all and why. */
function reach(ctx: ItemContext, actor: CharacterId, item: Item, options: { allowHidden?: boolean; selfClosed?: boolean } = {}): Reach {
  const place = ctx.placements.get('character', actor)?.locationId
  if (item.hidden && options.allowHidden !== true) return { kind: 'blocked', why: `${item.name} cannot be seen` }
  let current: Item = item
  for (let hop = 0; hop < 32; hop++) {
    const holding = ctx.items.holding(current.id)
    if (holding === undefined) return { kind: 'elsewhere' }
    const { holder } = holding
    if (holder.kind === 'item') {
      const container = ctx.items.get(holder.itemId)
      if (container === undefined) return { kind: 'elsewhere' }
      if (container.hidden && options.allowHidden !== true) return { kind: 'blocked', why: `${item.name} cannot be seen` }
      if (container.container?.state !== 'open') return { kind: 'blocked', why: `${item.name} is inside ${container.name}, which is ${container.container?.state ?? 'closed'}` }
      current = container
      continue
    }
    if (holder.kind === 'character') {
      if (holder.characterId === actor) return { kind: 'held' }
      return { kind: 'other', by: ctx.characters.get(holder.characterId)?.name ?? String(holder.characterId) }
    }
    return holder.locationId === place ? { kind: 'here' } : { kind: 'elsewhere' }
  }
  return { kind: 'elsewhere' }
}

const resolveItem = (ctx: ItemContext, key: string): Item | undefined => ctx.items.getBySourceId(key) ?? (Number.isInteger(Number(key)) ? ctx.items.get(Number(key)) : undefined)
const resolveCharacter = (ctx: ItemContext, key: string) => ctx.characters.list().find(character => characterKey(character) === key)
const resolvePlace = (ctx: ItemContext, key: string) => ctx.locations.list().find(place => locationKey(place) === key)

/**
 * Whether a character can do what the spec says with an item right now, and what it would come to. The
 * rules are the ones the story would expect, decided in code: it can only act on what it can get at (carried,
 * or here and in plain sight, in open containers only), it cannot take what someone else holds, a lock needs
 * the key it fits, a slot holds only so many.
 * @returns the plan, or every reason it cannot be done.
 */
export function planItemChange(ctx: ItemContext, actorId: CharacterId, spec: ItemChangeSpec): { ok: true; plan: ItemPlan } | { ok: false; problems: string[] } {
  const fail = (...problems: string[]): { ok: false; problems: string[] } => ({ ok: false, problems })
  const actor = ctx.characters.get(actorId)
  if (actor === undefined) return fail(`there is no character ${actorId}`)
  if (!ITEM_ACTIONS.includes(spec.action)) return fail(`unknown action "${String(spec.action)}" (the actions are: ${ITEM_ACTIONS.join(', ')})`)
  const place = ctx.placements.get('character', actorId)?.locationId

  if ((spec.action === 'lock' || spec.action === 'unlock' || spec.action === 'open') && spec.exit !== undefined) {
    if (spec.action === 'open') return fail('a way is open or locked, not opened: use unlock for a locked way')
    const to = resolvePlace(ctx, spec.exit)
    if (to === undefined) return fail(`there is no place "${spec.exit}"`)
    if (place === undefined) return fail(`${actor.name} is not in any place`)
    const exit = ctx.locations.getExit(place, to.id)
    if (exit === undefined) return fail(`there is no way from here to ${to.name}`)
    if (exit.state === 'blocked') return fail(`the way to ${to.name} is blocked, not locked: clearing it is a matter of the story, not a key`)
    const wanted = spec.action === 'lock' ? 'locked' : 'open'
    if (exit.state === wanted) return fail(`the way to ${to.name} is already ${wanted}`)
    const keyProblem = keyFor(ctx, actorId, spec, ctx.items.openers({ kind: 'exit', id: exit.id }), `the way to ${to.name}`)
    return keyProblem === undefined ? { ok: true, plan: { action: 'exit', spec, from: place, to: to.id, state: wanted, summary: `the way to ${to.name} is now ${wanted}` } } : fail(keyProblem)
  }

  const item = resolveItem(ctx, spec.item)
  if (item === undefined) return fail(`there is no item "${spec.item}" (list_items shows the keys)`)
  const quantity = spec.quantity ?? item.quantity
  const countProblems = (): string[] => {
    if (!Number.isInteger(quantity) || quantity < 1) return ['the quantity must be a whole number from 1']
    if (quantity > item.quantity) return [`there ${item.quantity === 1 ? 'is only 1' : `are only ${item.quantity}`} ${item.name}, not ${quantity}`]
    if (quantity < item.quantity && item.unique) return [`${item.name} is one thing and cannot be split`]
    return []
  }
  const reachable = reach(ctx, actorId, item, { allowHidden: spec.action === 'reveal' })
  const blocked = (): string[] => {
    if (reachable.kind === 'blocked') return [reachable.why]
    if (reachable.kind === 'elsewhere') return [`${item.name} is not here, and ${actor.name} does not have it`]
    return []
  }
  const moving = (holder: Holder, summary: string): { ok: true; plan: ItemPlan } => ({ ok: true, plan: { action: 'move', spec, item, quantity, holder, summary } })

  switch (spec.action) {
    case 'take': {
      const problems = [...blocked(), ...countProblems()]
      const direct = ctx.items.holding(item.id)?.holder
      if (reachable.kind === 'held' && direct?.kind === 'character') problems.push(`${actor.name} already has ${item.name}`)
      if (reachable.kind === 'other') problems.push(`${item.name} is held by ${reachable.by}, who has to give it`)
      return problems.length > 0 ? fail(...problems) : moving({ kind: 'character', characterId: actorId, mode: 'held' }, `now carried by ${actor.name}`)
    }
    case 'drop': {
      const problems = [...blocked(), ...countProblems()]
      const holding = ctx.items.holding(item.id)
      if (holding?.holder.kind === 'character' && holding.holder.mode === 'worn') problems.push(`${item.name} is worn: remove it first`)
      if (reachable.kind !== 'held' && problems.length === 0) problems.push(`${actor.name} is not carrying ${item.name}`)
      if (place === undefined) problems.push(`${actor.name} is not in any place, so there is nowhere to leave it`)
      if (problems.length > 0 || place === undefined) return fail(...problems)
      const where = ctx.locations.get(place)
      if (spec.feature !== undefined && !where?.features.some(feature => feature.key === spec.feature)) return fail(`${where?.name ?? 'this place'} has no feature "${spec.feature}"`)
      return moving({ kind: 'location', locationId: place, ...(spec.position === undefined ? {} : { position: spec.position }), ...(spec.feature === undefined ? {} : { featureKey: spec.feature }) }, `now left in ${where?.name ?? 'the place'}`)
    }
    case 'give': {
      const problems = [...blocked(), ...countProblems()]
      const to = spec.to === undefined ? undefined : resolveCharacter(ctx, spec.to)
      if (spec.to === undefined) problems.push('say who it is given to')
      else if (to === undefined) problems.push(`there is no character "${spec.to}"`)
      else if (to.id === actorId) problems.push(`${actor.name} cannot give something to itself`)
      else if (place === undefined || ctx.placements.get('character', to.id)?.locationId !== place) problems.push(`${to.name} is not here`)
      if (reachable.kind !== 'held' && problems.length === 0) problems.push(`${actor.name} is not carrying ${item.name}`)
      const holding = ctx.items.holding(item.id)
      if (holding?.holder.kind === 'character' && holding.holder.mode === 'worn') problems.push(`${item.name} is worn: remove it first`)
      return problems.length > 0 || to === undefined ? fail(...problems) : moving({ kind: 'character', characterId: to.id, mode: 'held' }, `now carried by ${to.name}`)
    }
    case 'put': {
      const problems = [...blocked(), ...countProblems()]
      const container = spec.to === undefined ? undefined : resolveItem(ctx, spec.to)
      if (spec.to === undefined) problems.push('say which container it goes into')
      else if (container === undefined) problems.push(`there is no item "${spec.to}"`)
      else if (container.container === undefined) problems.push(`${container.name} cannot hold things`)
      else if (container.id === item.id || ctx.items.ancestors(container.id).includes(item.id)) problems.push(`${item.name} cannot be put inside itself`)
      else {
        const reachContainer = reach(ctx, actorId, container)
        if (reachContainer.kind === 'blocked') problems.push(reachContainer.why)
        else if (reachContainer.kind === 'elsewhere' || reachContainer.kind === 'other') problems.push(`${container.name} is not within reach`)
        else if (container.container?.state !== 'open') problems.push(`${container.name} is ${container.container?.state}: open it first`)
      }
      if (reachable.kind !== 'held' && problems.length === 0) problems.push(`${actor.name} is not carrying ${item.name}`)
      return problems.length > 0 || container === undefined ? fail(...problems) : moving({ kind: 'item', itemId: container.id, ...(spec.position === undefined ? {} : { position: spec.position }) }, `now in ${container.name}`)
    }
    case 'wear': {
      const problems = [...blocked()]
      if (item.wearableSlot === undefined) problems.push(`${item.name} cannot be worn`)
      else if (spec.slot !== undefined && spec.slot !== item.wearableSlot) problems.push(`${item.name} is worn on the ${item.wearableSlot}, not the ${spec.slot}`)
      if (reachable.kind !== 'held' && problems.length === 0) problems.push(`${actor.name} is not carrying ${item.name}`)
      const holding = ctx.items.holding(item.id)
      if (holding?.holder.kind === 'character' && holding.holder.mode === 'worn') problems.push(`${item.name} is already worn`)
      if (problems.length > 0 || item.wearableSlot === undefined) return fail(...problems)
      const slot = item.wearableSlot
      return moving({ kind: 'character', characterId: actorId, mode: 'worn', slot, ...(spec.position === undefined ? {} : { position: spec.position }) }, `now worn by ${actor.name} on the ${slot}`)
    }
    case 'remove': {
      const holding = ctx.items.holding(item.id)
      if (holding?.holder.kind !== 'character' || holding.holder.characterId !== actorId || holding.holder.mode !== 'worn') return fail(`${actor.name} is not wearing ${item.name}`)
      return moving({ kind: 'character', characterId: actorId, mode: 'held' }, `now carried by ${actor.name}`)
    }
    case 'open':
    case 'close': {
      const problems = [...blocked()]
      if (item.container === undefined) problems.push(`${item.name} cannot be opened or closed`)
      else if (reachable.kind === 'other') problems.push(`${item.name} is held by ${reachable.by}`)
      const state = item.container?.state
      if (spec.action === 'open') {
        if (state === 'open') problems.push(`${item.name} is already open`)
        if (state === 'locked' && spec.forced !== true) {
          const keyProblem = keyFor(ctx, actorId, spec, ctx.items.openers({ kind: 'item', id: item.id }), item.name)
          problems.push(keyProblem === undefined ? `${item.name} is locked: unlock it first` : `${item.name} is locked: ${keyProblem}`)
        }
      } else if (state !== 'open') problems.push(`${item.name} is already ${state}`)
      return problems.length > 0 ? fail(...problems) : { ok: true, plan: { action: 'container', spec, item, state: spec.action === 'open' ? 'open' : 'closed', summary: `${item.name} is now ${spec.action === 'open' ? 'open' : 'closed'}` } }
    }
    case 'lock':
    case 'unlock': {
      const problems = [...blocked()]
      const state = item.container?.state
      if (item.container === undefined) problems.push(`${item.name} has no lock`)
      else if (reachable.kind === 'other') problems.push(`${item.name} is held by ${reachable.by}`)
      if (spec.action === 'lock') {
        if (state === 'locked') problems.push(`${item.name} is already locked`)
        if (state === 'open') problems.push(`${item.name} is open: close it first`)
      } else if (state !== 'locked') problems.push(`${item.name} is not locked`)
      if (problems.length === 0) {
        const keyProblem = spec.forced === true && spec.action === 'unlock' ? undefined : keyFor(ctx, actorId, spec, ctx.items.openers({ kind: 'item', id: item.id }), item.name)
        if (keyProblem !== undefined) problems.push(keyProblem)
      }
      return problems.length > 0 ? fail(...problems) : { ok: true, plan: { action: 'container', spec, item, state: spec.action === 'lock' ? 'locked' : 'closed', summary: `${item.name} is now ${spec.action === 'lock' ? 'locked' : 'unlocked'}` } }
    }
    case 'reveal': {
      if (!item.hidden) return fail(`${item.name} is not hidden`)
      const problems = blocked()
      if (reachable.kind === 'other') problems.push(`${item.name} is held by ${reachable.by}`)
      return problems.length > 0 ? fail(...problems) : { ok: true, plan: { action: 'reveal', spec, item, summary: `${item.name} is found` } }
    }
  }
}

/** Why a lock cannot be worked, or nothing when it can: the key must be held and be one that fits. */
function keyFor(ctx: ItemContext, actor: CharacterId, spec: ItemChangeSpec, fits: readonly ItemId[], what: string): string | undefined {
  if (spec.forced === true) return undefined
  if (fits.length === 0) return `nothing is known to fit the lock of ${what}: if the story breaks it, say forced`
  if (spec.with === undefined) return `say which key is used on ${what}`
  const key = resolveItem(ctx, spec.with)
  if (key === undefined) return `there is no item "${spec.with}"`
  if (!fits.includes(key.id)) return `${key.name} does not fit the lock of ${what}`
  const reachKey = reach(ctx, actor, key)
  return reachKey.kind === 'held' ? undefined : `${key.name} is not in hand`
}

/** A copy of an item with another quantity, for splitting off part of a pile. */
const sameKind = (a: Item, b: Item): boolean => !a.unique && !b.unique && a.name === b.name && a.quality === b.quality && a.wearableSlot === b.wearableSlot && a.container === undefined && b.container === undefined && a.ownerId === b.ownerId

/** Do what a plan says. Part of a pile is split off, and joins a pile of the same kind where it lands. */
export function applyItemPlan(ctx: ItemContext, plan: ItemPlan): ItemEffect {
  const describe = (item: Pick<Item, 'id' | 'sourceId' | 'name'>, action: ItemAction, summary: string): ItemEffect => ({ item: { key: itemKey(item), name: item.name }, action, summary })
  switch (plan.action) {
    case 'reveal':
      ctx.items.update(plan.item.id, { hidden: false })
      return describe(plan.item, 'reveal', plan.summary)
    case 'container':
      ctx.items.update(plan.item.id, { container: { state: plan.state } })
      return describe(plan.item, plan.spec.action, plan.summary)
    case 'exit': {
      for (const [from, to] of [[plan.from, plan.to], [plan.to, plan.from]] as const) {
        const exit = ctx.locations.getExit(from, to)
        if (exit !== undefined) ctx.locations.updateExit(exit.id, { state: plan.state })
      }
      return { item: { key: locationKey(ctx.locations.get(plan.to)!), name: ctx.locations.get(plan.to)!.name }, action: plan.spec.action, summary: plan.summary }
    }
    case 'move': {
      const { item, quantity, holder } = plan
      const joins = holder.kind !== 'character' || holder.mode === 'held'
      const twin = joins ? ctx.items.contents(holderKey(holder)).find(({ item: other }) => other.id !== item.id && sameKind(item, other))?.item : undefined
      if (quantity >= item.quantity) {
        if (twin === undefined) {
          ctx.items.place(item.id, holder)
          return describe(item, plan.spec.action, plan.summary)
        }
        ctx.items.update(twin.id, { quantity: twin.quantity + item.quantity })
        ctx.items.remove(item.id)
        return describe(twin, plan.spec.action, plan.summary)
      }
      ctx.items.update(item.id, { quantity: item.quantity - quantity })
      if (twin !== undefined) {
        ctx.items.update(twin.id, { quantity: twin.quantity + quantity })
        return describe(twin, plan.spec.action, plan.summary)
      }
      const { id: _id, sourceId: _sourceId, createdAt: _createdAt, ...rest } = item
      return describe(ctx.items.add({ ...rest, quantity }, holder), plan.spec.action, plan.summary)
    }
  }
}

function holderKey(holder: Holder): { kind: 'location' | 'character' | 'item'; id: number } {
  return holder.kind === 'location' ? { kind: 'location', id: holder.locationId } : holder.kind === 'character' ? { kind: 'character', id: holder.characterId } : { kind: 'item', id: holder.itemId }
}

/**
 * Do what a character does with an item.
 * @throws {InvalidMoveError} naming every reason when it cannot, changing nothing.
 */
export function changeItem(ctx: ItemContext, actorId: CharacterId, spec: ItemChangeSpec): ItemEffect {
  const planned = planItemChange(ctx, actorId, spec)
  if (!planned.ok) throw new InvalidMoveError(planned.problems)
  return applyItemPlan(ctx, planned.plan)
}
