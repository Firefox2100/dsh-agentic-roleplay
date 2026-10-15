import type { Comparison, TriggerAudience, TriggerCondition, TriggerEffect } from 'dsh-roleplay-model'
import type { WorldState } from '../../shared/world-state.ts'
import type { TriggersLocaleKey } from './triggers-locales.ts'

type Say = (key: TriggersLocaleKey, values?: Record<string, string | number>) => string

/** What a key stands for, by its name in this world; the key itself when the world has no such thing. */
export interface Names {
  character: (key: string) => string
  place: (key: string) => string
  item: (key: string) => string
  trigger: (key: string) => string
}

export function namesOf(world: Pick<WorldState, 'characters' | 'places' | 'things' | 'triggers'>): Names {
  const by = <T extends { key: string; name: string }>(list: readonly T[] | undefined) => { const names = new Map((list ?? []).map(entry => [entry.key, entry.name])); return (key: string): string => (key === '@self' ? key : names.get(key) ?? key) }
  return { character: by(world.characters), place: by(world.places), item: by(world.things), trigger: by(world.triggers) }
}

const OPS: Record<Comparison, TriggersLocaleKey> = { eq: 'opEq', ne: 'opNe', lt: 'opLt', le: 'opLe', gt: 'opGt', ge: 'opGe' }

/** A condition in a sentence. */
export function describeCondition(say: Say, names: Names, condition: TriggerCondition): string {
  switch (condition.type) {
    case 'time': return [
      ...(condition.from === undefined ? [] : [say('timeFrom', { at: condition.from.replace('T', ' ') })]),
      ...(condition.to === undefined ? [] : [say('timeTo', { at: condition.to.replace('T', ' ') })]),
      ...(condition.window === undefined ? [] : [say('timeWindow', { from: condition.window.from, to: condition.window.to })]),
      ...(condition.days === undefined || condition.days.length === 0 ? [] : [say('timeDays', { days: condition.days.join(', ') })]),
    ].join(', ')
    case 'place': return condition.feature === undefined ? say('place', { who: names.character(condition.character), where: names.place(condition.location) }) : say('placeAt', { who: names.character(condition.character), where: names.place(condition.location), feature: condition.feature })
    case 'variable': return condition.subject === undefined
      ? say('variable', { name: condition.variable, op: say(OPS[condition.op]), value: String(condition.value) })
      : say('variableOf', { name: condition.variable, subject: names.character(condition.subject), op: say(OPS[condition.op]), value: String(condition.value) })
    case 'item': return condition.heldBy !== undefined ? say('heldBy', { item: names.item(condition.item), who: names.character(condition.heldBy) }) : say('lyingIn', { item: names.item(condition.item), where: names.place(condition.at ?? '') })
    case 'event': return say('event', { tag: condition.tag })
    case 'fired': return say('firedTrigger', { trigger: names.trigger(condition.trigger) })
    case 'judged': return say('judged', { text: condition.text })
    case 'all': return say('all', { parts: condition.conditions.map(part => describeCondition(say, names, part)).join('; ') })
    case 'any': return say('any', { parts: condition.conditions.map(part => describeCondition(say, names, part)).join('; ') })
    case 'not': return say('not', { part: describeCondition(say, names, condition.condition) })
  }
}

function describeAudience(say: Say, names: Names, audience: TriggerAudience): string {
  if (audience === 'everyone') return say('everyone')
  if ('place' in audience) return say('whoeverIn', { where: names.place(audience.place) })
  return audience.characters.map(names.character).join(', ')
}

/** An effect in a sentence, with what a beat or cue waits on. */
export function describeEffect(say: Say, names: Names, effect: TriggerEffect): string {
  if (effect.type === 'edit') return say('edit', { events: Array.isArray(effect.edit['events']) ? effect.edit['events'].length : 0 })
  const text = effect.type === 'beat' ? say('beat', { text: effect.text }) : say('cue', { audience: describeAudience(say, names, effect.audience), text: effect.text })
  return effect.while === undefined ? text : `${text} (${say('only', { condition: describeCondition(say, names, effect.while) })})`
}
