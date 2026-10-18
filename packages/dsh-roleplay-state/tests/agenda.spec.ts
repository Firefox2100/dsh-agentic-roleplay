import { beforeEach, describe, expect, it } from 'vitest'
import { DAY, HOUR, InvalidEditError, InvalidValueError, MINUTE, NotFoundError, agendaAt, nextOccurrence, occurrenceAt, rankGoals, type RoutineWindow, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter, newIntent } from './helpers.ts'

let store: SessionStore
const alice = () => store.characters.getBySourceId('alice')!.id
const bob = () => store.characters.getBySourceId('bob')!.id
const minute = (hour: number, min = 0): number => hour * 60 + min
const at = (day: number, hour: number, min = 0): number => Date.UTC(1912, 9, day, hour, min)
const window = (extra: Partial<RoutineWindow> & Pick<RoutineWindow, 'start' | 'end' | 'activity'>): RoutineWindow => ({ days: [], interruptible: true, ...extra })

beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
  store.edit({ turn: 1, places: [{ key: 'shop', name: 'The Shop' }, { key: 'home', name: 'Home' }] })
})

describe('a routine', () => {
  it('is replaced as a whole, in the order given, with where each window is', () => {
    const shop = store.locations.getBySourceId('shop')!.id
    store.routines.replace(alice(), [window({ start: minute(9), end: minute(17), activity: 'minds the shop', locationId: shop, position: 'behind the counter', interruptible: false }), window({ start: minute(17), end: minute(23), activity: 'rests' })])
    expect(store.routines.list(alice()).map(entry => [entry.start, entry.end, entry.activity, entry.locationId, entry.position ?? '', entry.interruptible])).toEqual([
      [540, 1020, 'minds the shop', shop, 'behind the counter', false], [1020, 1380, 'rests', undefined, '', true],
    ])
    store.routines.replace(alice(), [window({ start: 0, end: 60, activity: 'sleeps' })])
    expect(store.routines.list(alice())).toHaveLength(1)
    expect(store.routines.all().map(entry => entry.characterId)).toEqual([alice()])
  })

  it('has an exception for one day that takes the routine\'s place on that date only, and is replaced by another for the same date', () => {
    store.routines.replace(alice(), [window({ start: minute(9), end: minute(17), activity: 'minds the shop' })])
    const windows = () => store.routines.list(alice())
    store.edit({ turn: 1, routineExceptions: [{ character: 'alice', date: '1912-10-05', activity: 'keeps to bed with a fever', location: 'home' }] })
    expect(windows().map(entry => entry.activity)).toEqual(['keeps to bed with a fever', 'minds the shop'])
    expect(occurrenceAt(windows(), at(5, 10), 'UTC')?.window.activity).toBe('keeps to bed with a fever')
    expect(occurrenceAt(windows(), at(5, 23, 30), 'UTC')?.window.activity).toBe('keeps to bed with a fever')
    expect(occurrenceAt(windows(), at(6, 10), 'UTC')?.window.activity).toBe('minds the shop')
    store.edit({ turn: 1, routineExceptions: [{ character: 'alice', date: '1912-10-05', activity: 'goes to the doctor', from: '10:00', to: '12:00' }] })
    expect(windows().map(entry => entry.activity)).toEqual(['goes to the doctor', 'minds the shop'])
    expect(occurrenceAt(windows(), at(5, 13), 'UTC')?.window.activity).toBe('minds the shop')
  })

  it('refuses an exception without a real date or with only one end of the day, leaving the routine', () => {
    store.routines.replace(alice(), [window({ start: minute(9), end: minute(17), activity: 'minds the shop' })])
    expect(() => store.edit({ turn: 1, routineExceptions: [{ character: 'alice', date: 'tomorrow', activity: 'rests' }] })).toThrow(InvalidEditError)
    expect(() => store.edit({ turn: 1, routineExceptions: [{ character: 'alice', date: '1912-10-05', activity: 'rests', from: '10:00' }] })).toThrow(/both from and to/)
    expect(() => store.edit({ turn: 1, routineExceptions: [{ character: 'alice', date: '1912-10-05', activity: 'rests', location: 'nowhere' }] })).toThrow(InvalidEditError)
    expect(store.routines.list(alice())).toHaveLength(1)
  })

  it('refuses a window that is not one, and a character that is not there, leaving what was', () => {
    store.routines.replace(alice(), [window({ start: 0, end: 60, activity: 'sleeps' })])
    for (const bad of [window({ start: 60, end: 60, activity: 'x' }), window({ start: -1, end: 60, activity: 'x' }), window({ start: 0, end: 1440, activity: 'x' }), window({ start: 0, end: 60, activity: ' ' }), window({ days: [7], start: 0, end: 60, activity: 'x' })]) {
      expect(() => store.routines.replace(alice(), [bad])).toThrow(InvalidValueError)
    }
    expect(() => store.routines.replace(alice(), Array.from({ length: 25 }, () => window({ start: 0, end: 60, activity: 'x' })))).toThrow(/at most 24/)
    expect(() => store.routines.replace(999, [window({ start: 0, end: 60, activity: 'x' })])).toThrow(NotFoundError)
    expect(store.routines.list(alice()).map(entry => entry.activity)).toEqual(['sleeps'])
  })
})

