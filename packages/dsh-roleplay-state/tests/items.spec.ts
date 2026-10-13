import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, InvalidEditError, InvalidMoveError, InvalidValueError, NotFoundError, changeItem, itemKey, lintWorld, parseRecordsEdit, planItemChange, recordsEditSchema, type ItemChangeSpec, type RecordsEdit, type SessionStore } from '../src/index.ts'
import { memoryStore, newCharacter } from './helpers.ts'

let store: SessionStore
const idOf = (key: string) => store.characters.getBySourceId(key)!.id
const item = (key: string) => store.items.getBySourceId(key)!
const problemsOf = (change: RecordsEdit): string[] => {
  try { store.edit(change) } catch (error) { if (error instanceof InvalidEditError) return [...error.problems]; throw error }
  return []
}
const planProblems = (who: string, spec: ItemChangeSpec): string[] => {
  const planned = planItemChange(store, idOf(who), spec)
  return planned.ok ? [] : planned.problems
}
const act = (who: string, spec: ItemChangeSpec) => changeItem(store, idOf(who), spec)
const holder = (key: string) => store.items.holding(item(key).id)?.holder

/**
 * Alice and Bob in the bar, Carol in the street. In the bar: a lantern on the counter, a locked chest (brass key lies in Bob's
 * hands), a coat Alice carries, forty coins in her purse (a closed satchel), a hidden letter.
 */
beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['carol', 'Carol']] as const) store.characters.add(newCharacter({ sourceId, name, aliases: [] }))
  store.edit({
    turn: 1,
    places: [{ key: 'bar', name: 'The Bar', features: [{ key: 'counter', name: 'Counter' }], exits: [{ to: 'street' }] }, { key: 'street', name: 'Street' }],
    moves: [{ character: 'alice', to: 'bar', ignoreExits: true }, { character: 'bob', to: 'bar', ignoreExits: true }, { character: 'carol', to: 'street', ignoreExits: true }],
    items: [
      { key: 'lantern', name: 'Brass lantern', description: 'Still warm.', at: { location: 'bar', feature: 'counter', position: 'by the till' } },
      { key: 'chest', name: 'Oak chest', container: { state: 'locked' }, at: { location: 'bar' } },
      { key: 'brass-key', name: 'Brass key', unique: true, heldBy: 'bob' },
      { key: 'coat', name: 'Wool coat', wearable: 'torso', heldBy: 'alice' },
      { key: 'satchel', name: 'Satchel', container: { state: 'closed' }, heldBy: 'alice' },
      { key: 'coins', name: 'Silver coin', quantity: 40, inside: 'satchel' },
      { key: 'letter', name: 'Sealed letter', hidden: true, at: { location: 'bar' } },
      { key: 'ring', name: 'Signet ring', wearable: 'fingers', unique: true, at: { location: 'street' } },
    ],
  })
  store.items.setOpeners({ kind: 'item', id: item('chest').id }, [item('brass-key').id])
})
afterEach(() => { store.close() })

