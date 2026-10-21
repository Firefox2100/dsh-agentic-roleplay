import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as statePlugin from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionNotFoundError } from '../../../src/host/sessions/errors.ts'
import { InvalidEditProblems } from '../../../src/shared/world-state.ts'
import { ImageGenerationService, type ImageGenerationResult } from '@dsh-ai-providers/core'
import { editWorldLore, editWorldCharacter, editWorldPlace, editWorldRelation, editWorldThing, generateSessionEntityImage, readWorldState, sessionEntityImageFile, uploadSessionEntityImage } from '../../../src/host/sessions/world-state.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
class Images extends ImageGenerationService {
  readonly provider = 'test'
  readonly model = 'paint-1'
  async generate(): Promise<ImageGenerationResult> { return { model: this.model, images: [{ data: new Blob([PNG], { type: 'image/png' }), mediaType: 'image/png' }] } }
}

let base: string
let ctx: Context
let fiber: { dispose(): void }
const state = () => (ctx as unknown as { roleplayState: statePlugin.RoleplayState }).roleplayState
const sessionsDir = () => join(base, 'sessions')
const deps = () => ({ state: state(), sessionsDir })

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'world-state-'))
  ctx = new Context()
  fiber = ctx.plugin(statePlugin as never, {} as never) as unknown as { dispose(): void }
  await new Promise(resolve => setTimeout(resolve, 20))
})
afterEach(async () => {
  fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 20))
  await rm(base, { recursive: true, force: true })
})

describe('the world of a session', () => {
  it('is its characters as they are now: who they are, what they are doing, where they stand and what they want', () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const { id } = session.metadata.get()
    const clara = session.characters.add({
      sourceId: 'clara', name: 'Clara', aliases: ['Clar'], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: 'Innkeeper.', personality: 'Warm.', background: 'Born here.',
      appearance: 'Tall.', speech: { style: 'Brisk', examples: ['Evening.'] }, age: '40',
    })
    session.characterStates.create(clara.id, { publicState: 'Wiping glasses', innerState: 'Worried', activity: 'serving' })
    const bar = session.locations.add({ sourceId: 'bar', name: 'The Bar', description: '', features: [] })
    session.placements.place('character', clara.id, { locationId: bar.id, position: 'behind the counter' })
    const goal = session.intents.add(clara.id, { type: 'quest', name: 'Find the ledger', description: 'It went missing', status: 'active', horizon: 'short', priority: 0.8, urgency: 0.5, plan: [], openThreads: [], constraints: [] })
    expect(readWorldState(deps(), id).characters).toEqual([{
      key: 'clara', name: 'Clara', aliases: ['Clar'], role: 'npc', tier: 'principal', kind: 'person', control: 'agent', age: '40', summary: 'Innkeeper.', personality: 'Warm.', background: 'Born here.',
      appearance: 'Tall.', speech: { style: 'Brisk', examples: ['Evening.'] }, state: { publicState: 'Wiping glasses', innerState: 'Worried', activity: 'serving' },
      place: { key: 'bar', name: 'The Bar', position: 'behind the counter' }, goals: [{ ref: String(goal.id), name: 'Find the ledger', description: 'It went missing', status: 'active', priority: 0.8 }],
    }])
    expect(readWorldState(deps(), id).places).toEqual([{ key: 'bar', name: 'The Bar', description: '', features: [] }])
  })

  it('has pictures of its places and things, made from the identity the session copied or brought by the player', async () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const { id } = session.metadata.get()
    const bar = session.locations.add({ sourceId: 'bar', name: 'The Bar', description: '', features: [] })
    const ledger = session.items.add({ sourceId: 'ledger', name: 'Ledger', description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false }, { kind: 'location', locationId: bar.id })
    await expect(generateSessionEntityImage(deps(), id, 'place', 'bar', new Images())).rejects.toThrow(/needs a visual identity/)
    session.visualIdentities.set('location', bar.id, { description: 'A low room of dark oak.', tags: [], negativeTags: [] })
    const placed = await generateSessionEntityImage(deps(), id, 'place', 'bar', new Images())
    expect(placed.places[0]?.image).toContain('/sessions/world/place/image/file?')
    const held = await uploadSessionEntityImage(deps(), id, 'thing', 'ledger', new Uint8Array(PNG), 'ledger.png')
    expect(held.things.find(entry => entry.key === 'ledger')?.image).toContain('/sessions/world/thing/image/file?')
    expect((await sessionEntityImageFile(deps(), id, 'thing', 'ledger')).size).toBeGreaterThan(0)
    await expect(uploadSessionEntityImage(deps(), id, 'thing', 'ledger', new Uint8Array([0xff, 0xd8]), 'x.jpg')).rejects.toThrow(/must be a PNG/)
    await expect(sessionEntityImageFile(deps(), id, 'place', 'nowhere')).rejects.toThrow('there is no place "nowhere"')
    expect(ledger.id).toBeGreaterThan(0)
  })

  it('is its triggers as they stand: what each waits for and does, whether and how often it fired, and where it came from', () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const { id } = session.metadata.get()
    const made = session.triggers.add({ key: 'knock', name: 'Knock', condition: { type: 'event', tag: 'door' }, effects: [{ type: 'beat', text: 'A knock.' }], repeat: false, priority: 1 }, 'story', 2)
    session.triggers.update(made.id, { status: 'fired', fireCount: 1, lastResult: true })
    expect(readWorldState(deps(), id).triggers).toEqual([{ key: 'knock', name: 'Knock', when: { type: 'event', tag: 'door' }, effects: [{ type: 'beat', text: 'A knock.' }], repeat: false, priority: 1, announced: false, status: 'fired', fireCount: 1, origin: 'story', problems: [] }])
  })

  it('refuses an id that names no session, and ids that are not session ids', () => {
    expect(() => readWorldState(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d')).toThrow(SessionNotFoundError)
    expect(() => readWorldState(deps(), '../x')).toThrow(SessionNotFoundError)
  })
})