describe('where a routine puts a character at an instant', () => {
  const windows = () => store.routines.replace(alice(), [
    window({ days: [1, 2, 3, 4, 5], start: minute(9), end: minute(17), activity: 'works' }),
    window({ start: minute(22), end: minute(6), activity: 'sleeps' }),
    window({ start: minute(17), end: minute(22), activity: 'is at leisure' }),
  ])

  it('is the first window of the list that holds, on a day it applies to', () => {
    const list = windows()
    expect(occurrenceAt(list, at(4, 10), 'UTC')?.window.activity).toBe('works')
    expect(occurrenceAt(list, at(7, 10), 'UTC')?.window.activity).toBe('works')
    expect(occurrenceAt(list, at(4, 17), 'UTC')?.window.activity).toBe('is at leisure')
    expect(occurrenceAt(list, at(5, 5), 'UTC')?.window.activity).toBe('sleeps')
  })

  it('knows the days of the week: 4 October 1912 was a Friday, and the weekend has no work', () => {
    const list = windows()
    expect(occurrenceAt(list, at(4, 10), 'UTC')?.window.activity).toBe('works')
    expect(occurrenceAt(list, at(5, 10), 'UTC')).toBeUndefined()
    expect(occurrenceAt(list, at(6, 10), 'UTC')).toBeUndefined()
    expect(occurrenceAt(list, at(7, 10), 'UTC')?.window.activity).toBe('works')
  })

  it('holds past midnight, from the day the window started, with the stretch of that occurrence', () => {
    const list = windows()
    const night = occurrenceAt(list, at(5, 2), 'UTC')!
    expect(night.window.activity).toBe('sleeps')
    expect([night.startsAt, night.endsAt]).toEqual([at(4, 22), at(5, 6)])
    expect(occurrenceAt(list, at(5, 23), 'UTC')?.startsAt).toBe(at(5, 22))
  })

  it('is read by the wall clock of the zone', () => {
    const list = windows()
    expect(occurrenceAt(list, at(4, 3), 'Asia/Shanghai')?.window.activity).toBe('works')
    expect(occurrenceAt(list, at(4, 3), 'UTC')?.window.activity).toBe('sleeps')
  })

  it('is nothing when no window holds', () => {
    store.routines.replace(alice(), [window({ start: minute(9), end: minute(10), activity: 'x' })])
    expect(occurrenceAt(store.routines.list(alice()), at(4, 12), 'UTC')).toBeUndefined()
    expect(occurrenceAt([], at(4, 12), 'UTC')).toBeUndefined()
  })

  it('tells what comes next within a horizon, the earliest start after now', () => {
    const list = windows()
    const next = nextOccurrence(list, at(4, 10), 'UTC', 12 * HOUR)!
    expect([next.window.activity, next.startsAt]).toEqual(['is at leisure', at(4, 17)])
    expect(nextOccurrence(list, at(4, 10), 'UTC', 2 * HOUR)).toBeUndefined()
    expect(nextOccurrence(list, at(4, 23), 'UTC', 12 * HOUR)).toBeUndefined()
    expect(nextOccurrence(list, at(4, 23), 'UTC', 2 * DAY)).toMatchObject({ startsAt: at(5, 17), window: { activity: 'is at leisure' } })
  })
})