describe('slots', () => {
  it('can be given to someone or to no one', () => {
    store.items.update(item('lantern').id, { ownerId: idOf('bob') })
    expect(item('lantern').ownerId).toBe(idOf('bob'))
    store.items.update(item('lantern').id, { description: 'Dented.' })
    expect(item('lantern').ownerId).toBe(idOf('bob'))
    store.items.update(item('lantern').id, { ownerId: null })
    expect(item('lantern').ownerId).toBeUndefined()
  })

  it('start as the usual ones, and a world can add its own or change how many fit', () => {
    expect(store.slots.list().map(slot => [slot.id, slot.capacity])).toEqual(expect.arrayContaining([['head', 1], ['torso', 2], ['fingers', 4]]))
    store.slots.upsert({ id: 'tail', name: 'tail', capacity: 1 })
    expect(store.slots.get('tail')).toEqual({ id: 'tail', name: 'tail', capacity: 1 })
    store.slots.upsert({ id: 'tail', name: 'tail (ringed)', capacity: 3 })
    expect(store.slots.get('tail')?.capacity).toBe(3)
    store.slots.ensureDefaults()
    expect(store.slots.get('tail')?.name).toBe('tail (ringed)')
  })

  it('refuse a bad id, name or capacity, and fewer places than are worn in it', () => {
    expect(() => store.slots.upsert({ id: 'Tail!', name: 't', capacity: 1 })).toThrow(InvalidValueError)
    expect(() => store.slots.upsert({ id: 'tail', name: ' ', capacity: 1 })).toThrow(InvalidValueError)
    expect(() => store.slots.upsert({ id: 'tail', name: 't', capacity: 0 })).toThrow(InvalidValueError)
    act('alice', { item: 'coat', action: 'wear' })
    store.items.add({ name: 'Scarf', description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false, wearableSlot: 'torso' }, { kind: 'character', characterId: idOf('alice'), mode: 'worn', slot: 'torso' })
    expect(() => store.slots.upsert({ id: 'torso', name: 'torso', capacity: 1 })).toThrow(ConflictError)
  })
})

describe('where things are', () => {
  it('starts each in exactly one place, and says where it is by following what holds it', () => {
    expect(holder('lantern')).toEqual({ kind: 'location', locationId: store.locations.getBySourceId('bar')!.id, featureKey: 'counter', position: 'by the till' })
    expect(holder('coat')).toEqual({ kind: 'character', characterId: idOf('alice'), mode: 'held' })
    expect(store.items.where(item('coins').id)).toEqual({ characterId: idOf('alice'), locationId: store.locations.getBySourceId('bar')!.id })
    expect(store.items.where(item('ring').id)).toEqual({ locationId: store.locations.getBySourceId('street')!.id })
    expect(store.items.ancestors(item('coins').id)).toEqual([item('satchel').id])
    expect(store.items.contents({ kind: 'character', id: idOf('alice') }).map(entry => itemKey(entry.item))).toEqual(['coat', 'satchel'])
    expect(store.consolidation.pending().filter(entry => entry.kind === 'item')).toHaveLength(8)
  })

  it('refuse wearing what cannot be worn or in another slot, a full slot, a thing inside itself or a non-container, and a place without the feature', () => {
    const lantern = item('lantern')
    expect(() => store.items.place(lantern.id, { kind: 'character', characterId: idOf('bob'), mode: 'worn', slot: 'torso' })).toThrow(/cannot be worn/)
    expect(() => store.items.place(item('coat').id, { kind: 'character', characterId: idOf('bob'), mode: 'worn', slot: 'head' })).toThrow(/worn on the torso, not the head/)
    expect(() => store.items.place(item('satchel').id, { kind: 'item', itemId: item('satchel').id })).toThrow(/inside itself/)
    expect(() => store.items.place(item('chest').id, { kind: 'item', itemId: item('coins').id })).toThrow(/cannot hold things/)
    expect(() => store.items.place(item('chest').id, { kind: 'item', itemId: item('satchel').id })).not.toThrow()
    expect(() => store.items.place(item('satchel').id, { kind: 'item', itemId: item('chest').id })).toThrow(/inside itself/)
    expect(() => store.items.place(lantern.id, { kind: 'location', locationId: store.locations.getBySourceId('bar')!.id, featureKey: 'piano' })).toThrow(InvalidValueError)
    expect(() => store.items.place(lantern.id, { kind: 'character', characterId: 999, mode: 'held' })).toThrow(NotFoundError)
  })

  it('lets a container be removed only when it is empty', () => {
    expect(() => store.items.remove(item('satchel').id)).toThrow(/still holds things/)
    expect(store.items.remove(item('coins').id)).toBe(true)
    expect(store.items.remove(item('satchel').id)).toBe(true)
    expect(store.items.get(item('lantern').id)).toBeDefined()
  })
})

