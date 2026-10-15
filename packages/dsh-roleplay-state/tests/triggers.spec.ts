import { beforeEach, describe, expect, it } from 'vitest'
import { InvalidEditError, announcements, judgedStatements, audienceIds, inAudience, parseRecordsEdit, readTriggerDefinition, recordsEditSchema, seededRoll, type SessionStore, type TriggerDefinition } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

let store: SessionStore
const NOON = Date.UTC(1912, 9, 5, 12)
const run = (turn: number, now = NOON, extra: { round?: number; maxFires?: number } = {}) => store.runTriggers({ turn, round: extra.round ?? 1, now, zone: 'UTC', ...(extra.maxFires === undefined ? {} : { maxFires: extra.maxFires }) })
const define = (extra: Partial<TriggerDefinition> & Pick<TriggerDefinition, 'key' | 'condition'>): void => {
  store.triggers.add({ name: extra.key, effects: [{ type: 'beat', text: `${extra.key} fires` }], repeat: false, priority: 0, ...extra }, 'world', 0)
}
const alice = () => store.characters.getBySourceId('alice')!.id

beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
  store.edit({ turn: 1, places: [{ key: 'bar', name: 'The Bar' }, { key: 'cellar', name: 'The Cellar' }], items: [{ key: 'key', name: 'Brass key', at: { location: 'bar' } }] })
  store.placements.place('character', alice(), { locationId: store.locations.getBySourceId('bar')!.id })
})

describe('reading a trigger', () => {
  const good = { key: 'storm', name: 'The storm', when: { type: 'time', from: '1912-10-05T21:00' }, effects: [{ type: 'beat', text: 'Thunder.' }] }

  it('takes the file format, with defaults for what is left out', () => {
    expect(readTriggerDefinition(good, 'triggers[0]')).toEqual({ definition: { key: 'storm', name: 'The storm', condition: { type: 'time', from: '1912-10-05T21:00' }, effects: [{ type: 'beat', text: 'Thunder.' }], repeat: false, priority: 0 } })
    const full = readTriggerDefinition({ ...good, repeat: true, cooldown_seconds: 3600, chance: 0.5, priority: 2, expires: '1912-10-07T00:00' }, 't')
    expect(full).toMatchObject({ definition: { repeat: true, cooldownSeconds: 3600, chance: 0.5, priority: 2, expires: '1912-10-07T00:00' } })
  })

  it('tells every problem with where it is', () => {
    const result = readTriggerDefinition({ key: '', when: { type: 'all', conditions: [{ type: 'place', character: 'alice' }, { type: 'variable', variable: 'x', op: 'near', value: [] }, { type: 'item', item: 'key' }] }, effects: [{ type: 'cue', text: 'x' }, { type: 'poke' }], chance: 2 }, 'triggers[3]')
    expect('problems' in result && result.problems).toEqual(expect.arrayContaining([
      'triggers[3].key: required text', 'triggers[3].name: required text',
      'triggers[3].when.conditions[0].location: required text', 'triggers[3].when.conditions[1].op: one of eq, ne, lt, le, gt, ge',
      'triggers[3].when.conditions[2]: give exactly one of held_by and at', 'triggers[3].effects[0].characters: "everyone", {"characters": [the characters]} or {"place": the place}',
      'triggers[3].effects[1].type: one of edit, beat, cue', 'triggers[3].chance: from 0 to 1',
    ]))
  })

  it('refuses a condition that is too big, and an edit effect that is not an edit', () => {
    let deep: unknown = { type: 'event', tag: 'x' }
    for (let i = 0; i < 6; i++) deep = { type: 'not', condition: deep }
    expect(readTriggerDefinition({ ...good, when: deep }, 't')).toMatchObject({ problems: [expect.stringMatching(/nest at most 4 deep/)] })
    expect(readTriggerDefinition({ ...good, effects: [{ type: 'edit', edit: { events: 'no' } }] }, 't')).toMatchObject({ problems: [expect.stringMatching(/effects\[0\]\.edit: events must be a list/)] })
  })
})