describe('what a character is after', () => {
  const goal = (extra: Parameters<typeof newIntent>[0] = {}) => newIntent({ deadline: undefined, ...extra })

  beforeEach(() => {
    store.intents.add(alice(), goal({ name: 'Calm', priority: 0.2, urgency: 0.2 }))
    store.intents.add(alice(), goal({ name: 'Hide the ledger', priority: 0.6, urgency: 0.6 }))
    store.intents.add(alice(), goal({ name: 'Old news', status: 'completed', priority: 1, urgency: 1 }))
    store.intents.add(alice(), goal({ name: 'Sleeping on it', status: 'paused', priority: 1, urgency: 1 }))
    store.intents.add(alice(), goal({ name: 'Pay the rent', priority: 0.3, urgency: 0.3, deadline: '1912-10-04T20:00:00Z' }))
  })

  it('is the active ones, the most pressing first; a deadline near makes a goal more pressing, one past most of all', () => {
    const now = at(4, 12)
    expect(rankGoals(store.intents.list(alice()), now, 'UTC', 10).map(entry => entry.intent.name)).toEqual(['Hide the ledger', 'Pay the rent', 'Calm'])
    const late = rankGoals(store.intents.list(alice()), at(4, 21), 'UTC', 10)
    expect(late[0]).toMatchObject({ overdue: true, deadlineAt: at(4, 20) })
    expect(late[0]?.intent.name).toBe('Pay the rent')
  })

  it('is cut to what was asked for, and a deadline that is not a date does not count', () => {
    store.intents.add(alice(), goal({ name: 'Vague', priority: 0.9, urgency: 0.9, deadline: 'one day' }))
    const ranked = rankGoals(store.intents.list(alice()), at(4, 12), 'UTC', 2)
    expect(ranked.map(entry => entry.intent.name)).toEqual(['Vague', 'Hide the ledger'])
    expect(ranked[0]?.deadlineAt).toBeUndefined()
  })
})

describe('engagements', () => {
  const shop = () => store.locations.getBySourceId('shop')!.id

  it('are due at an instant, in a place, for those who committed to them, and start pending', () => {
    const meeting = store.engagements.add({ title: 'Meet Bob about the ledger', at: at(4, 21), locationId: shop(), participants: [alice(), bob(), alice()], note: 'bring the keys', turn: 2 })
    expect(meeting).toMatchObject({ title: 'Meet Bob about the ledger', at: at(4, 21), locationId: shop(), participants: [alice(), bob()].sort(), status: 'pending', note: 'bring the keys', createdTurn: 2, updatedTurn: 2 })
    expect(store.engagements.get(meeting.id)).toEqual(meeting)
  })

  it('are listed by when they are due, and by who is in them, their status and the range', () => {
    const a = store.engagements.add({ title: 'A', at: at(5, 9), participants: [alice()], turn: 1 })
    const b = store.engagements.add({ title: 'B', at: at(4, 9), participants: [bob()], turn: 1 })
    const c = store.engagements.add({ title: 'C', at: at(4, 12), participants: [alice(), bob()], turn: 1 })
    store.engagements.update(c.id, { status: 'kept', turn: 3 })
    expect(store.engagements.list().map(entry => entry.title)).toEqual(['B', 'C', 'A'])
    expect(store.engagements.list({ participant: alice() }).map(entry => entry.title)).toEqual(['C', 'A'])
    expect(store.engagements.list({ status: 'pending' }).map(entry => entry.title)).toEqual(['B', 'A'])
    expect(store.engagements.list({ from: at(4, 10), to: at(5, 0) }).map(entry => entry.title)).toEqual(['C'])
    expect([a.id, b.id].length).toBe(2)
  })

  it('are rescheduled, renamed, moved or concluded, and keep who changed them last', () => {
    const meeting = store.engagements.add({ title: 'Meet', at: at(4, 21), participants: [alice()], turn: 2 })
    const moved = store.engagements.update(meeting.id, { at: at(5, 8), until: at(5, 9), title: 'Meet early', participants: [alice(), bob()], locationId: shop(), turn: 4 })
    expect(moved).toMatchObject({ at: at(5, 8), until: at(5, 9), title: 'Meet early', locationId: shop(), createdTurn: 2, updatedTurn: 4 })
    expect(moved.participants).toEqual([alice(), bob()].sort())
    expect(store.engagements.update(meeting.id, { status: 'missed', turn: 6 }).status).toBe('missed')
    expect(() => store.engagements.update(999, { status: 'kept', turn: 1 })).toThrow(NotFoundError)
  })

  it('refuse what is not one: no title, no one in it, an end before the start, no such character or place', () => {
    expect(() => store.engagements.add({ title: ' ', at: at(4, 9), participants: [alice()], turn: 1 })).toThrow(InvalidValueError)
    expect(() => store.engagements.add({ title: 'x', at: at(4, 9), participants: [], turn: 1 })).toThrow(/at least one character/)
    expect(() => store.engagements.add({ title: 'x', at: at(4, 9), until: at(4, 8), participants: [alice()], turn: 1 })).toThrow(/cannot end before/)
    expect(() => store.engagements.add({ title: 'x', at: at(4, 9), participants: [999], turn: 1 })).toThrow(NotFoundError)
    expect(() => store.engagements.add({ title: 'x', at: at(4, 9), locationId: 999, participants: [alice()], turn: 1 })).toThrow(NotFoundError)
    expect(store.engagements.list()).toEqual([])
  })

  it('can be removed', () => {
    const meeting = store.engagements.add({ title: 'Meet', at: at(4, 21), participants: [alice(), bob()], turn: 1 })
    expect(store.engagements.remove(meeting.id)).toBe(true)
    expect(store.engagements.remove(meeting.id)).toBe(false)
  })
})

