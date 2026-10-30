import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import DshSessions from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as plugin from '../../src/plugin.ts'
import { InvalidEditError, createCharacterTools, createTools, type AgentLink, type SessionStore } from '../../src/index.ts'
import { memoryStore, newCharacter } from '../helpers.ts'

let store: SessionStore
let link: AgentLink | undefined
const resolve = (id: string): AgentLink | undefined => (id === 'agent-1' ? link : undefined)
const exec = (id = 'agent-1') => ({ agent: { session: { id } }, signal: new AbortController().signal }) as never

beforeEach(() => {
  store = memoryStore()
  for (const [sourceId, name, control] of [['arthur', 'Arthur', 'player'], ['alice', 'Alice', 'agent']] as const) {
    const { id } = store.characters.add(newCharacter({ sourceId, name, aliases: [], control, summary: `${name} summary` }))
    store.characterStates.create(id, { publicState: `${name} waits`, innerState: 'calm', activity: 'idle' })
  }
  const session = Object.assign(Object.create(store) as SessionStore, { recallRanked: (query: Parameters<SessionStore['recall']>[0]) => Promise.resolve(store.recall(query)) })
  link = { session: session as never, turn: 4, policy: { flaky: false, recall: 5 } }
})
afterEach(() => { store.close() })

const tools = (write: boolean) => Object.fromEntries(createTools(resolve, { write }).map(tool => [tool.name, tool]))
const run = async (name: string, args: object, write = true, id?: string) => {
  const tool = tools(write)[name]!
  const value = await tool.execute(args as never, exec(id))
  return { value, text: tool.output.render(args as never, value as never).map(block => (block.type === 'text' ? block.text : '')).join('') }
}