describe('what a character can do with a thing', () => {
  it('takes what is in plain sight here, and leaves it again where it is, at a feature if it says', () => {
    act('bob', { item: 'lantern', action: 'take' })
    expect(holder('lantern')).toEqual({ kind: 'character', characterId: idOf('bob'), mode: 'held' })
    act('bob', { item: 'lantern', action: 'drop', feature: 'counter', position: 'by the taps' })
    expect(holder('lantern')).toMatchObject({ kind: 'location', featureKey: 'counter', position: 'by the taps' })
  })

  it('cannot take what is hidden, held by someone else, in a closed container, out of reach, or already its own, and says why', () => {
    expect(planProblems('alice', { item: 'letter', action: 'take' })).toEqual(['Sealed letter cannot be seen'])
    expect(planProblems('alice', { item: 'brass-key', action: 'take' })).toEqual(['Brass key is held by Bob, who has to give it'])
    expect(planProblems('bob', { item: 'coins', action: 'take' })).toEqual(['Silver coin is inside Satchel, which is closed'])
    expect(planProblems('carol', { item: 'lantern', action: 'take' })).toEqual(['Brass lantern is not here, and Carol does not have it'])
    expect(planProblems('alice', { item: 'coat', action: 'take' })).toEqual(['Alice already has Wool coat'])
    expect(planProblems('alice', { item: 'nothing', action: 'take' })).toEqual(['there is no item "nothing" (list_items shows the keys)'])
    expect(planProblems('alice', { item: 'coins', action: 'take' })).toEqual(['Silver coin is inside Satchel, which is closed'])
    store.items.place(item('coins').id, { kind: 'item', itemId: item('chest').id })
    expect(planProblems('bob', { item: 'coins', action: 'take' })).toEqual(['Silver coin is inside Oak chest, which is locked'])
  })

  it('gives to someone who is here, and not to someone elsewhere, itself, or what it does not carry', () => {
    act('alice', { item: 'coat', action: 'give', to: 'bob' })
    expect(holder('coat')).toEqual({ kind: 'character', characterId: idOf('bob'), mode: 'held' })
    expect(planProblems('alice', { item: 'satchel', action: 'give', to: 'carol' })).toEqual(['Carol is not here'])
    expect(planProblems('alice', { item: 'satchel', action: 'give', to: 'alice' })).toEqual(['Alice cannot give something to itself'])
    expect(planProblems('alice', { item: 'satchel', action: 'give' })).toEqual(['say who it is given to'])
    expect(planProblems('alice', { item: 'lantern', action: 'give', to: 'bob' })).toEqual(['Alice is not carrying Brass lantern'])
  })

  it('puts into an open container within reach, and wears and removes, one slot at a time', () => {
    expect(planProblems('alice', { item: 'coat', action: 'put', to: 'satchel' })).toEqual(['Satchel is closed: open it first'])
    act('alice', { item: 'satchel', action: 'open' })
    act('alice', { item: 'coat', action: 'put', to: 'satchel', position: 'folded' })
    expect(holder('coat')).toEqual({ kind: 'item', itemId: item('satchel').id, position: 'folded' })
    act('alice', { item: 'coat', action: 'take' })
    act('alice', { item: 'coat', action: 'wear' })
    expect(holder('coat')).toEqual({ kind: 'character', characterId: idOf('alice'), mode: 'worn', slot: 'torso' })
    expect(planProblems('alice', { item: 'coat', action: 'drop' })).toEqual(['Wool coat is worn: remove it first'])
    expect(planProblems('alice', { item: 'coat', action: 'give', to: 'bob' })).toEqual(['Wool coat is worn: remove it first'])
    act('alice', { item: 'coat', action: 'remove' })
    expect(holder('coat')).toMatchObject({ mode: 'held' })
    expect(planProblems('alice', { item: 'lantern', action: 'wear' })).toEqual(['Brass lantern cannot be worn'])
    expect(planProblems('alice', { item: 'coat', action: 'remove' })).toEqual(['Alice is not wearing Wool coat'])
  })

  it('cannot wear what is full, naming how many fit, and wears what the world gave a slot for', () => {
    for (const name of ['Vest', 'Shirt']) store.items.add({ name, description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false, wearableSlot: 'torso' }, { kind: 'character', characterId: idOf('alice'), mode: 'held' })
    act('alice', { item: 'coat', action: 'wear' })
    const vest = store.items.list().find(candidate => candidate.name === 'Vest')!
    act('alice', { item: itemKey(vest), action: 'wear' })
    const shirt = store.items.list().find(candidate => candidate.name === 'Shirt')!
    expect(() => act('alice', { item: itemKey(shirt), action: 'wear' })).toThrow(/the torso is full|full/)
  })

  it('opens and closes a container within reach, but not a locked one, and locks and unlocks with the key that fits, which has to be in hand', () => {
    expect(planProblems('alice', { item: 'chest', action: 'open' })).toEqual(['Oak chest is locked: say which key is used on Oak chest'])
    expect(planProblems('alice', { item: 'chest', action: 'unlock', with: 'brass-key' })).toEqual(['Brass key is not in hand'])
    expect(planProblems('bob', { item: 'chest', action: 'unlock', with: 'coat' })).toEqual(['Wool coat does not fit the lock of Oak chest'])
    act('bob', { item: 'chest', action: 'unlock', with: 'brass-key' })
    expect(item('chest').container?.state).toBe('closed')
    act('bob', { item: 'chest', action: 'open' })
    expect(planProblems('bob', { item: 'chest', action: 'open' })).toEqual(['Oak chest is already open'])
    expect(planProblems('bob', { item: 'chest', action: 'lock', with: 'brass-key' })).toEqual(['Oak chest is open: close it first'])
    act('bob', { item: 'chest', action: 'close' })
    act('bob', { item: 'chest', action: 'lock', with: 'brass-key' })
    expect(item('chest').container?.state).toBe('locked')
    expect(planProblems('carol', { item: 'chest', action: 'open' })[0]).toBe('Oak chest is not here, and Carol does not have it')
  })

  it('breaks a lock only when the story says so, and a lock nothing is known to fit cannot be worked otherwise', () => {
    act('alice', { item: 'chest', action: 'open', forced: true })
    expect(item('chest').container?.state).toBe('open')
    store.items.setOpeners({ kind: 'item', id: item('satchel').id }, [])
    act('alice', { item: 'satchel', action: 'open' })
    store.items.update(item('satchel').id, { container: { state: 'locked' } })
    expect(planProblems('alice', { item: 'satchel', action: 'unlock', with: 'brass-key' })).toEqual(['nothing is known to fit the lock of Satchel: if the story breaks it, say forced'])
  })

  it('locks and unlocks a way with its key, both directions, and refuses a blocked way', () => {
    store.edit({ turn: 2, itemEdits: [] })
    const bar = store.locations.getBySourceId('bar')!
    const street = store.locations.getBySourceId('street')!
    const exit = store.locations.getExit(bar.id, street.id)!
    store.items.setOpeners({ kind: 'exit', id: exit.id }, [item('brass-key').id])
    store.locations.updateExit(exit.id, { state: 'locked' })
    store.locations.updateExit(store.locations.getExit(street.id, bar.id)!.id, { state: 'locked' })
    expect(planProblems('alice', { item: 'x', action: 'unlock', exit: 'street', with: 'brass-key' })).toEqual(['Brass key is not in hand'])
    act('bob', { item: 'x', action: 'unlock', exit: 'street', with: 'brass-key' })
    expect(store.locations.getExit(bar.id, street.id)?.state).toBe('open')
    expect(store.locations.getExit(street.id, bar.id)?.state).toBe('open')
    expect(planProblems('bob', { item: 'x', action: 'unlock', exit: 'street', with: 'brass-key' })).toEqual(['the way to Street is already open'])
    store.locations.updateExit(exit.id, { state: 'blocked' })
    expect(planProblems('bob', { item: 'x', action: 'lock', exit: 'street', with: 'brass-key' })).toEqual(['the way to Street is blocked, not locked: clearing it is a matter of the story, not a key'])
    expect(planProblems('bob', { item: 'x', action: 'unlock', exit: 'nowhere' })).toEqual(['there is no place "nowhere"'])
  })

  it('finds what is hidden, only where a character is, and a thing found can be taken', () => {
    expect(planProblems('carol', { item: 'letter', action: 'reveal' })).toEqual(['Sealed letter is not here, and Carol does not have it'])
    act('alice', { item: 'letter', action: 'reveal' })
    expect(item('letter').hidden).toBe(false)
    expect(planProblems('alice', { item: 'letter', action: 'reveal' })).toEqual(['Sealed letter is not hidden'])
    act('alice', { item: 'letter', action: 'take' })
    expect(holder('letter')).toMatchObject({ kind: 'character', characterId: idOf('alice') })
  })

  it('splits off part of a pile, joins it to the same kind where it lands, and never splits one thing', () => {
    act('alice', { item: 'satchel', action: 'open' })
    act('alice', { item: 'coins', action: 'take', quantity: 15 })
    const handful = store.items.contents({ kind: 'character', id: idOf('alice') }).find(entry => entry.item.name === 'Silver coin')!.item
    expect([handful.quantity, item('coins').quantity]).toEqual([15, 25])
    act('alice', { item: 'coins', action: 'take', quantity: 5 })
    expect(store.items.get(handful.id)?.quantity).toBe(20)
    act('alice', { item: itemKey(handful), action: 'give', to: 'bob', quantity: 8 })
    act('alice', { item: itemKey(handful), action: 'give', to: 'bob', quantity: 12 })
    expect(store.items.contents({ kind: 'character', id: idOf('bob') }).filter(entry => entry.item.name === 'Silver coin').map(entry => entry.item.quantity)).toEqual([20])
    expect(store.items.get(handful.id)).toBeUndefined()
    expect(planProblems('alice', { item: 'coins', action: 'take', quantity: 99 })).toEqual(['there are only 20 Silver coin, not 99'])
    expect(planProblems('alice', { item: 'coins', action: 'take', quantity: 0 })).toEqual(['the quantity must be a whole number from 1'])
    expect(planProblems('bob', { item: 'ring', action: 'take', quantity: 1 })).toEqual(['Signet ring is not here, and Bob does not have it'])
  })

  it('reports every reason at once, and changes nothing when it cannot', () => {
    const before = JSON.stringify(store.items.list())
    expect(() => act('alice', { item: 'letter', action: 'take', quantity: 5 })).toThrow(InvalidMoveError)
    expect(planProblems('alice', { item: 'letter', action: 'fly' as never })).toEqual([expect.stringContaining('unknown action "fly"')])
    expect(JSON.stringify(store.items.list())).toBe(before)
  })
})