describe('the conditions', () => {
  const fires = (key: string, now = NOON): boolean => run(1, now).fired.some(entry => entry.trigger.key === key)

  it('time: after from, before to, in a window past midnight, on days', () => {
    define({ key: 'later', condition: { type: 'time', from: '1912-10-05T13:00' } })
    define({ key: 'earlier', condition: { type: 'time', to: '1912-10-05T11:00' } })
    define({ key: 'night', condition: { type: 'time', window: { from: '22:00', to: '06:00' } } })
    define({ key: 'saturday', condition: { type: 'time', days: ['sat'] } })
    expect(run(1).fired.map(entry => entry.trigger.key)).toEqual(['saturday'])
    expect(fires('later', Date.UTC(1912, 9, 5, 13, 30))).toBe(true)
    expect(fires('night', Date.UTC(1912, 9, 5, 23))).toBe(true)
  })

  it('judged: false until a model has judged the statement true, and only then, on the rise, once', () => {
    const verdicts = new Set<string>()
    const look = (turn: number) => store.runTriggers({ turn, round: 1, now: NOON, zone: 'UTC', judged: statement => verdicts.has(statement) }).fired.map(entry => entry.trigger.key)
    define({ key: 'distrust', condition: { type: 'all', conditions: [{ type: 'judged', text: 'The mayor has lost the town\'s trust.' }, { type: 'not', condition: { type: 'judged', text: 'The mayor has resigned.' } }] } })
    expect(look(1)).toEqual([])
    verdicts.add('The mayor has lost the town\'s trust.')
    expect(look(2)).toEqual(['distrust'])
    expect(look(3)).toEqual([])
    verdicts.add('The mayor has resigned.')
    expect(look(4)).toEqual([])
  })

  it('judged statements are read from a file, listed once in order, and must be given', () => {
    const read = readTriggerDefinition({ key: 'j', name: 'J', when: { type: 'any', conditions: [{ type: 'judged', text: 'A' }, { type: 'all', conditions: [{ type: 'judged', text: 'B' }, { type: 'judged', text: 'A' }, { type: 'event', tag: 'x' }] }] }, effects: [{ type: 'beat', text: 'x' }] }, 't')
    expect('definition' in read && judgedStatements(read.definition.condition)).toEqual(['A', 'B'])
    expect(readTriggerDefinition({ key: 'j', name: 'J', when: { type: 'judged' }, effects: [{ type: 'beat', text: 'x' }] }, 't')).toMatchObject({ problems: ['t.when.text: required text'] })
  })

  it('place, variable and item', () => {
    store.variables.define({ key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world' })
    store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, default: 10 })
    define({ key: 'in-cellar', condition: { type: 'place', character: 'alice', location: 'cellar' } })
    define({ key: 'in-bar', condition: { type: 'place', character: 'alice', location: 'bar' } })
    define({ key: 'hurt', condition: { type: 'variable', variable: 'health', subject: 'alice', op: 'lt', value: 5 } })
    define({ key: 'alarmed', condition: { type: 'variable', variable: 'alarm', op: 'eq', value: true } })
    define({ key: 'has-key', condition: { type: 'item', item: 'key', heldBy: 'alice' } })
    define({ key: 'key-in-bar', condition: { type: 'item', item: 'key', at: 'bar' } })
    expect(run(1).fired.map(entry => entry.trigger.key).sort()).toEqual(['in-bar', 'key-in-bar'])
    store.variables.set('health', 'character', alice(), { value: 2 }, 2)
    store.variables.set('alarm', 'world', 0, { value: true }, 2)
    store.items.place(store.items.getBySourceId('key')!.id, { kind: 'character', characterId: alice(), mode: 'held' })
    expect(run(2).fired.map(entry => entry.trigger.key).sort()).toEqual(['alarmed', 'has-key', 'hurt'])
  })

  it('event by tag, fired, and all, any and not', () => {
    define({ key: 'first', condition: { type: 'event', tag: 'theft' } })
    define({ key: 'second', condition: { type: 'fired', trigger: 'first' } })
    define({ key: 'combo', condition: { type: 'all', conditions: [{ type: 'event', tag: 'theft' }, { type: 'not', condition: { type: 'place', character: 'alice', location: 'cellar' } }, { type: 'any', conditions: [{ type: 'event', tag: 'nothing' }, { type: 'time', from: '1912-10-01T00:00' }] }] } })
    expect(run(1).fired).toEqual([])
    store.edit({ turn: 2, events: [{ turn: 2, round: 1, text: 'The key was stolen.', importance: 3, tags: ['theft'], involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
    expect(run(2).fired.map(entry => entry.trigger.key)).toEqual(['first', 'second', 'combo'])
    expect(run(3).fired).toEqual([])
  })
})

describe('firing', () => {
  it('fires once, when the condition turns true, and not while it stays true', () => {
    define({ key: 'storm', condition: { type: 'time', from: '1912-10-05T13:00' } })
    expect(run(1).fired).toEqual([])
    expect(run(2, Date.UTC(1912, 9, 5, 14)).fired.map(entry => entry.trigger.key)).toEqual(['storm'])
    expect(run(3, Date.UTC(1912, 9, 5, 15)).fired).toEqual([])
    expect(store.triggers.getByKey('storm')).toMatchObject({ status: 'fired', fireCount: 1, lastFiredMs: Date.UTC(1912, 9, 5, 14) })
  })

  it('fires at once when the condition is already true the first time it is looked at', () => {
    define({ key: 'now', condition: { type: 'time', from: '1912-10-01T00:00' } })
    expect(run(1).fired.map(entry => entry.trigger.key)).toEqual(['now'])
  })

  it('repeats after the condition went false and true again, and not before the cooldown has passed', () => {
    define({ key: 'bell', condition: { type: 'time', window: { from: '12:00', to: '13:00' } }, repeat: true, cooldownSeconds: 36 * 3600 })
    const at = (day: number, hour: number): number => Date.UTC(1912, 9, day, hour)
    expect(run(1, at(5, 12)).fired).toHaveLength(1)
    expect(run(2, at(5, 12) + 1000).fired).toEqual([])
    expect(run(3, at(5, 18)).fired).toEqual([])
    expect(run(4, at(6, 12)).fired).toEqual([])
    expect(run(5, at(6, 18)).fired).toEqual([])
    expect(run(6, at(7, 12)).fired).toHaveLength(1)
    expect(store.triggers.getByKey('bell')).toMatchObject({ status: 'dormant', fireCount: 2 })
  })

  it('rolls its chance the same way every time for the same moment, and a failed roll uses the rise up', () => {
    const lucky = Array.from({ length: 40 }, (_, i) => `t${i}`).filter(key => seededRoll(`${key}:1:1:0`) < 0.5)
    const unlucky = Array.from({ length: 40 }, (_, i) => `u${i}`).filter(key => seededRoll(`${key}:1:1:0`) >= 0.5)
    expect(lucky.length).toBeGreaterThan(0)
    expect(unlucky.length).toBeGreaterThan(0)
    for (const key of [lucky[0]!, unlucky[0]!]) define({ key, condition: { type: 'time', from: '1912-10-01T00:00' }, chance: 0.5 })
    expect(run(1).fired.map(entry => entry.trigger.key)).toEqual([lucky[0]])
    expect(run(2).fired).toEqual([])
  })

  it('goes by priority, and no more fire at once than allowed; the rest wait for the next look', () => {
    for (const [key, priority] of [['a', 1], ['b', 3], ['c', 2]] as const) define({ key, priority, condition: { type: 'time', from: '1912-10-01T00:00' } })
    expect(run(1, NOON, { maxFires: 2 }).fired.map(entry => entry.trigger.key)).toEqual(['b', 'c'])
    expect(run(2).fired.map(entry => entry.trigger.key)).toEqual(['a'])
  })

  it('never fires after it expired', () => {
    define({ key: 'late', condition: { type: 'time', from: '1912-10-01T00:00' }, expires: '1912-10-04T00:00' })
    expect(run(1).fired).toEqual([])
    expect(store.triggers.getByKey('late')?.status).toBe('expired')
  })
})

describe('what it does', () => {
  it('a beat and a cue are left to be told, and lapse when nobody takes them up', () => {
    define({ key: 'story', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'beat', text: 'A bell tolls.' }, { type: 'cue', audience: { characters: ['alice', 'bob'] }, text: 'You hear a scream upstairs.' }] })
    const [fired] = run(1).fired
    expect(fired).toMatchObject({ beats: ['A bell tolls.'], cues: [{ characters: ['alice', 'bob'], text: 'You hear a scream upstairs.' }] })
    expect(store.triggers.notes({ status: 'pending' }).map(note => [note.kind, note.text, note.characterIds.length])).toEqual([['beat', 'A bell tolls.', 0], ['cue', 'You hear a scream upstairs.', 1], ['cue', 'You hear a scream upstairs.', 1]])
    expect(store.lapseNotes(2, { beats: 3, cues: 1 }).map(note => note.kind)).toEqual(['cue', 'cue'])
    expect(store.lapseNotes(4, { beats: 3, cues: 1 }).map(note => note.kind)).toEqual(['beat'])
    expect(store.triggers.notes({ status: 'pending' })).toEqual([])
  })

  it('an edit is applied as records: events are sealed and seen by those in the place, and the rest of it takes effect', () => {
    store.variables.define({ key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world' })
    define({
      key: 'lockdown', condition: { type: 'time', from: '1912-10-01T00:00' },
      effects: [{ type: 'edit', edit: { events: [{ text: 'The lights go out in the bar.', location: 'bar', tags: ['blackout'] }], variable_changes: [{ variable: 'alarm', subject: 'world', to: true }] } }],
    })
    const [fired] = run(4, NOON, { round: 2 }).fired
    expect(fired?.events).toEqual(['The lights go out in the bar.'])
    expect(store.variables.value('alarm', 'world', 0)).toBe(true)
    const [event] = store.events.list({ turn: 4 })
    expect(event).toMatchObject({ turn: 4, round: 2, text: 'The lights go out in the bar.', importance: 3, tags: ['blackout'], sealed: true })
    expect(store.events.perceptionsOf(event!.id).map(entry => entry.characterId)).toEqual([alice()])
  })

  it('an effect that cannot be applied marks the trigger failed with the reason, undoes what it did, and is not tried again', () => {
    define({
      key: 'broken', condition: { type: 'time', from: '1912-10-01T00:00' },
      effects: [{ type: 'beat', text: 'Something.' }, { type: 'edit', edit: { moves: [{ character: 'alice', to: 'nowhere' }] } }],
    })
    const result = run(1)
    expect(result.fired).toEqual([])
    expect(result.failed).toMatchObject([{ trigger: { key: 'broken', status: 'failed' }, problem: expect.stringContaining('nowhere') }])
    expect(store.triggers.notes()).toEqual([])
    expect(run(2).failed).toEqual([])
  })
})

describe('making them in play', () => {
  const made = { key: 'ambush', name: 'The ambush', when: { type: 'place', character: 'alice', location: 'cellar' }, effects: [{ type: 'beat', text: 'Someone is waiting.' }] }

  it('is only offered to the agent whose work that is', () => {
    expect(JSON.stringify(recordsEditSchema())).not.toContain('"triggers"')
    expect(Object.keys(recordsEditSchema({ authoring: true }).properties ?? {})).toContain('triggers')
  })

  it('makes a trigger from an edit, after the things it names', () => {
    const result = store.edit({ ...parseRecordsEdit({ turn: 3, places: [{ key: 'attic', name: 'Attic' }], triggers: [{ ...made, when: { type: 'place', character: 'alice', location: 'attic' } }] }) })
    expect(result.triggerKeys).toEqual(['ambush'])
    expect(store.triggers.getByKey('ambush')).toMatchObject({ origin: 'story', createdTurn: 3, status: 'dormant' })
  })

  it('names every problem and makes nothing: unknown things, a repeated key, a trigger it waits for that is not there', () => {
    const bad = parseRecordsEdit({ turn: 3, triggers: [
      { ...made, key: 'one', when: { type: 'all', conditions: [{ type: 'place', character: 'zed', location: 'moon' }, { type: 'fired', trigger: 'ghost' }, { type: 'variable', variable: 'nope', op: 'eq', value: 1 }, { type: 'item', item: 'sword', at: 'bar' }] }, effects: [{ type: 'cue', audience: { characters: ['zed'] }, text: 'x' }] },
      { ...made, key: 'one' },
    ] })
    try {
      store.edit(bad)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEditError)
      expect((error as InvalidEditError).problems).toEqual(expect.arrayContaining([
        'one: when.conditions[0]: there is no character "zed"', 'one: when.conditions[0]: there is no place "moon"', 'one: when.conditions[1]: there is no trigger "ghost"',
        'one: when.conditions[2]: there is no variable "nope"', 'one: when.conditions[3]: there is no item "sword"', 'one: effects[0]: there is no character "zed"', 'one: made twice in this edit',
      ]))
    }
    expect(store.triggers.list()).toEqual([])
    store.edit(parseRecordsEdit({ turn: 3, triggers: [made] }))
    expect(() => store.edit(parseRecordsEdit({ turn: 4, triggers: [made] }))).toThrow(/already a trigger with this key/)
  })

  it('a trigger may wait for one made in the same edit', () => {
    store.edit(parseRecordsEdit({ turn: 3, triggers: [made, { ...made, key: 'aftermath', when: { type: 'fired', trigger: 'ambush' } }] }))
    expect(store.triggers.list().map(trigger => trigger.key).sort()).toEqual(['aftermath', 'ambush'])
  })
})

describe('what is known before it happens', () => {
  const NOW = Date.UTC(1912, 9, 5, 12)
  const known = (at = NOW) => store.triggers.list().length === 0 ? [] : announcementsOf(at)
  const announcementsOf = (now: number) => announcements(store, { now, zone: 'UTC' }).map(entry => [entry.trigger.key, entry.text, entry.at === undefined ? undefined : new Date(entry.at).toISOString().slice(0, 16)])
  const secret = { key: 'war', condition: { type: 'time' as const, from: '1912-10-20T00:00' } }

  it('is nothing for a trigger with no announcement: it is a secret until it fires', () => {
    define(secret)
    expect(known()).toEqual([])
  })

  it('is known from the start by default, with the time the condition waits for, soonest first', () => {
    define({ key: 'ball', condition: { type: 'all', conditions: [{ type: 'place', character: 'alice', location: 'bar' }, { type: 'time', from: '1912-10-12T20:00' }] }, announce: { audience: 'everyone', text: 'The Founders\' Ball is on the 12th.' } })
    define({ key: 'exam', condition: { type: 'time', from: '1912-10-08T09:00' }, announce: { audience: 'everyone', text: 'The final exam is at nine.' } })
    define({ key: 'no-time', condition: { type: 'event', tag: 'x' }, announce: { audience: 'everyone', text: 'Something will come.' } })
    expect(known()).toEqual([['exam', 'The final exam is at nine.', '1912-10-08T09:00'], ['ball', 'The Founders\' Ball is on the 12th.', '1912-10-12T20:00'], ['no-time', 'Something will come.', undefined]])
  })

  it('becomes known at the time it says, and says when it is to happen when the condition cannot', () => {
    define({ key: 'inspection', condition: { type: 'event', tag: 'inspector' }, announce: { audience: 'everyone', text: 'An inspector is expected.', from: '1912-10-07T00:00', at: '1912-10-09T10:00' } })
    expect(known(Date.UTC(1912, 9, 6))).toEqual([])
    expect(known(Date.UTC(1912, 9, 7, 1))).toEqual([['inspection', 'An inspector is expected.', '1912-10-09T10:00']])
  })

  it('is no longer told once it fired, failed or expired', () => {
    define({ key: 'soon', condition: { type: 'time', from: '1912-10-05T13:00' }, announce: { audience: 'everyone', text: 'Soon.' } })
    expect(known().length).toBe(1)
    run(1, Date.UTC(1912, 9, 5, 14))
    expect(known(Date.UTC(1912, 9, 5, 14))).toEqual([])
  })

  it('has an audience: everyone, named characters, or whoever is in a place', () => {
    const bob = store.characters.getBySourceId('bob')!.id
    expect(inAudience(store, 'everyone', bob)).toBe(true)
    expect(inAudience(store, { characters: ['alice'] }, alice())).toBe(true)
    expect(inAudience(store, { characters: ['alice'] }, bob)).toBe(false)
    expect(inAudience(store, { place: 'bar' }, alice())).toBe(true)
    expect(inAudience(store, { place: 'bar' }, bob)).toBe(false)
    store.placements.place('character', bob, { locationId: store.locations.getBySourceId('bar')!.id })
    expect(audienceIds(store, { place: 'bar' }).sort()).toEqual([alice(), bob].sort())
  })

  it('is read with its audience and times, and refused with the reason when it is not one', () => {
    const base = { key: 'ball', name: 'Ball', when: { type: 'time', from: '1912-10-12T20:00' }, effects: [{ type: 'beat', text: 'Music.' }] }
    expect(readTriggerDefinition({ ...base, announce: { audience: { place: 'bar' }, text: 'A ball.', from: '1912-10-01T00:00' } }, 't')).toMatchObject({ definition: { announce: { audience: { place: 'bar' }, text: 'A ball.', from: '1912-10-01T00:00' } } })
    const bad = readTriggerDefinition({ ...base, announce: { audience: 'nobody', from: 'soon', at: '1912-13-45T00:00' } }, 't')
    expect('problems' in bad && bad.problems).toEqual(expect.arrayContaining([expect.stringContaining('t.announce.audience'), 't.announce.text: required text of at most 500 characters', 't.announce.from: a local date and time, 1912-10-04T19:30', 't.announce.at: a local date and time, 1912-10-04T19:30']))
  })

  it('names what it names that the story does not have', () => {
    const made = parseRecordsEdit({ turn: 3, triggers: [{ key: 'ball', name: 'Ball', when: { type: 'time', from: '1912-10-12T20:00' }, effects: [{ type: 'beat', text: 'x' }], announce: { audience: { place: 'moon' }, text: 'A ball.' } }] })
    expect(() => store.edit(made)).toThrow(/ball: announce: there is no place "moon"/)
  })
})

describe('telling everyone, or those in a place', () => {
  it('a cue reaches every character who can act, or those in the place, one note each', () => {
    const bob = store.characters.getBySourceId('bob')!.id
    store.placements.place('character', bob, { locationId: store.locations.getBySourceId('cellar')!.id })
    define({ key: 'news', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'cue', audience: 'everyone', text: 'War has been declared.' }, { type: 'cue', audience: { place: 'bar' }, text: 'The bar falls silent.' }] })
    const [fired] = run(1).fired
    expect(fired?.cues).toEqual([{ characters: ['alice', 'bob'], text: 'War has been declared.' }, { characters: ['alice'], text: 'The bar falls silent.' }])
    expect(store.triggers.notes().map(note => [note.text, note.characterIds[0] === alice() ? 'alice' : 'bob'])).toEqual([['War has been declared.', 'alice'], ['War has been declared.', 'bob'], ['The bar falls silent.', 'alice']])
  })

  it('an event of an edit effect can be perceived by everyone, who are told of it', () => {
    define({ key: 'war', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'edit', edit: { events: [{ text: 'War broke out between the nations.', tags: ['war'], importance: 5, perceived_by: 'everyone' }] } }] })
    run(4)
    const [event] = store.events.list({ turn: 4 })
    expect(store.events.perceptionsOf(event!.id).map(entry => [entry.characterId, entry.mode]).sort()).toEqual([[alice(), 'told'], [store.characters.getBySourceId('bob')!.id, 'told']].sort())
  })
})