describe('the reading tools', () => {
  it('lists factions and reads their state, members, goals and relationships', async () => {
    const alice = store.characters.getBySourceId('alice')!
    const faction = store.factions.add({ sourceId: 'watch', name: 'Harbour Watch', aliases: [], summary: 'Guards the harbour.', description: '', values: ['order'], structure: '' })
    store.factionStates.create(faction.id, { publicState: 'On patrol.' })
    store.factionMemberships.upsert(faction.id, alice.id, { role: 'officer' }, 1)
    store.factionIntents.add(faction.id, { type: 'agenda', name: 'Secure the harbour', description: '', status: 'active', horizon: 'day', priority: 0.8, urgency: 0.6, plan: [], openThreads: [], constraints: [] })
    expect((await run('list_factions', {})).value).toEqual([{ key: 'watch', name: 'Harbour Watch', summary: 'Guards the harbour.', members: 1, active_goals: 1 }])
    expect((await run('get_faction', { faction: 'watch' })).value).toMatchObject({ faction: 'watch', public_state: 'On patrol.', members: [{ character: 'alice', role: 'officer' }], goals: [{ name: 'Secure the harbour' }] })
  })

  it('list the characters by key, and read one with its state', async () => {
    expect((await run('list_characters', {})).value).toEqual([
      { key: 'arthur', name: 'Arthur', role: 'npc', controlled_by: 'the player', summary: 'Arthur summary' },
      { key: 'alice', name: 'Alice', role: 'npc', controlled_by: 'an agent', summary: 'Alice summary' },
    ])
    const { value, text } = await run('get_character', { character: 'alice' })
    expect(value).toMatchObject({ character: 'alice', name: 'Alice', public_state: 'Alice waits', inner_state: 'calm', activity: 'idle', variables: [] })
    expect(text).toContain('"public_state": "Alice waits"')
    await expect(run('get_character', { character: 'nobody' })).rejects.toThrow(/there is no character "nobody"; list_characters shows the keys/)
  })

  it('list the places, read one with its features, exits and who is there, and say where a character is', async () => {
    store.edit({
      turn: 1,
      places: [
        { key: 'town', name: 'Town' },
        { key: 'bar', name: 'The Bar', parent: 'town', features: [{ key: 'counter', name: 'Counter' }], exits: [{ to: 'town', description: 'the door', state: 'locked', note: 'closing time' }] },
        { key: 'cellar', name: 'Cellar', parent: 'bar' },
      ],
      moves: [{ character: 'alice', to: 'bar', position: 'at the counter', feature: 'counter' }],
    })
    expect(((await run('list_locations', {})).value as { key: string; in: string | null; exits: number }[]).map(entry => [entry.key, entry.in, entry.exits])).toEqual([['town', null, 1], ['bar', 'town', 1], ['cellar', 'bar', 0]])
    expect(((await run('list_locations', { within: 'town' })).value as { key: string }[]).map(entry => entry.key)).toEqual(['bar', 'cellar'])
    await expect(run('list_locations', { within: 'moon' })).rejects.toThrow(/there is no place "moon"/)
    expect((await run('get_location', { location: 'bar' })).value).toEqual({
      location: 'bar', name: 'The Bar', description: '', in: 'town', features: [{ key: 'counter', name: 'Counter', description: '' }],
      exits: [{ to: 'town', name: 'Town', state: 'locked', description: 'the door', note: 'closing time', travel_time_seconds: null }],
      items: [],
      here: [{ character: 'alice', position: 'at the counter', feature: 'counter' }],
    })
    await expect(run('get_location', { location: 'moon' })).rejects.toThrow(/there is no place "moon"/)
    expect((await run('get_character', { character: 'alice' })).value).toMatchObject({ location: 'bar', position: 'at the counter' })
    store.edit({ turn: 2, events: [{ turn: 2, round: 1, text: 'A glass broke.', importance: 2, location: 'bar' }, { turn: 2, round: 1, text: 'A bell rang.', importance: 2, location: 'town' }] })
    expect(((await run('search_events', { location: 'bar' })).value as { text: string }[]).map(event => event.text)).toEqual(['A glass broke.'])
    expect(((await run('search_events', { location: 'bar', text: 'glass' })).value as { text: string }[]).map(event => event.text)).toEqual(['A glass broke.'])
    await expect(run('search_events', { location: 'moon' })).rejects.toThrow(/there is no place "moon"/)
  })

  it('search what happened, by character, words, turns and importance, most recent first and capped', async () => {
    store.edit({ turn: 1, events: [
      { turn: 1, round: 1, text: 'Alice found a brass key.', importance: 3, tags: ['key'], involves: ['alice'] },
      { turn: 2, round: 1, text: 'The band played.', importance: 1 },
      { turn: 3, round: 1, text: 'Arthur took the key.', importance: 4, involves: ['arthur'] },
    ] })
    const titles = async (args: object) => ((await run('search_events', args)).value as { text: string }[]).map(event => event.text)
    expect(await titles({})).toEqual(['Alice found a brass key.', 'The band played.', 'Arthur took the key.'])
    expect(await titles({ text: 'KEY' })).toEqual(['Alice found a brass key.', 'Arthur took the key.'])
    expect(await titles({ character: 'alice' })).toEqual(['Alice found a brass key.'])
    expect(await titles({ from_turn: 2, min_importance: 2 })).toEqual(['Arthur took the key.'])
    expect(await titles({ limit: 1 })).toEqual(['Arthur took the key.'])
    await expect(run('search_events', { character: 'nobody' })).rejects.toThrow(/there is no character/)
  })

  it('recall what a character remembers, in its own version, by the memory policy of the chat', async () => {
    store.edit({ turn: 1, events: [{ turn: 1, round: 1, text: 'Arthur took the key.', importance: 4, tags: ['key'], involves: ['arthur'], perceivedBy: [{ character: 'alice', mode: 'witnessed', content: 'I watched Arthur pocket a key.' }] }] })
    const { value } = await run('recall_memories', { character: 'alice', situation: 'Arthur asks about the key' })
    expect(value).toEqual([{ clarity: 'clear', turn: 1, text: 'I watched Arthur pocket a key.' }])
  })

  it('list what is still open', async () => {
    store.edit({ turn: 2, threadsOpened: ['Who has the key?'] })
    expect((await run('list_threads', {})).value).toEqual([{ id: 1, text: 'Who has the key?', opened_turn: 2 }])
  })

  it('say so when the agent works in no roleplay session', async () => {
    await expect(run('list_characters', {}, true, 'someone-else')).rejects.toThrow('this agent is not working in a roleplay session')
  })
})

