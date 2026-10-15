import { SELF, type Trigger, type TriggerCondition, type TriggerNote } from 'dsh-roleplay-model'
import { characterKey, locationKey, type RecordsTarget } from './edit-types.ts'
import { itemKey } from './items.ts'
import { localTime } from './time.ts'
import { placeholdersOf, type Placeholder } from './template.ts'
import { conditionHolds, type TriggerClock } from './trigger-rules.ts'
import { describeValue, subjectOf } from './variables.ts'

type Reading = RecordsTarget

/** The words cannot be written as the story stands: something they name is not there. */
export class UnwritableError extends Error {}

const pad = (value: number): string => String(value).padStart(2, '0')

function resolve(target: Reading, placeholder: Placeholder, clock: TriggerClock, self: string | undefined): string {
  const key = (index: number): string => (placeholder.args[index] === SELF ? (self ?? SELF) : placeholder.args[index]!)
  const character = (wanted: string) => {
    const found = target.characters.list().find(entry => characterKey(entry) === wanted)
    if (found === undefined) throw new UnwritableError(`${placeholder.raw}: there is no character "${wanted}"`)
    return found
  }
  const place = (wanted: string) => {
    const found = target.locations.list().find(entry => locationKey(entry) === wanted)
    if (found === undefined) throw new UnwritableError(`${placeholder.raw}: there is no place "${wanted}"`)
    return found
  }
  const item = (wanted: string) => {
    const found = target.items.list().find(entry => itemKey(entry) === wanted)
    if (found === undefined) throw new UnwritableError(`${placeholder.raw}: there is no item "${wanted}"`)
    return found
  }
  switch (placeholder.kind) {
    case 'character': return character(key(0)).name
    case 'place': return place(key(0)).name
    case 'item': return item(key(0)).name
    case 'where': {
      const who = character(key(0))
      const at = target.placements.get('character', who.id)
      const found = at === undefined ? undefined : target.locations.get(at.locationId)
      if (found === undefined) throw new UnwritableError(`${placeholder.raw}: ${who.name} is nowhere in particular`)
      return found.name
    }
    case 'holder': {
      const thing = item(key(0))
      const where = target.items.where(thing.id)
      const holder = where.characterId !== undefined ? target.characters.get(where.characterId)?.name : where.locationId !== undefined ? target.locations.get(where.locationId)?.name : undefined
      if (holder === undefined) throw new UnwritableError(`${placeholder.raw}: ${thing.name} is nowhere that is known`)
      return holder
    }
    case 'value': {
      const def = target.variables.def(placeholder.args[0]!)
      if (def === undefined) throw new UnwritableError(`${placeholder.raw}: there is no variable "${placeholder.args[0]}"`)
      const subject = def.subject === 'world' ? { id: 0 } : placeholder.args[1] === undefined ? undefined : subjectOf(target, def.subject, key(1))
      if (subject === undefined) throw new UnwritableError(`${placeholder.raw}: ${def.subject === 'world' ? 'a world variable has no subject' : `give the ${def.subject} it is about`}`)
      return describeValue(def, target.variables.value(def.key, def.subject, subject.id))
    }
    case 'time': {
      const local = localTime(clock.now, clock.zone)
      return `${pad(local.hour)}:${pad(local.minute)}`
    }
  }
}

/** Words as the story stands now. @throws {UnwritableError} when something they name is not there. */
export function renderWords(target: Reading, text: string, clock: TriggerClock, self?: string): string {
  const { found } = placeholdersOf(text)
  let at = 0
  let out = ''
  for (const placeholder of found) {
    const start = text.indexOf(placeholder.raw, at)
    out += text.slice(at, start) + resolve(target, placeholder, clock, self)
    at = start + placeholder.raw.length
  }
  return out + text.slice(at)
}

/** A condition with `@self` taken as a character. */
export function bindSelf(condition: TriggerCondition, self: string): TriggerCondition {
  const bound = (value: string): string => (value === SELF ? self : value)
  switch (condition.type) {
    case 'place': return { ...condition, character: bound(condition.character) }
    case 'variable': return condition.subject === undefined ? condition : { ...condition, subject: bound(condition.subject) }
    case 'item': return { ...condition, item: bound(condition.item), ...(condition.heldBy === undefined ? {} : { heldBy: bound(condition.heldBy) }) }
    case 'all': case 'any': return { ...condition, conditions: condition.conditions.map(part => bindSelf(part, self)) }
    case 'not': return { ...condition, condition: bindSelf(condition.condition, self) }
    default: return condition
  }
}

/** The effect of a trigger that a note was made from: the beat or cue whose words it carries. */
export function noteEffect(trigger: Trigger | undefined, note: Pick<TriggerNote, 'kind' | 'text'>): (Trigger['effects'][number] & { type: 'beat' | 'cue' }) | undefined {
  return trigger?.effects.find((effect): effect is Trigger['effects'][number] & { type: 'beat' | 'cue' } => effect.type === note.kind && effect.text === note.text)
}

export interface Delivery {
  /** What is to be told now, in words as the story stands. */
  shown: { note: TriggerNote; text: string }[]
  /** What is not to be told, and why: the beat or cue no longer applies, or cannot be written. */
  withdrawn: { note: TriggerNote; reason: string }[]
}

/**
 * Decides, at the moment notes are about to be told, what is still to be told and in what words. A note whose effect says something must
 * still hold and does not hold any more is withdrawn; so is one whose words name something that is not there. Nothing is changed.
 */
export function deliverNotes(target: Reading, notes: readonly TriggerNote[], clock: TriggerClock): Delivery {
  const delivery: Delivery = { shown: [], withdrawn: [] }
  for (const note of notes) {
    const effect = noteEffect(target.triggers.get(note.triggerId), note)
    const self = note.kind === 'cue' && note.characterIds[0] !== undefined ? target.characters.list().find(entry => entry.id === note.characterIds[0]) : undefined
    const who = self === undefined ? undefined : characterKey(self)
    if (effect?.while !== undefined && !conditionHolds(target, who === undefined ? effect.while : bindSelf(effect.while, who), clock)) {
      delivery.withdrawn.push({ note, reason: 'what it was waiting on no longer holds' })
      continue
    }
    try {
      delivery.shown.push({ note, text: renderWords(target, note.text, clock, who) })
    } catch (error) {
      if (!(error instanceof UnwritableError)) throw error
      delivery.withdrawn.push({ note, reason: error.message })
    }
  }
  return delivery
}
