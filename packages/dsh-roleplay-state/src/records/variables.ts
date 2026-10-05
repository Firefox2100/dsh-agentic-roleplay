import type { VariableDefinition, VariableSubject, VariableValue } from 'dsh-roleplay-model'
import { InvalidEditError } from '../errors.ts'
import type { CharacterRepository, ItemRepository, LocationRepository, VariableRepository } from '../repositories.ts'
import { valueIssue } from '../sqlite/variable-repository.ts'
import { characterKey, locationKey } from './edit-types.ts'
import { itemKey } from './items.ts'

export interface VariableContext {
  variables: VariableRepository
  characters: Pick<CharacterRepository, 'list'>
  items: Pick<ItemRepository, 'list'>
  locations: Pick<LocationRepository, 'list'>
}

/** A change to what the story tracks, as the game master and the keeper write it. Exactly one of `to`, `by` and `baseline`. */
export interface VariableChangeSpec {
  variable: string
  /** The key of the character, item or place; `world` for a variable of the whole story. */
  subject: string
  /** The value it becomes. */
  to?: VariableValue
  /** How much a number goes up (or down, when negative); it stops at its bounds. */
  by?: number
  /** For a variable with a baseline: the new baseline (temperament). */
  baseline?: VariableValue
}

export interface VariableEffect {
  variable: VariableDefinition
  subjectName: string
  from: VariableValue
  to: VariableValue
}

export type VariablePlan = { ok: true; effect: VariableEffect; subjectId: number; change: { value?: VariableValue; baseline?: VariableValue } } | { ok: false; problems: string[] }

/** The subject a key names, for a kind of subject. */
export function subjectOf(context: VariableContext, kind: VariableSubject, key: string): { id: number; name: string } | undefined {
  if (kind === 'world') return key === 'world' ? { id: 0, name: 'the world' } : undefined
  if (kind === 'character') {
    const found = context.characters.list().find(character => characterKey(character) === key)
    return found === undefined ? undefined : { id: found.id, name: found.name }
  }
  if (kind === 'item') {
    const found = context.items.list().find(item => itemKey(item) === key)
    return found === undefined ? undefined : { id: found.id, name: found.name }
  }
  const found = context.locations.list().find(place => locationKey(place) === key)
  return found === undefined ? undefined : { id: found.id, name: found.name }
}

/** A number as it is told: short, without trailing zeros. */
const shortNumber = (value: number): string => String(Math.round(value * 100) / 100)

/** A value in words: a number by its band when the variable has bands (and the number), yes or no, or the word. */
export function describeValue(def: Pick<VariableDefinition, 'kind' | 'bands'>, value: VariableValue): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  const band = def.bands.find(candidate => value <= candidate.upTo) ?? def.bands.at(-1)
  return band === undefined ? shortNumber(value) : `${band.label} (${shortNumber(value)})`
}

/** Whether a change can be made, and what it would come to. Nothing is changed. */
export function planVariableChange(context: VariableContext, spec: VariableChangeSpec): VariablePlan {
  const def = context.variables.def(spec.variable)
  if (def === undefined) return { ok: false, problems: [`there is no variable "${spec.variable}" (list_variables shows them)`] }
  const given = [spec.to, spec.by, spec.baseline].filter(value => value !== undefined).length
  if (given !== 1) return { ok: false, problems: [`${def.key}: give exactly one of to, by and baseline`] }
  const subject = subjectOf(context, def.subject, spec.subject)
  if (subject === undefined) return { ok: false, problems: [`${def.key}: there is no ${def.subject === 'world' ? 'world: use "world"' : `${def.subject} "${spec.subject}"`}`] }
  if (!context.variables.applies(def, def.subject, subject.id)) return { ok: false, problems: [`${def.key} does not apply to ${subject.name} (it applies to: ${def.only.join(', ')})`] }
  const from = context.variables.value(def.key, def.subject, subject.id)
  if (spec.baseline !== undefined) {
    const issue = def.baseline ? valueIssue(def, spec.baseline) : `${def.key} has no baseline`
    return issue === undefined ? { ok: true, subjectId: subject.id, change: { baseline: spec.baseline }, effect: { variable: def, subjectName: subject.name, from, to: from } } : { ok: false, problems: [`${def.key}: ${issue}`] }
  }
  let to: VariableValue
  if (spec.by !== undefined) {
    if (def.kind !== 'number' || typeof from !== 'number') return { ok: false, problems: [`${def.key}: only a number goes up or down by an amount; use to`] }
    if (!Number.isFinite(spec.by)) return { ok: false, problems: [`${def.key}: by is a number`] }
    const moved = from + spec.by
    const bounded = Math.min(def.max ?? moved, Math.max(def.min ?? moved, moved))
    to = def.integer ? Math.round(bounded) : bounded
  } else {
    to = spec.to!
    const issue = valueIssue(def, to)
    if (issue !== undefined) return { ok: false, problems: [`${def.key}: ${issue}`] }
  }
  return { ok: true, subjectId: subject.id, change: { value: to }, effect: { variable: def, subjectName: subject.name, from, to } }
}

/**
 * Change a variable now.
 * @throws {InvalidEditError} naming every reason it cannot be done.
 */
export function changeVariable(context: VariableContext, spec: VariableChangeSpec, turn: number): VariableEffect {
  const planned = planVariableChange(context, spec)
  if (!planned.ok) throw new InvalidEditError(planned.problems)
  context.variables.set(planned.effect.variable.key, planned.effect.variable.subject, planned.subjectId, planned.change, turn)
  return planned.effect
}

/** Who is reading values: the game master and the keeper see everything, a character sees what is public and what is private to it, anyone else only what is public. */
export type VariableAudience = 'story' | 'self' | 'others'

export interface ShownVariable {
  variable: VariableDefinition
  value: VariableValue
  baseline?: VariableValue
}

/** At most this many variables are told for one subject. */
export const MAX_SHOWN = 8

/** The variables of a subject that are worth telling, in the order they were declared: those whose value is not the default, and those always told. */
export function shownVariables(context: VariableContext, kind: VariableSubject, subjectId: number, subjectKey: string, audience: VariableAudience): ShownVariable[] {
  const stored = new Map(context.variables.list(kind, subjectId).map(entry => [entry.variable, entry]))
  return context.variables.defs().flatMap((def): ShownVariable[] => {
    if (def.subject !== kind || !(def.only.length === 0 || def.only.includes(subjectKey))) return []
    if (audience === 'others' ? def.visibility !== 'public' : audience === 'self' ? def.visibility === 'hidden' : false) return []
    const entry = stored.get(def.key)
    const value = entry?.value ?? def.default
    if (value === def.default && !def.always) return []
    return [{ variable: def, value, ...(entry?.baseline === undefined ? {} : { baseline: entry.baseline }) }]
  }).slice(0, MAX_SHOWN)
}