describe('a trigger looked at when a turn begins', () => {
  it('has no round yet, and the events of its edit effects belong to the first', () => {
    define({ key: 'curfew', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'edit', edit: { events: [{ text: 'A curfew was announced.', tags: ['curfew'], perceived_by: 'everyone' }] } }] })
    const result = run(5, NOON, { round: 0 })
    expect(result.failed).toEqual([])
    expect(result.fired.map(entry => entry.trigger.key)).toEqual(['curfew'])
    expect(store.events.list({ turn: 5 })[0]).toMatchObject({ text: 'A curfew was announced.', round: 1 })
  })
})

describe('an edit effect read from a file', () => {
  it('may say that everyone perceived an event, and is still checked as an edit', () => {
    const base = { key: 'war', name: 'War', when: { type: 'time', from: '1912-10-20T00:00' } }
    expect(readTriggerDefinition({ ...base, effects: [{ type: 'edit', edit: { events: [{ text: 'War broke out.', perceived_by: 'everyone' }] } }] }, 't')).toMatchObject({ definition: { key: 'war' } })
    expect(readTriggerDefinition({ ...base, effects: [{ type: 'edit', edit: { events: [{ text: 'War broke out.', perceived_by: 'nobody' }] } }] }, 't')).toMatchObject({ problems: [expect.stringContaining('perceived_by must be a list')] })
  })
})