describe('editing a character of a session', () => {
  async function story() {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const { id } = session.metadata.get()
    const clara = session.characters.add({ sourceId: 'clara', name: 'Clara', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: 'Innkeeper.', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    session.characterStates.create(clara.id, { publicState: 'Wiping glasses', innerState: '', activity: 'serving' })
    const bar = session.locations.add({ sourceId: 'bar', name: 'The Bar', description: '', features: [] })
    const cellar = session.locations.add({ sourceId: 'cellar', name: 'The Cellar', description: '', features: [] })
    session.placements.place('character', clara.id, { locationId: bar.id, position: '' })
    const goal = session.intents.add(clara.id, { type: 'quest', name: 'Find the ledger', description: '', status: 'active', horizon: 'short', priority: 0.8, urgency: 0.5, plan: [], openThreads: [], constraints: [] })
    return { session, id, clara, cellar, goal }
  }

  it('changes who it is, how it stands and where, and what it wants, together, and says how the world stands after', async () => {
    const { id, goal } = await story()
    const world = editWorldCharacter(deps(), id, 'clara', {
      name: 'Clara Whitlock', aliases: [' Clar ', ''], tier: 'supporting', age: '41', speech: { examples: ['Evening.', ' '] }, state: { activity: 'cleaning the cellar' },
      place: { location: 'cellar', position: 'by the barrels' }, goals: [{ ref: String(goal.id), status: 'paused', priority: 0.2 }],
    })
    expect(world.characters[0]).toMatchObject({
      name: 'Clara Whitlock', aliases: ['Clar'], tier: 'supporting', age: '41', speech: { style: '', examples: ['Evening.'] }, summary: 'Innkeeper.',
      state: { publicState: 'Wiping glasses', activity: 'cleaning the cellar' }, place: { key: 'cellar', name: 'The Cellar', position: 'by the barrels' }, goals: [{ name: 'Find the ledger', status: 'paused', priority: 0.2 }],
    })
  })

  it('changes nothing when any part is refused: an unknown character, place or goal, or a result that is not allowed', async () => {
    const { id, session } = await story()
    const problems = (key: string, edit: Parameters<typeof editWorldCharacter>[3]): string[] => { try { editWorldCharacter(deps(), id, key, edit); return [] } catch (error) { if (error instanceof InvalidEditProblems) return [...error.problems]; throw error } }
    expect(problems('nobody', { name: 'x' })).toEqual(['there is no character "nobody"'])
    expect(problems('clara', { name: 'X', place: { location: 'moon' }, goals: [{ ref: '999', name: 'y' }] })).toEqual(['there is no place "moon"', 'Clara has no goal "999"'])
    expect(problems('clara', { name: 'X', role: 'playable', kind: 'group' })).toEqual([expect.stringContaining('playable')])
    expect(session.characters.getBySourceId('clara')?.name).toBe('Clara')
  })

  it('refuses an id that names no session', () => {
    expect(() => editWorldCharacter(deps(), '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d', 'clara', { name: 'x' })).toThrow(SessionNotFoundError)
  })
})

describe('editing relations of a session', () => {
  it('updates character relationships and routes and can remove them', () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const id = session.metadata.get().id
    const a = session.characters.add({ sourceId: 'a', name: 'A', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    const b = session.characters.add({ sourceId: 'b', name: 'B', aliases: [], kind: 'person', tier: 'supporting', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    session.relationships.upsert(a.id, b.id, { label: 'acquaintance' }, 0)
    const p = session.locations.add({ sourceId: 'p', name: 'P', description: '', features: [] })
    const q = session.locations.add({ sourceId: 'q', name: 'Q', description: '', features: [] })
    session.locations.addExit({ fromId: p.id, toId: q.id, description: 'path', travelSeconds: 30 })
    const world = readWorldState(deps(), id)
    const relation = world.relations.find(edge => edge.kind === 'character')!
    expect(editWorldRelation(deps(), id, { kind: 'character', key: relation.key, trust: 0.7 }).relations.find(edge => edge.key === relation.key)).toMatchObject({ trust: 0.7 })
    const exit = readWorldState(deps(), id).relations.find(edge => edge.kind === 'exit')!
    expect(editWorldRelation(deps(), id, { kind: 'exit', key: exit.key, travelSeconds: null }).relations.find(edge => edge.key === exit.key)).not.toHaveProperty('travelSeconds')
    expect(editWorldRelation(deps(), id, { kind: 'character', key: relation.key, remove: true }).relations.some(edge => edge.key === relation.key)).toBe(false)
  })

  it('creates typed relations by stable entity keys', () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } }); const id = session.metadata.get().id
    session.characters.add({ sourceId: 'a', name: 'A', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    session.characters.add({ sourceId: 'b', name: 'B', aliases: [], kind: 'person', tier: 'supporting', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    session.locations.add({ sourceId: 'p', name: 'P', description: '', features: [] }); session.locations.add({ sourceId: 'q', name: 'Q', description: '', features: [] })
    expect(editWorldRelation(deps(), id, { create: true, kind: 'character', from: 'a', to: 'b', label: 'friend' }).relations).toContainEqual(expect.objectContaining({ kind: 'character', label: 'friend' }))
    expect(editWorldRelation(deps(), id, { create: true, kind: 'exit', from: 'p', to: 'q', description: 'path' }).relations).toContainEqual(expect.objectContaining({ kind: 'exit', description: 'path' }))
  })
})

describe('editing places and things of a session', () => {
  it('changes descriptive state and visual identity transactionally', () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const { id } = session.metadata.get()
    const bar = session.locations.add({ sourceId: 'bar', name: 'The Bar', description: '', features: [] })
    session.items.add({ sourceId: 'ledger', name: 'Ledger', description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false }, { kind: 'location', locationId: bar.id })
    expect(editWorldPlace(deps(), id, 'bar', { description: 'Crowded.', visualIdentity: { description: 'Dark oak walls.', tags: [], negativeTags: [] } }).places[0]).toMatchObject({ description: 'Crowded.', visualIdentity: { description: 'Dark oak walls.' } })
    expect(editWorldThing(deps(), id, 'ledger', { quality: 'water-damaged', notable: true }).things[0]).toMatchObject({ quality: 'water-damaged', notable: true, holder: 'The Bar' })
  })

  it('moves a place into another, refuses a circle, and gives a thing an owner or none', () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const { id } = session.metadata.get()
    const bar = session.locations.add({ sourceId: 'bar', name: 'The Bar', description: '', features: [] })
    session.locations.add({ sourceId: 'cellar', name: 'Cellar', description: '', features: [] })
    session.characters.add({ sourceId: 'clara', name: 'Clara', aliases: [], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    session.items.add({ sourceId: 'ledger', name: 'Ledger', description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false }, { kind: 'location', locationId: bar.id })
    expect(editWorldPlace(deps(), id, 'cellar', { parent: 'bar' }).places.find(entry => entry.key === 'cellar')?.parent).toEqual({ key: 'bar', name: 'The Bar' })
    expect(() => editWorldPlace(deps(), id, 'bar', { parent: 'cellar' })).toThrow(/inside itself/)
    expect(() => editWorldPlace(deps(), id, 'bar', { parent: 'nowhere' })).toThrow(/no place "nowhere"/)
    expect(editWorldPlace(deps(), id, 'cellar', { parent: null }).places.find(entry => entry.key === 'cellar')).not.toHaveProperty('parent')
    expect(editWorldThing(deps(), id, 'ledger', { owner: 'clara' }).things[0]?.owner).toEqual({ key: 'clara', name: 'Clara' })
    expect(() => editWorldThing(deps(), id, 'ledger', { owner: 'ghost' })).toThrow(/no character "ghost"/)
    expect(editWorldThing(deps(), id, 'ledger', { owner: null }).things[0]).not.toHaveProperty('owner')
  })
})

describe('who knows a lore entry of a session', () => {
  const setup = () => {
    const session = state().createSession(sessionsDir(), { name: 'Night', world: { id: 'w', name: 'W' } })
    const clara = session.characters.add({ sourceId: 'clara', name: 'Clara', aliases: ['Clar'], kind: 'person', tier: 'principal', role: 'npc', control: 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    const arthur = session.characters.add({ sourceId: 'arthur', name: 'Arthur', aliases: [], kind: 'person', tier: 'principal', role: 'playable', control: 'player', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
    session.lore.add({ sourceId: 'rite', title: 'The rite', kind: 'custom', scope: 'listed', summary: '', body: '', subjects: [], related: [], sources: [] })
    return { session, id: session.metadata.get().id, clara, arthur }
  }

  it('lists the characters with an edge to it, and changes the edges with the scope', () => {
    const { session, id, clara, arthur } = setup()
    expect(editWorldLore(deps(), id, 'rite', { knownBy: ['Clar'] }).lore?.[0]).toMatchObject({ scope: 'listed', knownBy: ['Clara'] })
    expect(session.knowledge.knows(clara.id, 'lore', session.lore.getBySourceId('rite')!.id)).toBe(true)
    expect(editWorldLore(deps(), id, 'rite', { knownBy: ['arthur'] }).lore?.[0]?.knownBy).toEqual(['Arthur'])
    expect(session.knowledge.knows(clara.id, 'lore', session.lore.getBySourceId('rite')!.id)).toBe(false)
    expect(session.knowledge.knows(arthur.id, 'lore', session.lore.getBySourceId('rite')!.id)).toBe(true)
    expect(editWorldLore(deps(), id, 'rite', { scope: 'everyone', knownBy: [] }).lore?.[0]).toMatchObject({ scope: 'everyone', knownBy: [] })
  })

  it('changes nothing when a name is not a character of the story or the entry is for everyone', () => {
    const { session, id } = setup()
    expect(() => editWorldLore(deps(), id, 'rite', { knownBy: ['Nobody'] })).toThrow(InvalidEditProblems)
    expect(() => editWorldLore(deps(), id, 'rite', { scope: 'everyone', knownBy: ['Clara'] })).toThrow(InvalidEditProblems)
    expect(session.lore.getBySourceId('rite')!.scope).toBe('listed')
  })
})
