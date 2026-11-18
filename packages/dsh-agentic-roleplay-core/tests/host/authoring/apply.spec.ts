import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../../src/authoring.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import type { Context } from '@deepseek-ai/cordis'

/** A stand-in for the services and registries the world-authoring preset writes into. */
function made(meter?: { estimateMessage: (message: unknown) => number }) {
  const tools: { name: string }[] = []
  const skills: { name: string; description: string; invocation: { modelInvocable: boolean; userInvocable: boolean } }[] = []
  const sections: { name: string; order: number; text: unknown }[] = []
  const contexts: { name: string; order: number; text: unknown }[] = []
  const listeners = new Map<string, (first: never, second?: never) => unknown>()
  const turnEnded = vi.fn()
  const ctx = {
    systemPrompt: {
      section: (section: never) => { sections.push(section) },
      context: (context: never) => { contexts.push(context) },
      getSectionOrder: () => 10,
      getContextOrder: () => 20,
      suppressRuntimeContext: () => () => undefined,
    },
    tools: { register: (tool: { name: string }) => { tools.push(tool) } },
    on: (name: string, listener: (first: never, second?: never) => unknown) => { listeners.set(name, listener); return () => undefined },
    effect: (run: () => unknown) => run(),
    inject: (_names: string[], run: (scope: unknown) => unknown) => run({ commands: { register: () => () => undefined }, skills: { register: (skill: (typeof skills)[number]) => { skills.push(skill); return () => undefined } }, effect: (job: () => unknown) => { job() } }),
    get: (name: string) => (name === 'tokenMeter' ? meter : undefined),
    roleplayPrompts: { text: () => 'text' },
    roleplayAuthoringLanguages: { get: () => 'en', keepResultTurns: () => 0, toolHiding: () => 'card' },
    roleplayWorlds: { find: async () => undefined, list: async () => [] },
    roleplayAuthoringTools: {},
    roleplayCheckpoints: { list: async () => [] },
    roleplayImport: { settings: { maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 1000, variablesPerRequest: 25, structured: 'tool', temperature: 0.2, timeoutMinutes: 0, decisions: 'llm', confidence: 0.7, approval: 'ask' }, state: { importing: new Map(), objections: new Map(), repairs: new Map() }, turnEnded },
  } as unknown as Context
  return { ctx, tools, skills, sections, contexts, listeners, turnEnded }
}

describe('the world-authoring preset', () => {
  it('asks for the services it writes through', () => {
    expect(inject).toEqual(['roleplayWorlds', 'roleplayImport', 'roleplayPrompts', 'roleplayAuthoringLanguages', 'roleplayAuthoringTools', 'roleplayCheckpoints', 'tools', 'systemPrompt'])
  })

  it('registers the tools of an authoring chat and the gates around them', () => {
    const { ctx, tools, listeners } = made()
    apply(ctx)
    expect(tools.length, 'the authoring chat gets the editing tools and the import tools').toBeGreaterThan(30)
    expect(tools.map(tool => tool.name)).toContain('list_world_checkpoints')
    expect([...listeners.keys()].sort()).toEqual(['agent/created', 'agent/pre-step', 'agent/turn-stopping', 'session/event', 'tools/pre-execute', 'tools/result'])
  })

  it('offers its format guides to the model through the skill registry, and to nobody as a command', () => {
    const { ctx, skills } = made()
    apply(ctx)
    expect(skills.map(skill => skill.name)).toEqual(expect.arrayContaining(['world-lore', 'world-characters', 'world-triggers', 'world-where-things-go']))
    expect(skills.every(skill => skill.description !== '' && skill.invocation.modelInvocable && !skill.invocation.userInvocable)).toBe(true)
  })

  it('shadows the harness and the runtime facts of the profile it is loaded into', () => {
    const { ctx, sections, contexts } = made()
    apply(ctx)
    expect(sections.map(section => section.name)).toEqual(expect.arrayContaining(['WORLD_AUTHORING_PERSONA', 'WORLD_AUTHORING_PROCEDURE', 'harness:source', 'app:web-surface', 'ui:deliverable-file-references']))
    expect(contexts.map(context => context.name)).toEqual(expect.arrayContaining(['harness:source', 'app:web-surface', 'working-directory:current']))
    const persona = sections.find(section => section.name === 'WORLD_AUTHORING_PERSONA')
    expect(typeof persona?.text, 'the persona is asked for in the language of the chat').toBe('function')
  })

  it('trims the tool results of the turns before when a turn of an authoring chat starts', async () => {
    const chat = authoringChatSessionId('harbor')
    const estimateMessage = vi.fn(() => 7)
    const { ctx, listeners } = made({ estimateMessage })
    apply(ctx)
    const step = listeners.get('agent/pre-step')!
    const start = async (id: string, at: number, origin: 'user' | 'subagent' = 'user', kind = 'enter') => await (step as unknown as (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>)({ agent: { session: { id, header: { origin } } }, turn: 4, step: at }, async () => ({ kind }))
    expect(await start(chat, 1), 'the trim has to wait for the gate to let the step through').toEqual({ kind: 'enter' })
    expect(await start(chat, 2), 'the conversation is trimmed at the start of a turn, not at every step').toEqual({ kind: 'enter' })
    expect(await start(chat, 1, 'subagent'), 'a subagent has a conversation of its own').toEqual({ kind: 'enter' })
    expect(await start('session-00000000-0000-4000-8000-000000000000', 1), 'a chat that is not an authoring chat keeps its whole conversation').toEqual({ kind: 'enter' })
    expect(await start(chat, 1, 'user', 'skip'), 'a step that is not entered is left as the gate gave it').toEqual({ kind: 'skip' })
  })

  it('does not tell a chat of another world that its turn ended', async () => {
    const { ctx, listeners, turnEnded } = made()
    apply(ctx)
    const ended = listeners.get('session/event')!
    await ended({ id: 'session-00000000-0000-4000-8000-000000000000', header: { origin: 'user' } } as never, { type: 'turn/end' } as never)
    expect(turnEnded, 'a chat that is not the authoring chat of a world is left alone').not.toHaveBeenCalled()
  })
})