describe('the edit', () => {
  it('makes things, with slots of the world\'s own, put where they start, queued to be fitted in, and nameable by the rest of the edit', () => {
    const result = store.edit({
      turn: 3,
      slots: [{ id: 'quiver', name: 'quiver', capacity: 1 }],
      items: [
        { key: 'quiver', name: 'Quiver', wearable: 'quiver', wornBy: 'bob', note: 'drawn from the stable' },
        { key: 'arrows', name: 'Arrow', quantity: 12, inside: 'chest', insidePosition: 'in a bundle' },
      ],
      itemChanges: [{ character: 'bob', item: 'brass-key', action: 'unlock', with: 'brass-key' } as never].slice(0, 0),
      events: [{ turn: 3, round: 1, text: 'Bob strapped on a quiver.', importance: 2, items: ['quiver'], involves: ['bob'] }],
    })
    expect(result.itemKeys).toEqual(['quiver', 'arrows'])
    expect(holder('quiver')).toEqual({ kind: 'character', characterId: idOf('bob'), mode: 'worn', slot: 'quiver' })
    expect(holder('arrows')).toEqual({ kind: 'item', itemId: item('chest').id, position: 'in a bundle' })
    expect(store.slots.get('quiver')?.capacity).toBe(1)
    expect(store.consolidation.pending().filter(entry => entry.kind === 'item' && entry.createdTurn === 3)).toHaveLength(2)
    expect(store.events.list()[0]?.items).toEqual([item('quiver').id])
    expect(store.records().events[0]).toBeDefined()
  })

  it('refuses a thing with no place or two, a missing slot, an unknown holder, a duplicate in the same hands, and a taken key, naming each', () => {
    const problems = problemsOf({
      turn: 3,
      items: [
        { key: 'a', name: 'A' }, { key: 'b', name: 'B', at: { location: 'bar' }, heldBy: 'bob' }, { key: 'c', name: 'C', wearable: 'tail', at: { location: 'bar' } },
        { key: 'd', name: 'D', at: { location: 'moon' } }, { key: 'e', name: 'E', heldBy: 'ghost' }, { key: 'lantern', name: 'Another', at: { location: 'bar' } },
        { key: 'f', name: 'brass LANTERN', at: { location: 'bar' } }, { key: 'g', name: 'G', unique: true, quantity: 2, at: { location: 'bar' } }, { key: 'h', name: 'H', inside: 'nothing' },
        { key: 'i', name: 'I', wornBy: 'bob' }, { key: 'j', name: 'J', at: { location: 'bar' }, container: { state: 'ajar' as never } }, { key: 'k', name: 'K', quantity: 0, at: { location: 'bar' } },
      ],
    })
    const text = problems.join('\n')
    for (const expected of [/items\[0\]: say where it starts with exactly one/, /items\[1\]: say where it starts with exactly one/, /items\[2\]: there is no slot "tail"/, /items\[3\]\.at: there is no place "moon"/,
      /items\[4\]\.held_by: there is no character "ghost"/, /items\[5\]: the key "lantern" is already used/, /items\[6\]: "brass LANTERN" is already there: change its quantity/, /items\[7\]: a unique item is one thing/,
      /items\[8\]\.inside: there is no item "nothing"/, /items\[9\]: it is worn but not wearable/, /items\[10\]: unknown container state "ajar"/, /items\[11\]: the quantity must be a whole number from 1/]) {
      expect(text).toMatch(expected)
    }
    expect(store.items.list()).toHaveLength(8)
  })

  it('makes a container and what is in it in one edit, whatever the order, and refuses a circle', () => {
    store.edit({ turn: 3, items: [{ key: 'inner', name: 'Pouch', container: {}, inside: 'outer' }, { key: 'outer', name: 'Crate', container: { state: 'open' }, at: { location: 'bar' } }] })
    expect(store.items.ancestors(item('inner').id)).toEqual([item('outer').id])
    expect(item('inner').container?.state).toBe('closed')
    expect(problemsOf({ turn: 3, items: [{ key: 'x', name: 'X', container: {}, inside: 'y' }, { key: 'y', name: 'Y', container: {}, inside: 'x' }] }).join()).toMatch(/inside each other in a circle/)
  })

  it('does what characters do with things, in order, rolling the whole edit back when one cannot be done', () => {
    store.edit({ turn: 3, itemChanges: [{ character: 'bob', item: 'lantern', action: 'take' }, { character: 'bob', item: 'lantern', action: 'give', to: 'alice' }] })
    expect(holder('lantern')).toMatchObject({ kind: 'character', characterId: idOf('alice') })
    const problems = problemsOf({ turn: 3, threadsOpened: ['must not stay'], itemChanges: [{ character: 'bob', item: 'coat', action: 'take' }] })
    expect(problems).toEqual(['item_changes[0]: Wool coat is held by Alice, who has to give it'])
    expect(store.threads.list('open')).toEqual([])
    expect(problemsOf({ turn: 3, itemChanges: [{ character: 'ghost', item: 'nothing', action: 'fly' as never }] }).join('\n')).toMatch(/there is no character "ghost"[\s\S]*unknown action "fly"[\s\S]*there is no item "nothing"/)
  })

  it('changes a thing the story changed: its condition, a lock the story breaks, whose it is, what opens it', () => {
    store.edit({ turn: 3, itemEdits: [{ item: 'chest', state: 'open', quality: 'splintered', owner: 'bob', openedBy: [] }, { item: 'lantern', notable: true, description: 'Dented now.' }] })
    expect(item('chest')).toMatchObject({ quality: 'splintered', container: { state: 'open' }, ownerId: idOf('bob') })
    expect(store.items.openers({ kind: 'item', id: item('chest').id })).toEqual([])
    expect(item('lantern')).toMatchObject({ notable: true, description: 'Dented now.' })
    const problems = problemsOf({ turn: 3, itemEdits: [{ item: 'nothing' }, { item: 'lantern', state: 'open' }, { item: 'lantern', openedBy: ['coat'] }, { item: 'coat', quantity: 0 }, { item: 'coat', owner: 'ghost', openedBy: ['nothing'], description: ' ' }] })
    expect(problems.join('\n')).toMatch(/there is no item "nothing"[\s\S]*Brass lantern is not a container[\s\S]*not a container, so nothing opens it[\s\S]*quantity must be a whole number/)
  })

  it('is only offered to make things for the agent whose work it is, and reads from the wire format', () => {
    expect(Object.keys(recordsEditSchema().properties ?? {})).toEqual(expect.arrayContaining(['item_changes', 'item_edits']))
    expect(Object.keys(recordsEditSchema().properties ?? {})).not.toEqual(expect.arrayContaining(['items']))
    expect(Object.keys(recordsEditSchema({ authoring: true }).properties ?? {})).toEqual(expect.arrayContaining(['items', 'slots']))
    const parsed = parseRecordsEdit({
      turn: 4,
      slots: [{ id: 'tail', name: 'tail', capacity: 2 }],
      items: [{ key: 'ring', name: 'Ring', quantity: 2, unique: false, wearable: 'fingers', worn_by: 'bob', worn_position: 'left hand', container: { state: 'locked', opened_by: ['key'] }, at: { location: 'bar', feature: 'counter' }, inside: 'x', note: 'n' }],
      item_changes: [{ character: 'bob', item: 'ring', action: 'give', to: 'alice', quantity: 1, forced: true, exit: 'street', with: 'k' }],
      item_edits: [{ item: 'ring', state: 'open', opened_by: ['k'], notable: true }],
      events: [{ turn: 4, round: 1, text: 't', importance: 1, items: ['ring'] }],
    })
    expect(parsed.slots).toEqual([{ id: 'tail', name: 'tail', capacity: 2 }])
    expect(parsed.items?.[0]).toMatchObject({ key: 'ring', wornBy: 'bob', wornPosition: 'left hand', container: { state: 'locked', openedBy: ['key'] }, at: { location: 'bar', feature: 'counter' }, inside: 'x' })
    expect(parsed.itemChanges).toEqual([{ character: 'bob', item: 'ring', action: 'give', to: 'alice', quantity: 1, forced: true, exit: 'street', with: 'k' }])
    expect(parsed.itemEdits).toEqual([{ item: 'ring', state: 'open', openedBy: ['k'], notable: true }])
    expect(parsed.events?.[0]?.items).toEqual(['ring'])
  })
})