describe('the writing tools', () => {
  it('change the records in the turn the agent is playing', async () => {
    expect((await run('update_character_state', { character: 'alice', activity: 'wiping the bar', public_state: 'Wiping the bar.' })).value).toMatchObject({ writes: 1 })
    expect(store.characterStates.get(store.characters.getBySourceId('alice')!.id)).toMatchObject({ activity: 'wiping the bar', publicState: 'Wiping the bar.' })
    const event = await run('record_event', { text: 'Alice wiped the bar.', importance: 2, involves: ['alice'], perceived_by: [{ character: 'arthur', mode: 'witnessed' }] })
    expect(event.value).toEqual({ writes: 1, event_ids: [1], belief_ids: [] })
    expect(event.text).toBe('Event recorded (1 change)')
    expect(store.events.get(1)).toMatchObject({ turn: 4, round: 1 })
    expect((await run('remember', { character: 'alice', kind: 'belief', text: 'Arthur is hungry.', importance: 2 })).value).toMatchObject({ belief_ids: [1] })
    const thread = await run('open_thread', { text: 'Why is Arthur here?' })
    expect(store.threads.list('open')).toHaveLength(1)
    expect(thread.value).toMatchObject({ writes: 1 })
    await run('resolve_thread', { id: 1 })
    expect(store.threads.list('open')).toEqual([])
  })

  it('move a character through open exits, and refuse with the reason when the way is shut', async () => {
    store.edit({ turn: 1, places: [{ key: 'bar', name: 'Bar' }, { key: 'yard', name: 'Yard', exits: [{ to: 'bar' }] }, { key: 'vault', name: 'Vault', exits: [{ to: 'bar', state: 'locked', note: 'needs a key' }] }], moves: [{ character: 'alice', to: 'bar' }] })
    expect((await run('move_character', { character: 'alice', to: 'yard', position: 'by the well' })).value).toMatchObject({ writes: 1 })
    expect(store.placements.get('character', store.characters.getBySourceId('alice')!.id)).toMatchObject({ locationId: store.locations.getBySourceId('yard')!.id, position: 'by the well' })
    await expect(run('move_character', { character: 'alice', to: 'vault' })).rejects.toThrow(/there is no way|is locked/)
    expect((await run('move_character', { character: 'alice', to: 'vault', ignore_exits: true })).value).toMatchObject({ writes: 1 })
  })

  it('refuse what the records do not accept, naming the problem', async () => {
    await expect(run('record_event', { text: 'x', importance: 9 })).rejects.toThrow(/importance must be a whole number from 1 to 5/)
    await expect(run('update_character_state', { character: 'nobody', activity: 'x' })).rejects.toThrow(/there is no character "nobody"/)
  })

  it('does not list to an agent the variables the engine itself raises and lowers', async () => {
    store.variables.define({ key: 'command_recruit', name: '/recruit', kind: 'flag', subject: 'world', visibility: 'hidden' })
    store.variables.define({ key: 'trust', name: 'Trust', kind: 'number', subject: 'character', min: 0, max: 10 })
    const keys = async (): Promise<string[]> => ((await run('list_variables', {})).value as { key: string }[]).map(entry => entry.key)
    expect(await keys()).toContain('command_recruit')
    link = { ...link!, engineVariables: () => ['command_recruit'] }
    const hidden = await keys()
    expect(hidden).not.toContain('command_recruit')
    expect(hidden).toContain('trust')
  })

  it('are not there unless the plugin is configured for them', () => {
    expect(Object.keys(tools(false))).toEqual(['search_lore', 'list_characters', 'get_character', 'list_factions', 'get_faction', 'list_relationships', 'list_items', 'get_item', 'list_slots', 'list_locations', 'get_location', 'search_events', 'recall_memories', 'read_records', 'list_variables', 'get_agenda', 'list_threads'])
    expect(Object.keys(tools(true))).toContain('record_event')
  })
})

