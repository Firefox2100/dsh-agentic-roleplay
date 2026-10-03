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
  it('list the characters by key, and read one with its state', async () => {
    expect((await run('list_characters', {})).value).toEqual([
      { key: 'arthur', name: 'Arthur', role: 'npc', controlled_by: 'the player', summary: 'Arthur summary' },
      { key: 'alice', name: 'Alice', role: 'npc', controlled_by: 'an agent', summary: 'Alice summary' },
    ])
    const { value, text } = await run('get_character', { character: 'alice' })
    expect(value).toMatchObject({ character: 'alice', name: 'Alice', public_state: 'Alice waits', inner_state: 'calm', activity: 'idle', emotion: null })
    expect(text).toContain('"public_state": "Alice waits"')
    await expect(run('get_character', { character: 'nobody' })).rejects.toThrow(/there is no character "nobody"; list_characters shows the keys/)
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

  it('refuse what the records do not accept, naming the problem', async () => {
    await expect(run('record_event', { text: 'x', importance: 9 })).rejects.toThrow(/importance must be a whole number from 1 to 5/)
    await expect(run('update_character_state', { character: 'nobody', activity: 'x' })).rejects.toThrow(/there is no character "nobody"/)
  })

  it('are not there unless the plugin is configured for them', () => {
    expect(Object.keys(tools(false))).toEqual(['list_characters', 'get_character', 'search_events', 'recall_memories', 'read_records', 'list_threads'])
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
    expect(ok.value).toEqual({ writes: 2, event_ids: [1], belief_ids: [] })
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
    expect(tool.output.render({} as never, [] as never).map(block => (block.type === 'text' ? block.text : '')).join('')).toBe('You do not remember anything about that.')
    store.edit({ turn: 1, events: [{ turn: 1, round: 1, text: 'x key', importance: 3, tags: ['key'], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] }] })
    await tool.execute({ about: 'key' } as never, exec() as never)
    expect(store.events.perceivedBy(store.characters.getBySourceId('alice')!.id)[0]?.perception.recalls).toBe(1)
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
    expect(await names({})).toEqual(['list_characters', 'get_character', 'search_events', 'recall_memories', 'read_records', 'list_threads'])
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