describe('what is wrong with the things', () => {
  it('tells of a lock nothing is known to open (a warning for what was made up, information otherwise), and of one thing made twice', () => {
    for (const entry of store.consolidation.pending()) store.consolidation.resolve(entry.id, 2, 'part of the world')
    store.items.setOpeners({ kind: 'item', id: item('chest').id }, [])
    store.edit({ turn: 3, items: [{ key: 'box', name: 'Strongbox', container: { state: 'locked' }, at: { location: 'bar' } }] })
    store.items.add({ name: 'Brass lantern', description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false }, { kind: 'location', locationId: store.locations.getBySourceId('bar')!.id })
    const found = lintWorld(store).filter(finding => finding.subject.kind === 'item')
    expect(found.map(finding => [finding.severity, finding.code, finding.subject.key])).toEqual(expect.arrayContaining([['warning', 'lock-without-key', 'box'], ['info', 'lock-without-key', 'chest']]))
    expect(found.some(finding => finding.code === 'item-duplicate' && /Brass lantern/.test(finding.message))).toBe(true)
  })

  it('tells of a locked way with no key and no note', () => {
    const bar = store.locations.getBySourceId('bar')!
    const exit = store.locations.getExit(bar.id, store.locations.getBySourceId('street')!.id)!
    store.locations.updateExit(exit.id, { state: 'locked' })
    expect(lintWorld(store).some(finding => finding.subject.kind === 'exit' && finding.code === 'lock-without-key')).toBe(true)
    store.locations.updateExit(exit.id, { note: 'the landlord has the key' })
    expect(lintWorld(store).some(finding => finding.subject.kind === 'exit' && finding.code === 'lock-without-key')).toBe(false)
  })
})