describe('reading and editing the records in one call', () => {
  it('reads the records of some rounds back, in the wire format', async () => {
    store.edit({ turn: 1, events: [{ turn: 1, round: 1, text: 'a', importance: 2 }, { turn: 1, round: 2, text: 'b', importance: 2 }] })
    const { value } = await run('read_records', { rounds: [{ turn: 1, round: 2 }] })
    expect((value as { events: { text: string }[] }).events.map(event => event.text)).toEqual(['b'])
    expect((value as { characters: unknown[] }).characters).toHaveLength(2)
  })

  it('changes everything or nothing, and returns the reasons for a refusal so that the agent can correct and call again', async () => {
    const ok = await run('edit_records', { turn: 4, states: [{ character: 'alice', activity: 'x' }], events: [{ turn: 4, round: 1, text: 'e', importance: 2, tags: [], involves: ['alice'], perceived_by: [{ character: 'alice', mode: 'witnessed' }] }] })
    expect(ok.value).toEqual({ writes: 2, event_ids: [1], belief_ids: [], character_keys: [], place_keys: [], item_keys: [], variable_keys: [], trigger_keys: [] })
    await expect(run('edit_records', { turn: 4, states: [{ character: 'alice', activity: 'y' }], events: [{ turn: 4, round: 1, text: 'f', importance: 9, tags: [], involves: [], perceived_by: [] }] })).rejects.toThrow(InvalidEditError)
    expect(store.characterStates.get(store.characters.getBySourceId('alice')!.id)?.activity).toBe('x')
  })

  it('can be limited to naming the characters of one story', () => {
    const scoped = createTools(resolve, { write: true, characters: ['alice', 'arthur'] }).find(tool => tool.name === 'edit_records')!
    expect(JSON.stringify(scoped.parameters)).toContain('"enum":["alice","arthur"]')
  })
})