describe('written when it is told', () => {
  const clock = { now: NOON, zone: 'UTC' }
  const cue = (text: string, extra: object = {}) => ({ type: 'cue' as const, audience: { characters: ['alice'] }, text, ...extra })
  const pending = () => store.triggers.notes({ status: 'pending' })
  const cellar = () => store.locations.getBySourceId('cellar')!.id
  const toCellar = (): void => { store.placements.place('character', alice(), { locationId: cellar() }) }

  it('keeps the words of a note as the world wrote them, and says them as the story stands when they are told', () => {
    define({ key: 'noise', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'beat', text: '{character:alice} is in {where:alice}; the key is with {holder:key} at {time}.' }] })
    run(1)
    expect(pending().map(note => note.text)).toEqual(['{character:alice} is in {where:alice}; the key is with {holder:key} at {time}.'])
    expect(store.deliverNotes(pending(), clock).shown.map(entry => entry.text)).toEqual(['Alice is in The Bar; the key is with The Bar at 12:00.'])
    store.items.place(store.items.getBySourceId('key')!.id, { kind: 'character', characterId: alice(), mode: 'held' })
    toCellar()
    store.locations.update(cellar(), { name: 'The Old Cellar' })
    expect(store.deliverNotes(pending(), { now: Date.UTC(1912, 9, 5, 19, 5), zone: 'UTC' }).shown.map(entry => entry.text)).toEqual(['Alice is in The Old Cellar; the key is with Alice at 19:05.'])
  })

  it('withdraws a cue whose condition no longer holds for the character it is said to, and says it to one it still holds for', () => {
    store.placements.place('character', store.characters.getBySourceId('bob')!.id, { locationId: store.locations.getBySourceId('bar')!.id })
    define({ key: 'smell', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [cue('You smell smoke; you are in {where:@self}.', { audience: { characters: ['alice', 'bob'] }, while: { type: 'place', character: '@self', location: 'bar' } })] })
    run(1)
    expect(pending()).toHaveLength(2)
    toCellar()
    const delivery = store.deliverNotes(pending(), clock)
    expect(delivery.shown.map(entry => [entry.note.characterIds[0] === alice(), entry.text])).toEqual([[false, 'You smell smoke; you are in The Bar.']])
    expect(delivery.withdrawn.map(entry => [entry.note.characterIds[0] === alice(), entry.reason])).toEqual([[true, 'what it was waiting on no longer holds']])
    expect(pending()).toHaveLength(2)
  })

  it('waits on what the story records as a trigger does, with not, all and variables', () => {
    store.variables.define({ key: 'alarm', name: 'Alarm', kind: 'flag', subject: 'world' })
    define({ key: 'quiet', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'beat', text: 'It is quiet.', while: { type: 'all', conditions: [{ type: 'not', condition: { type: 'variable', variable: 'alarm', op: 'eq', value: true } }, { type: 'item', item: 'key', at: 'bar' }] } }] })
    run(1)
    expect(store.deliverNotes(pending(), clock).shown).toHaveLength(1)
    store.variables.set('alarm', 'world', 0, { value: true }, 2)
    expect(store.deliverNotes(pending(), clock).withdrawn).toHaveLength(1)
  })

  it('says a variable in words, with its band, and one about a character by its key or as @self', () => {
    store.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, default: 10, visibility: 'public', bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }] })
    store.variables.set('health', 'character', alice(), { value: 2 }, 1)
    define({ key: 'look', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [cue('You feel {value:health:@self}.'), { type: 'beat', text: 'Alice is {value:health:alice}.' }] })
    run(1)
    expect(store.deliverNotes(pending(), clock).shown.map(entry => entry.text)).toEqual(['You feel hurt (2).', 'Alice is hurt (2).'])
  })

  it('withdraws what cannot be written as the story stands, with the reason, and leaves the other words alone', () => {
    define({ key: 'where', condition: { type: 'time', from: '1912-10-01T00:00' }, effects: [{ type: 'beat', text: 'Bob is in {where:bob}.' }, { type: 'beat', text: 'Plain {braces that are no placeholder} stay.' }] })
    run(1)
    const delivery = store.deliverNotes(pending(), clock)
    expect(delivery.withdrawn.map(entry => entry.reason)).toEqual(['{where:bob}: Bob is nowhere in particular'])
    expect(delivery.shown.map(entry => entry.text)).toEqual(['Plain {braces that are no placeholder} stay.'])
  })

  it('is refused when it is read: unknown placeholders, a beat that names @self, a wait on a judged statement, a wait on an edit', () => {
    const read = (effect: object) => readTriggerDefinition({ key: 'k', name: 'K', when: { type: 'event', tag: 'x' }, effects: [effect] }, 't')
    expect(read({ type: 'beat', text: 'See {plce:bar}.' })).toMatchObject({ problems: [expect.stringContaining('there is no "plce"')] })
    expect(read({ type: 'beat', text: '{value}' })).toMatchObject({ problems: [expect.stringContaining('{value:variable}')] })
    expect(read({ type: 'beat', text: '{time:now}' })).toMatchObject({ problems: [expect.stringContaining('{time} takes nothing')] })
    expect(read({ type: 'beat', text: 'Hello {where:@self}.' })).toMatchObject({ problems: [expect.stringContaining('only a cue')] })
    expect(read({ type: 'beat', text: 'x', while: { type: 'place', character: '@self', location: 'bar' } })).toMatchObject({ problems: [expect.stringContaining('only a cue')] })
    expect(read({ type: 'beat', text: 'x', while: { type: 'judged', text: 'The mayor is angry.' } })).toMatchObject({ problems: [expect.stringContaining('cannot be waited on')] })
    expect(read({ type: 'edit', edit: {}, while: { type: 'event', tag: 'x' } })).toMatchObject({ problems: [expect.stringContaining('only a beat or a cue')] })
    expect(read(cue('{where:@self}', { while: { type: 'place', character: '@self', location: 'bar' } }))).toMatchObject({ definition: { effects: [{ type: 'cue', while: { type: 'place', character: '@self', location: 'bar' } }] } })
  })

  it('is refused when it names what the story does not have, and @self is only valid in a cue', () => {
    const made = (effects: object[]) => parseRecordsEdit({ turn: 3, triggers: [{ key: 'ball', name: 'Ball', when: { type: 'time', from: '1912-10-12T20:00' }, effects }] })
    expect(() => store.edit(made([{ type: 'beat', text: 'Go to {place:moon}.' }]))).toThrow(/ball: effects\[0\]\.text: \{place:moon\}: there is no place "moon"/)
    expect(() => store.edit(made([{ type: 'beat', text: 'x', while: { type: 'place', character: 'zed', location: 'bar' } }]))).toThrow(/ball: effects\[0\]\.while: there is no character "zed"/)
    expect(() => store.edit(made([cue('{value:health}')]))).toThrow(/there is no variable "health"/)
    expect(() => store.edit(made([cue('{where:@self} {holder:key}', { while: { type: 'place', character: '@self', location: 'bar' } })]))).not.toThrow()
  })
})
