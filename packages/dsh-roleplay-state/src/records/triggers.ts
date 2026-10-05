import { type Trigger, type TriggerNote } from 'dsh-roleplay-model'
import { InvalidEditError } from '../errors.ts'
import { applyRecordsEdit } from './edit.ts'
import { characterKey, locationKey, type RecordsTarget } from './edit-types.ts'
import { audienceIds, conditionHolds, seededRoll, type TriggerClock, type Wire } from './trigger-rules.ts'
import { parseInstant } from './time.ts'
import { parseRecordsEdit } from './wire.ts'

const isObject = (value: unknown): value is Wire => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface FiredTrigger {
  trigger: Trigger
  /** What the game master is to weave in. */
  beats: string[]
  /** What characters are to notice. */
  cues: { characters: string[]; text: string }[]
  /** The texts of the events an edit effect wrote. */
  events: string[]
}

export interface TriggerRun {
  fired: FiredTrigger[]
  /** The triggers whose effects could not be applied: they are not tried again. */
  failed: { trigger: Trigger; problem: string }[]
}

export interface TriggerRunOptions extends TriggerClock {
  turn: number
  round: number
  /** The most that fire in one run; the rest wait for the next. */
  maxFires?: number
}

const DEFAULT_MAX_FIRES = 3

/** An edit effect, as it is applied at this turn and round: events default to now and to what those in their place saw. */
function editOf(target: RecordsTarget, raw: Wire, options: TriggerRunOptions) {
  const events = Array.isArray(raw['events']) ? raw['events'].filter(isObject).map((event) => {
    const where = typeof event['location'] === 'string' ? target.locations.list().find(entry => locationKey(entry) === event['location'])?.id : undefined
    if (event['perceived_by'] === 'everyone') return { turn: options.turn, round: options.round, importance: 3, tags: [], involves: [], ...event, perceived_by: target.characters.list().map(entry => ({ character: characterKey(entry), mode: 'told' })) }
    const present = where === undefined ? [] : target.characters.list().filter(entry => target.placements.get('character', entry.id)?.locationId === where).map(entry => ({ character: characterKey(entry), mode: 'witnessed' }))
    return { turn: options.turn, round: options.round, importance: 3, tags: [], involves: [], ...(present.length === 0 ? {} : { perceived_by: present }), ...event }
  }) : undefined
  return parseRecordsEdit({ ...raw, turn: options.turn, time_zone: options.zone, ...(events === undefined ? {} : { events }) })
}

function applyEffects(target: RecordsTarget, trigger: Trigger, options: TriggerRunOptions): FiredTrigger {
  const fired: FiredTrigger = { trigger, beats: [], cues: [], events: [] }
  for (const effect of trigger.effects) {
    if (effect.type === 'edit') {
      const edit = editOf(target, effect.edit, options)
      const result = applyRecordsEdit(target, edit)
      target.events.seal(result.eventIds)
      fired.events.push(...(edit.events ?? []).map(event => event.text))
    } else if (effect.type === 'beat') {
      target.triggers.addNote({ triggerId: trigger.id, kind: 'beat', text: effect.text, turn: options.turn })
      fired.beats.push(effect.text)
    } else {
      const heard = audienceIds(target, effect.audience)
      for (const id of heard) target.triggers.addNote({ triggerId: trigger.id, kind: 'cue', text: effect.text, characterIds: [id], turn: options.turn })
      fired.cues.push({ characters: target.characters.list().filter(entry => heard.includes(entry.id)).map(characterKey), text: effect.text })
    }
  }
  return fired
}

/**
 * Look at every trigger that can still fire and fire those whose condition has just become true (not those that stay true), by priority.
 * A trigger that fires once stays fired; one that repeats fires again after its condition went false and true, and its cooldown passed. The
 * effects of one trigger are applied together or not at all; one that cannot be applied is marked failed and not tried again.
 */
export function runTriggers(target: RecordsTarget, options: TriggerRunOptions): TriggerRun {
  const run: TriggerRun = { fired: [], failed: [] }
  const limit = options.maxFires ?? DEFAULT_MAX_FIRES
  for (const trigger of target.triggers.list()) {
    if (trigger.status === 'failed' || trigger.status === 'expired' || (trigger.status === 'fired' && !trigger.repeat)) continue
    if (trigger.expires !== undefined && options.now >= parseInstant(trigger.expires, options.zone)) { target.triggers.update(trigger.id, { status: 'expired' }); continue }
    const result = conditionHolds(target, trigger.condition, options)
    const rose = result && !trigger.lastResult
    if (!rose) {
      if (result !== trigger.lastResult) target.triggers.update(trigger.id, { lastResult: result })
      continue
    }
    if (run.fired.length >= limit) continue
    const cooling = trigger.cooldownSeconds !== undefined && trigger.lastFiredMs !== undefined && options.now - trigger.lastFiredMs < trigger.cooldownSeconds * 1000
    const lucky = trigger.chance === undefined || seededRoll(`${trigger.key}:${options.turn}:${options.round}:${trigger.fireCount}`) < trigger.chance
    if (cooling || !lucky) { target.triggers.update(trigger.id, { lastResult: true }); continue }
    try {
      const fired = target.transaction(() => {
        const effects = applyEffects(target, trigger, options)
        effects.trigger = target.triggers.update(trigger.id, { status: trigger.repeat ? 'dormant' : 'fired', fireCount: trigger.fireCount + 1, lastFiredMs: options.now, lastResult: true })
        return effects
      })
      run.fired.push(fired)
    } catch (error) {
      const problem = error instanceof InvalidEditError ? error.problems.join('; ') : error instanceof Error ? error.message : String(error)
      run.failed.push({ trigger: target.triggers.update(trigger.id, { status: 'failed', lastResult: true, problem }), problem })
    }
  }
  return run
}

/** Notes nobody took up in this many turns are let go: a beat the game master never wove in, a cue nobody acted on. */
export function lapseNotes(target: RecordsTarget, turn: number, kept: { beats: number; cues: number }): TriggerNote[] {
  const lapsed = target.triggers.notes({ status: 'pending' }).filter(note => turn - note.turn >= (note.kind === 'beat' ? kept.beats : kept.cues))
  for (const note of lapsed) target.triggers.resolveNote(note.id, 'lapsed')
  return lapsed
}
