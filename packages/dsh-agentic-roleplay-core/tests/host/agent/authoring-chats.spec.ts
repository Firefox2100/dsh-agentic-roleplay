import { describe, expect, it } from 'vitest'
import { AuthoringSessions, AUTHORING_AGENT_PRESET, AUTHORING_PROJECT_TITLE } from '../../../src/host/agent/authoring-sessions.ts'
import { LOREBOOK_AUTHORING_PRESET, LOREBOOK_AUTHORING_PROJECT_TITLE, LorebookAuthoringSessions } from '../../../src/host/agent/lorebook-authoring-sessions.ts'
import { PRESET_AUTHORING_PRESET, PRESET_AUTHORING_PROJECT_TITLE, PresetAuthoringSessions } from '../../../src/host/agent/preset-authoring-sessions.ts'
import type { AgentServices } from '../../../src/host/agent/agent-sessions.ts'
import type { PromptLibrary } from '../../../src/host/prompts/library.ts'
import type { AuthoringLanguages } from '../../../src/host/worlds/authoring-language.ts'

const languagesOf = (): AuthoringLanguages => { const kept = new Map<string, string>(); return { set: (key: string, value?: string) => { if (value !== undefined) kept.set(key, value) }, get: (key: string) => kept.get(key) ?? 'en' } as unknown as AuthoringLanguages }

function fakes(known: string[] = []) {
  const calls: unknown[][] = []
  const services: AgentServices = {
    persistence: {
      stat: () => Promise.resolve(undefined),
      create: (header: { id: string; cwd: string; agentPreset: string }) => { calls.push(['store', header.id, header.cwd, header.agentPreset]); return Promise.resolve({ append: () => Promise.resolve(), flush: () => Promise.resolve(), close: () => Promise.resolve() } as never) },
    } as never,
    registry: {
      create: (path: string, title: string) => { calls.push(['project', path, title]); return Promise.resolve({ id: 'p', path: `${path}/canonical`, sessionIds: known, attachSession: (id: string) => { calls.push(['attach', id]); return Promise.resolve() } } as never) },
      archiveSession: () => Promise.resolve(),
      unarchiveSession: () => Promise.resolve(),
    } as never,
    controller: {
      create: (request: { sessionId: string }) => { calls.push(['session', request]); return Promise.resolve({ sessionId: request.sessionId }) },
      rename: (request: unknown) => { calls.push(['rename', request]); return Promise.resolve({}) },
      prompt: () => Promise.resolve({}),
    } as never,
  }
  return { calls, services }
}

const prompts = { text: (id: string, language: string | undefined, variables: Record<string, string>) => `${id}|${language}|${JSON.stringify(variables)}` } as unknown as PromptLibrary

describe('the authoring chats of a world, a preset and a lorebook', () => {
  it('are made in the project of their kind, with the language kept and the opening stored first, and named after the subject', async () => {
    for (const [make, folder, project, preset, title, welcome] of [
      [(s: AgentServices, l: AuthoringLanguages) => new AuthoringSessions(() => s, () => '/root', prompts, l).ensure('w1', 'Harbour', undefined, 'zh'), 'worlds', AUTHORING_PROJECT_TITLE, AUTHORING_AGENT_PRESET, '创作 Harbour', 'world/welcome|zh|{"world":"Harbour"}'],
      [(s: AgentServices, l: AuthoringLanguages) => new PresetAuthoringSessions(() => s, () => '/root', prompts, l).ensure('quiet', 'Quiet', 'zh'), 'presets', PRESET_AUTHORING_PROJECT_TITLE, PRESET_AUTHORING_PRESET, 'Preset Quiet', 'preset/welcome|zh|{"preset":"Quiet"}'],
      [(s: AgentServices, l: AuthoringLanguages) => new LorebookAuthoringSessions(() => s, () => '/root', prompts, l).ensure('river', 'River', 'zh'), 'lorebooks', LOREBOOK_AUTHORING_PROJECT_TITLE, LOREBOOK_AUTHORING_PRESET, 'Lorebook River', 'lorebook/welcome|zh|{"lorebook":"River"}'],
    ] as const) {
      const { calls, services } = fakes()
      const languages = languagesOf()
      const chat = await make(services, languages)
      expect(calls[0]).toEqual(['project', `/root/${folder}`, project])
      expect(calls[1]).toEqual(['store', chat, `/root/${folder}/canonical`, preset])
      expect(calls.find(call => call[0] === 'session')?.[1]).toMatchObject({ sessionId: chat, agentPreset: preset })
      expect(calls.find(call => call[0] === 'rename')?.[1]).toEqual({ sessionId: chat, title })
      expect(welcome).toContain('|zh|')
    }
  })

  it('reopen a chat that exists without storing its opening again', async () => {
    const { calls, services } = fakes(['x'])
    const sessions = new PresetAuthoringSessions(() => services, () => '/root', prompts, languagesOf())
    const first = await sessions.ensure('quiet', 'Quiet', 'en')
    const { calls: again, services: known } = fakes([first])
    await new PresetAuthoringSessions(() => known, () => '/root', prompts, languagesOf()).ensure('quiet', 'Quiet', 'en')
    expect(again.map(call => call[0])).not.toContain('store')
    expect(calls.length).toBeGreaterThan(0)
  })
})
