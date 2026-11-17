import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../../src/authoring.ts'
import type { Context } from '@deepseek-ai/cordis'

/** A stand-in for the services and registries the world-authoring preset writes into. */
function made() {
  const tools: { name: string }[] = []
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
    inject: (_names: string[], run: (scope: unknown) => unknown) => run({ commands: { register: () => () => undefined }, effect: (job: () => unknown) => { job() } }),
    get: () => undefined,
    roleplayPrompts: { text: () => 'text' },
    roleplayAuthoringLanguages: { get: () => 'en' },
    roleplayWorlds: { find: async () => undefined, list: async () => [] },
    roleplayAuthoringTools: {},
    roleplayCheckpoints: { list: async () => [] },
    roleplayImport: { settings: { maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 1000, variablesPerRequest: 25, structured: 'tool', temperature: 0.2, timeoutMinutes: 0, decisions: 'llm', confidence: 0.7, approval: 'ask' }, state: { importing: new Map(), objections: new Map(), repairs: new Map() }, turnEnded },
  } as unknown as Context
  return { ctx, tools, sections, contexts, listeners, turnEnded }
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

  it('shadows the harness and the runtime facts of the profile it is loaded into', () => {
    const { ctx, sections, contexts } = made()
    apply(ctx)
    expect(sections.map(section => section.name)).toEqual(expect.arrayContaining(['WORLD_AUTHORING_PERSONA', 'WORLD_AUTHORING_PROCEDURE', 'harness:source', 'app:web-surface']))
    expect(contexts.map(context => context.name)).toEqual(expect.arrayContaining(['harness:source', 'app:web-surface', 'working-directory:current']))
    const persona = sections.find(section => section.name === 'WORLD_AUTHORING_PERSONA')
    expect(typeof persona?.text, 'the persona is asked for in the language of the chat').toBe('function')
  })

  it('does not tell a chat of another world that its turn ended', async () => {
    const { ctx, listeners, turnEnded } = made()
    apply(ctx)
    const ended = listeners.get('session/event')!
    await ended({ id: 'session-00000000-0000-4000-8000-000000000000', header: { origin: 'user' } } as never, { type: 'turn/end' } as never)
    expect(turnEnded, 'a chat that is not the authoring chat of a world is left alone').not.toHaveBeenCalled()
  })
})