describe('the tools of one character', () => {
  const seeing = (characterKey: string) => {
    const id = store.characters.getBySourceId(characterKey)!.id
    const tool = createCharacterTools(() => link!, id)[0]!
    return async (about: string) => tool.execute({ about } as never, exec() as never) as Promise<{ text: string }[]>
  }

  it('bring back only what that character itself took in, though the others are asked at the same time', async () => {
    store.edit({ turn: 1, events: [
      { turn: 1, round: 1, text: 'Alice hid the brass key.', importance: 3, tags: ['key'], involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed', content: 'I hid the brass key under the floor.' }] },
      { turn: 1, round: 1, text: 'Arthur found a letter.', importance: 3, tags: ['letter'], involves: ['arthur'], perceivedBy: [{ character: 'arthur', mode: 'witnessed', content: 'I found a letter in the drawer.' }] },
    ] })
    const [asAlice, asArthur] = await Promise.all([seeing('alice')('the key'), seeing('arthur')('the key and the letter')])
    expect(asAlice.map(entry => entry.text)).toEqual(['I hid the brass key under the floor.'])
    expect(asArthur.map(entry => entry.text)).toEqual(['I found a letter in the drawer.'])
  })

  it('say so when there is nothing to remember, and counts what it brings back as recalled', async () => {
    const tool = createCharacterTools(() => link!, store.characters.getBySourceId('alice')!.id)[0]!
    expect(tool.output.render({} as never, [] as never).map(block => (block.type === 'text' ? block.text : '')).join('')).toBe('You do not remember anything about that, and there is nothing more to find: go on with what you know.')
    store.edit({ turn: 1, events: [{ turn: 1, round: 1, text: 'x key', importance: 3, tags: ['key'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
    await tool.execute({ about: 'key' } as never, exec() as never)
    expect(store.events.perceivedBy(store.characters.getBySourceId('alice')!.id)[0]?.perception.recalls).toBe(1)
  })

  it('recalls only the people and entities that character knows', async () => {
    const alice = store.characters.getBySourceId('alice')!.id
    const arthur = store.characters.getBySourceId('arthur')!
    store.edit({ turn: 1, places: [{ key: 'street', name: 'High Street' }, { key: 'bar', name: 'The Bar', exits: [{ to: 'street', oneWay: true }] }] })
    const street = store.locations.getBySourceId('street')!
    const bar = store.locations.getBySourceId('bar')!
    store.relationships.upsert(alice, arthur.id, { label: 'acquaintance' }, 1)
    store.knowledge.learn(alice, 'location', street.id, 1)
    store.knowledge.learn(alice, 'exit', store.locations.getExit(bar.id, street.id)!.id, 1)

    const tool = createCharacterTools(() => link!, alice).find(candidate => candidate.name === 'recall_my_known_entities')!
    expect(await tool.execute({} as never, exec() as never)).toEqual([
      { kind: 'character', key: 'arthur', name: 'Arthur' },
      { kind: 'location', key: 'street', name: 'High Street' },
      { kind: 'route', key: 'bar -> street', name: 'The Bar to High Street' },
    ])
    expect(await tool.execute({ about: 'street' } as never, exec() as never)).toEqual([
      { kind: 'location', key: 'street', name: 'High Street' },
      { kind: 'route', key: 'bar -> street', name: 'The Bar to High Street' },
    ])
  })

  it('recalls the lore a character has a knowledge edge to and the lore everyone knows, never the rest', async () => {
    const alice = store.characters.getBySourceId('alice')!.id
    const entry = (title: string, extra: object = {}) => store.lore.add({ title, kind: 'history', summary: '', body: `${title} text`, subjects: [], related: [], sources: [], ...extra })
    const told = entry('Secret rite'); entry('Hidden vault'); entry('Common law', { scope: 'everyone' })
    store.knowledge.learn(alice, 'lore', told.id, 1)
    const tool = createCharacterTools(() => link!, alice).find(candidate => candidate.name === 'recall_my_lore')!
    const titles = ((await tool.execute({ about: 'text' } as never, exec() as never)) as { title: string }[]).map(found => found.title).sort()
    expect(titles).toEqual(['Common law', 'Secret rite'])
  })
})

describe('the plugin', () => {
  const names = async (config: object): Promise<string[]> => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(DshSessions)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(plugin as never, config as never)
    await new Promise(resolveWait => setTimeout(resolveWait, 20))
    const found = ctx.tools.schemas().map(schema => schema.name)
    await ctx.fiber.dispose()
    return found
  }

  it('registers the reading tools, and the writing ones when asked, with the tool registry present', async () => {
    expect(await names({})).toEqual(['search_lore', 'list_characters', 'get_character', 'list_factions', 'get_faction', 'list_relationships', 'list_items', 'get_item', 'list_slots', 'list_locations', 'get_location', 'search_events', 'recall_memories', 'read_records', 'list_variables', 'get_agenda', 'list_threads'])
    expect(await names({ writeTools: true })).toContain('open_thread')
  })

  it('serves them through the binding of the plugin that runs the agents, which can be removed', async () => {
    const ctx = new Context()
    await ctx.plugin(plugin as never, {} as never)
    await new Promise(resolveWait => setTimeout(resolveWait, 20))
    const state = ctx.roleplayState
    const unbind = state.bind(resolve)
    expect(state).toBeDefined()
    unbind()
    await ctx.fiber.dispose()
  })
})
