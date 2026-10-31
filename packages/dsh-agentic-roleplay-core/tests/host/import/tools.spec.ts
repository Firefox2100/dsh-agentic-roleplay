import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { isReviewing, markReady } from '../../../src/host/import/run-import.ts'
import { contextOf, importHooks, importNotice, importTools } from '../../../src/host/import/tools.ts'
import { IMPORT_FOLDER } from '../../../src/host/import/store.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { importMessage } from '../../../src/host/import/start-import.ts'

let directory: string
const worlds = { find: (id: string) => Promise.resolve(id === 'w1' ? { summary: { id: 'w1', name: 'W' }, directory } : undefined) } as never
const settings = () => ({ maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 16000, variablesPerRequest: 25, structured: 'tool' as const, temperature: 0.2, timeoutMinutes: 0, decisions: 'llm' as const, confidence: 0.7 })
const chat = authoringChatSessionId('w1')
const prompting = { prompts: () => ({ text: (id: string, language: string | undefined, variables?: Record<string, string | number>) => shippedText(id, language ?? 'en', variables) }), languages: () => ({ get: () => 'en' }) } as never
const textOf = (id: string, variables?: Record<string, string | number>): string => shippedText(id, 'en', { survey: 'import_survey', build: 'import_build', finish: 'import_finish', ...variables })

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'import-tools-')); await mkdir(join(directory, IMPORT_FOLDER), { recursive: true }) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the tools of an import', () => {
  const tools = () => importTools(worlds, settings, prompting)

  it('are three steps, each with nothing to ask for', () => {
    expect(tools().map(tool => tool.name)).toEqual(['import_survey', 'import_build', 'import_finish'])
  })

  it('work only in a world authoring chat, and say so otherwise', async () => {
    const [surveyTool] = tools()
    const exec = (id: string) => ({ agent: { session: { id } }, signal: new AbortController().signal }) as never
    await expect(surveyTool!.execute({ card: ".import/card.json" } as never, exec('session-x'))).rejects.toThrow(/only in a world authoring chat/)
    await expect(surveyTool!.execute({ card: ".import/card.json" } as never, exec(authoringChatSessionId('gone')))).rejects.toThrow(/no longer exists/)
  })

  it('name the card they import, and refuse another', async () => {
    const [surveyTool] = tools()
    await expect(surveyTool!.execute({ card: 'elsewhere.json' } as never, { agent: { session: { id: chat } }, signal: new AbortController().signal } as never)).rejects.toThrow(/the card to import is \.import\/card\.json/)
  })

  it('say when there is no card to import, and when a step is out of order', async () => {
    const [surveyTool, buildTool] = tools()
    const exec = { agent: { session: { id: chat, snapshotEvents: () => [] } }, signal: new AbortController().signal } as never
    await expect(surveyTool!.execute({ card: ".import/card.json" } as never, exec)).rejects.toThrow(/no card is waiting/)
    await writeFile(join(directory, IMPORT_FOLDER, 'state.json'), JSON.stringify({ phase: 'ready' }))
    await expect(buildTool!.execute({ card: ".import/card.json" } as never, exec)).rejects.toThrow(/the build cannot run now: the import is at "ready"/)
  })
})