describe('what happened to a thing', () => {
  it('is found by the thing: listed, searched by words with the thing as a filter, and by the name of the thing', () => {
    store.edit({ turn: 2, events: [
      { turn: 2, round: 1, text: 'It was opened by Bob.', importance: 3, items: ['chest'], involves: ['bob'] },
      { turn: 2, round: 1, text: 'It was opened by Alice.', importance: 3, items: ['satchel'], involves: ['alice'] },
    ] })
    expect(store.events.list({ aboutItem: item('chest').id }).map(event => event.text)).toEqual(['It was opened by Bob.'])
    expect(store.searchEvents({ text: 'opened', itemId: item('satchel').id }).map(event => event.text)).toEqual(['It was opened by Alice.'])
    expect(store.recallIndex.lexical({ text: 'oak chest', kinds: ['event'], limit: 5 }).map(hit => hit.refId)).toEqual([store.events.list({ aboutItem: item('chest').id })[0]!.id])
  })
})

describe('reading things back', () => {
  it('shows each thing with where it is, notable ones first, in the records', () => {
    store.edit({ turn: 3, itemEdits: [{ item: 'ring', notable: true }] })
    const items = store.records().items
    expect(items[0]).toMatchObject({ key: 'ring', notable: true, holder: 'at Street' })
    expect(items.find(entry => entry.key === 'coat')).toMatchObject({ holder: 'carried by alice', owner: null })
    expect(items.find(entry => entry.key === 'coins')).toMatchObject({ holder: 'inside Satchel', quantity: 40 })
    expect(items.find(entry => entry.key === 'chest')).toMatchObject({ state: 'locked' })
    expect(items.find(entry => entry.key === 'letter')).toMatchObject({ hidden: true })
  })

  it('takes a blank for a field left out: a model that sends an empty string means it has nothing to say, not a slot or a place of that name', () => {
    const parsed = parseRecordsEdit({ turn: 1, items: [{ key: 'key', name: 'Key', wearable: '', owner: ' ', worn_position: '', held_by: '', inside: '', at: { location: 'bar', feature: '', position: '  ' } }] })
    const spec = parsed.items?.[0]
    expect(spec).toMatchObject({ key: 'key', at: { location: 'bar' } })
    for (const field of ['wearable', 'owner', 'wornPosition', 'heldBy', 'inside']) expect(spec).not.toHaveProperty(field)
    expect(spec?.at).toEqual({ location: 'bar' })
    expect(parseRecordsEdit({ turn: 1, items: [{ key: 'key', name: 'Key', at: { location: '' } }] }).items?.[0]).not.toHaveProperty('at')
  })

  it('says, when it asks where a thing starts, what each way to say it looks like and whether there is none or too many', () => {
    const problems = (items: unknown[]): string => problemsOf(parseRecordsEdit({ turn: 2, items })).join('\n')
    expect(problems([{ key: 'k', name: 'K' }])).toMatch(/at \(lying in a place: \{"location": place key\}\), held_by \(a character's key\).*it has none yet/)
    expect(problems([{ key: 'k', name: 'K', held_by: 'bob', at: { location: 'bar' } }])).toMatch(/it has more than one/)
  })
})