describe('an agenda', () => {
  it('is the routine now and next, what is due or overdue, and the goals', () => {
    const shop = store.locations.getBySourceId('shop')!.id
    store.routines.replace(alice(), [window({ start: minute(9), end: minute(17), activity: 'works', locationId: shop })])
    store.intents.add(alice(), newIntent({ name: 'Hide the ledger', deadline: undefined }))
    store.engagements.add({ title: 'Overdue errand', at: at(4, 10), participants: [alice()], turn: 1 })
    store.engagements.add({ title: 'Meeting', at: at(4, 13), participants: [alice()], turn: 1 })
    store.engagements.add({ title: 'Tomorrow-ish', at: at(5, 20), participants: [alice()], turn: 1 })
    store.engagements.add({ title: 'Bob\'s own', at: at(4, 13), participants: [bob()], turn: 1 })
    const agenda = agendaAt(store, alice(), at(4, 12), 'UTC')
    expect(agenda.now?.window.activity).toBe('works')
    expect(agenda.next?.startsAt).toBe(at(5, 9))
    expect(agenda.engagements.map(entry => [entry.engagement.title, entry.overdue])).toEqual([['Overdue errand', true], ['Meeting', false]])
    expect(agenda.goals.map(entry => entry.intent.name)).toEqual(['Hide the ledger'])
    expect(agendaAt(store, alice(), at(4, 12), 'UTC', { engagements: 1 }).engagements).toHaveLength(1)
    expect(agendaAt(store, alice(), at(4, 12) + 40 * MINUTE, 'UTC').engagements.find(entry => entry.engagement.title === 'Meeting')?.overdue).toBe(false)
  })

  it('is empty for a character with nothing', () => {
    expect(agendaAt(store, bob(), at(4, 12), 'UTC')).toEqual({ engagements: [], goals: [] })
  })
})