describe('the import turn', () => {
  it('is told to the chat in place of what it does for any other message, with the steps in order', () => {
    expect(importNotice('ready', textOf)).toMatch(/import_survey, then import_build, then import_finish/)
    expect(importNotice('done', textOf)).toMatch(/already done/)
    expect(importNotice(undefined, textOf)).toMatch(/no card is waiting/)
    expect(importNotice('repair', textOf)).toMatch(/check_world/)
  })

  function hooked() {
    const listeners: Record<string, (...args: never[]) => unknown> = {}
    importHooks({ on: (name: string, listener: (...args: never[]) => unknown) => { listeners[name] = listener } } as never, worlds, prompting)
    const agent = (id: string, origin?: 'subagent') => ({ session: { id, header: { ...(origin === undefined ? {} : { origin }) } }, steer: vi.fn() })
    const step = (agent: unknown, text: string) => (listeners['agent/pre-step'] as (payload: unknown, next: () => Promise<unknown>) => Promise<{ messages: { content: { text: string }[] }[] }>)(
      { agent, step: 1, turn: 1, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }] }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    const stopping = (agent: unknown, turn = 1) => (listeners['agent/turn-stopping'] as (payload: unknown) => Promise<void>)({ agent, turn })
    return { agent, step, stopping }
  }

  it('is recognised in an authoring chat, and the turn is not allowed to end before the import is done, but only three times', async () => {
    await markReady(directory)
    const { agent, step, stopping } = hooked()
    const chatAgent = agent(chat)
    const decision = await step(chatAgent, importMessage())
    expect(decision.messages[0]!.content[0]!.text).toMatch(/import_survey/)
    await stopping(chatAgent)
    expect(chatAgent.steer).toHaveBeenCalledTimes(1)
    await stopping(chatAgent)
    await stopping(chatAgent)
    await stopping(chatAgent)
    expect(chatAgent.steer).toHaveBeenCalledTimes(3)
  })

  it('lets the turn end once the import is done, and leaves other turns, other chats and the chat\'s own children alone', async () => {
    await markReady(directory)
    const { agent, step, stopping } = hooked()
    const chatAgent = agent(chat)
    await step(chatAgent, importMessage())
    await writeFile(join(directory, IMPORT_FOLDER, 'state.json'), JSON.stringify({ phase: 'done' }))
    await stopping(chatAgent)
    expect(chatAgent.steer).not.toHaveBeenCalled()
    const other = agent(chat)
    expect((await step(other, 'Add a tavern.')).messages).toEqual([])
    await stopping(other)
    expect(other.steer).not.toHaveBeenCalled()
    expect((await step(agent('session-abc'), importMessage())).messages).toEqual([])
    expect((await step(agent(chat, 'subagent'), importMessage())).messages).toEqual([])
  })

  it('sends a turn back to mend a world that would not start, up to five times, tells it what is wrong, and lets it end once the world starts', async () => {
    const { agent, step, stopping } = hooked()
    const chatAgent = agent(chat)
    await writeFile(join(directory, 'world.json'), JSON.stringify({ id: 'w1', name: 'W' }))
    await mkdir(join(directory, 'characters', 'tam'), { recursive: true })
    await writeFile(join(directory, 'characters', 'tam', 'character.json'), JSON.stringify({ name: 'Tam', role: 'npc', summary: 'x', start: { location: 'nowhere' } }))
    await writeFile(join(directory, IMPORT_FOLDER, 'state.json'), JSON.stringify({ phase: 'repair', reviewing: true }))
    await writeFile(join(directory, IMPORT_FOLDER, 'state.json'), JSON.stringify({ phase: 'repair' }))
    expect((await step(chatAgent, importMessage())).messages[0]!.content[0]!.text).toMatch(/check_world/)
    expect(await isReviewing(directory)).toBe(true)
    await stopping(chatAgent)
    expect(chatAgent.steer).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(chatAgent.steer.mock.calls[0])).toMatch(/nowhere/)
    for (let round = 0; round < 7; round += 1) await stopping(chatAgent)
    expect(chatAgent.steer).toHaveBeenCalledTimes(5)
    const mended = agent(chat)
    await step(mended, importMessage())
    await writeFile(join(directory, 'characters', 'tam', 'character.json'), JSON.stringify({ name: 'Tam', role: 'npc', summary: 'x' }))
    await stopping(mended)
    expect(mended.steer).not.toHaveBeenCalled()
  })

  it('says there is nothing to import when the world holds no card', async () => {
    await rm(join(directory, IMPORT_FOLDER), { recursive: true })
    const { agent, step, stopping } = hooked()
    const chatAgent = agent(chat)
    expect((await step(chatAgent, importMessage())).messages[0]!.content[0]!.text).toMatch(/no card is waiting/)
    await stopping(chatAgent)
    expect(chatAgent.steer).not.toHaveBeenCalled()
  })
})

describe('the context of an import step', () => {
  const service = { decide: vi.fn(() => Promise.resolve({ answers: { a: { probability: 0.9 } } })) }
  const exec = { signal: new AbortController().signal, agent: { ctx: { get: (name: string) => (name === 'decisions' ? service : undefined) } } } as never

  it('carries the settings and the language, and a decision model only when the person chose one', () => {
    const plain = contextOf(exec, settings(), () => '', 'zh')
    expect(plain).toMatchObject({ concurrency: 1, language: 'zh' })
    expect(plain.decide).toBeUndefined()
    const decided = contextOf(exec, { ...settings(), decisions: 'decision', confidence: 0.8 }, () => '')
    expect(decided.confidence).toBe(0.8)
    expect(decided.decide).toBeDefined()
  })

  it('asks the decision model each question of a piece in one request and gives back the probabilities', async () => {
    const decided = contextOf(exec, { ...settings(), decisions: 'decision' }, () => '')
    const answers = await decided.decide!({ text: 'piece' }, [{ key: 'a', instructions: 'is it?' }])
    expect([...answers]).toEqual([['a', 0.9]])
    expect(service.decide).toHaveBeenCalledWith({ text: 'piece' }, { a: { type: 'noul', instructions: 'is it?' } }, expect.objectContaining({ priority: 'background' }))
  })

  it('fails the question, so that the survey says why, when none is loaded', async () => {
    const bare = { signal: new AbortController().signal, agent: { ctx: { get: () => undefined } } } as never
    await expect(contextOf(bare, { ...settings(), decisions: 'decision' }, () => '').decide!({}, [])).rejects.toThrow(/no decision service/)
  })
})

describe('the build, which is slow', () => {
  it('runs twice in a turn at most, then the agent is told to stop and report', async () => {
    const turns = [{ type: 'turn/start', data: { turn: 3 } }]
    const exec = { agent: { session: { id: chat, snapshotEvents: () => turns } }, signal: new AbortController().signal } as never
    await markReady(directory)
    await writeFile(join(directory, IMPORT_FOLDER, 'state.json'), JSON.stringify({ phase: 'ready' }))
    const build = importTools(worlds, settings, prompting).find(tool => tool.name === 'import_build')!
    const attempt = () => build.execute({ card: '.import/card.json' } as never, exec)
    await expect(attempt()).rejects.toThrow(/cannot run now/)
    await expect(attempt()).rejects.toThrow(/cannot run now/)
    await expect(attempt()).rejects.toThrow(/has already run 2 times in this turn/)
    turns[0] = { type: 'turn/start', data: { turn: 4 } }
    await expect(attempt()).rejects.toThrow(/cannot run now/)
  })
})