describe('writing the agenda through an edit', () => {
  const problemsOf = (edit: Parameters<SessionStore['edit']>[0]): string[] => {
    try { store.edit(edit); return [] } catch (error) { return error instanceof InvalidEditError ? [...error.problems] : (() => { throw error })() }
  }

  it('adds the goals the story gave, and moves them on', () => {
    const result = store.edit({ turn: 3, timeZone: 'Asia/Shanghai', intentsAdded: [{ character: 'alice', type: 'obligation', name: 'Return the ledger', description: 'Promised to Bob.', horizon: 'day', priority: 0.7, urgency: 0.8, plan: ['Find it', 'Take it to the shop'], deadline: '1912-10-05T18:00' }] })
    expect(result.writes).toBe(1)
    const [goal] = store.intents.list(alice())
    expect(goal).toMatchObject({ type: 'obligation', name: 'Return the ledger', status: 'active', plan: ['Find it', 'Take it to the shop'], deadline: new Date(Date.UTC(1912, 9, 5, 10)).toISOString() })
    store.edit({ turn: 4, intentEdits: [{ id: goal!.id, status: 'completed', plan: ['Done'], urgency: 0 }] })
    expect(store.intents.get(goal!.id)).toMatchObject({ status: 'completed', plan: ['Done'], urgency: 0 })
  })

  it('arranges what characters committed to, in the time zone of the story, and concludes it', () => {
    store.edit({ turn: 3, timeZone: 'Asia/Shanghai', engagements: [{ title: 'Meet at the shop', at: '1912-10-05T21:00', until: '1912-10-05T22:00', location: 'shop', participants: ['alice', 'bob'], note: 'about the ledger' }] })
    const [meeting] = store.engagements.list()
    expect(meeting).toMatchObject({ title: 'Meet at the shop', at: Date.UTC(1912, 9, 5, 13), until: Date.UTC(1912, 9, 5, 14), locationId: store.locations.getBySourceId('shop')!.id, status: 'pending', createdTurn: 3 })
    expect(store.records({ timeZone: 'Asia/Shanghai' }).engagements).toEqual([{ id: meeting!.id, title: 'Meet at the shop', at: '1912-10-05T21:00:00', until: '1912-10-05T22:00:00', location: 'shop', participants: ['alice', 'bob'], note: 'about the ledger' }])
    store.edit({ turn: 6, engagementEdits: [{ id: meeting!.id, status: 'kept' }] })
    expect(store.engagements.get(meeting!.id)).toMatchObject({ status: 'kept', updatedTurn: 6 })
    expect(store.records().engagements).toEqual([])
  })

  it('shows each character\'s live goals with the ids an edit refers to', () => {
    const live = store.intents.add(alice(), newIntent({ name: 'Live', deadline: undefined }))
    store.intents.add(alice(), newIntent({ name: 'Done', status: 'completed', deadline: undefined }))
    expect(store.records().characters.find(entry => entry.character === 'alice')?.goals.map(goal => [goal.id, goal.name])).toEqual([[live.id, 'Live']])
  })

  it('refuses what is wrong, naming each problem, and writes nothing', () => {
    expect(problemsOf({
      turn: 2,
      intentsAdded: [{ character: 'ghost', type: 'wish' as never, name: ' ', horizon: 'soon' as never, priority: 2, urgency: -1, plan: Array.from({ length: 9 }, () => 'x'), deadline: 'tomorrow' }],
      intentEdits: [{ id: 99, status: 'done' as never }, { id: 99 }],
      engagements: [{ title: '', at: 'later', location: 'nowhere', participants: [] }, { title: 'x', at: '1912-10-05T10:00', until: '1912-10-05T09:00', participants: ['alice'] }],
      engagementEdits: [{ id: 99, status: 'late' as never }],
    }).join('\n')).toMatch(/intents_added\[0\]: there is no character "ghost"[^]*unknown type "wish"[^]*unknown horizon "soon"[^]*give the goal a name[^]*priority must be a number from 0 to 1[^]*urgency must be[^]*at most 8 entries[^]*deadline: "tomorrow" is not a date[^]*intent_edits\[0\]: there is no goal 99[^]*unknown status "done"[^]*intent_edits\[1\]: there is no goal 99[^]*nothing to change[^]*engagements\[0\]: give it a title[^]*at: "later" is not a date[^]*there is no place "nowhere"[^]*say who has committed[^]*engagements\[1\]: it cannot end before it is due[^]*engagement_edits\[0\]: there is no engagement 99[^]*unknown status "late"/)
    expect(problemsOf({ turn: 2, timeZone: 'Mars/Olympus', engagements: [] })).toEqual(['time_zone: "Mars/Olympus" is not a time zone'])
    expect(store.intents.list(alice())).toEqual([])
    expect(store.engagements.list()).toEqual([])
  })

  it('sets the day of a character, with places made in the same edit, and says what is wrong with a window', () => {
    store.edit({
      turn: 2,
      places: [{ key: 'cellar', name: 'Cellar', features: [{ key: 'barrels', name: 'Barrels' }], exits: [{ to: 'shop' }] }],
      routines: [{ character: 'alice', windows: [
        { days: ['mon', 'tue'], from: '09:00', to: '17:00', activity: 'minds the shop', location: 'shop', position: 'behind the counter', interruptible: false },
        { from: '22:00', to: '06:00', activity: 'sleeps', location: 'cellar' },
      ] }],
    })
    expect(store.routines.list(alice()).map(entry => [entry.days, entry.start, entry.end, entry.activity, entry.interruptible])).toEqual([[[1, 2], 540, 1020, 'minds the shop', false], [[], 1320, 360, 'sleeps', true]])
    expect(problemsOf({ turn: 2, routines: [{ character: 'alice', windows: [
      { from: '9', to: '17:00', activity: 'x' }, { from: '09:00', to: '09:00', activity: 'x' }, { days: ['funday'], from: '09:00', to: '10:00', activity: ' ' },
      { from: '09:00', to: '10:00', activity: 'x', location: 'shop', feature: 'piano' }, { from: '09:00', to: '10:00', activity: 'x', feature: 'barrels' },
    ] }, { character: 'ghost', windows: [] }] }).join('\n')).toMatch(/windows\[0\]\.from: "9" is not a time of day[^]*windows\[1\]: it starts and ends at the same time[^]*windows\[2\]: say what the character is doing[^]*windows\[2\]\.days: "funday" is not a day[^]*windows\[3\]: The Shop has no feature "piano"[^]*windows\[4\]: a feature needs a location[^]*there is no character "ghost"/)
    expect(store.routines.list(alice())).toHaveLength(2)
  })
})
