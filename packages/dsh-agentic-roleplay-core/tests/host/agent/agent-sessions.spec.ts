import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESET, AgentSessions, PROJECT_TITLE, agentServicesOf, chatSessionId,
  type AgentServices,
} from '../../../src/host/agent/agent-sessions.ts'
import { AgentUnavailableError } from '../../../src/host/sessions/errors.ts'

function fakes(known: string[] = []) {
  const calls: unknown[][] = []
  const services: AgentServices = {
    persistence: {
      create: (header) => {
        calls.push(['store', header.id, header.cwd, header.agentPreset])
        return Promise.resolve({
          append: (events) => { calls.push(['store-events', events.map(event => event.type).join(',')]); return Promise.resolve() },
          flush: () => Promise.resolve(),
          close: () => Promise.resolve(),
        })
      },
    },
    registry: {
      create: (path, title) => { calls.push(['project', path, title]); return Promise.resolve({ id: 'project-1', path: `${path}/canonical`, sessionIds: known }) },
      archiveSession: (id, options) => { calls.push(['archive', id, options]); return Promise.resolve() },
      unarchiveSession: (id) => { calls.push(['unarchive', id]); return Promise.resolve() },
    },
    controller: {
      create: (request) => { calls.push(['session', request]); return Promise.resolve({ sessionId: request.sessionId }) },
      rename: (request) => { calls.push(['rename', request]); return Promise.resolve({}) },
    },
  }
  return { calls, services }
}

describe('chatSessionId', () => {
  it('is derived from the roleplay session id', () => {
    expect(chatSessionId('abc')).toBe('session-abc')
  })
})

describe('AgentSessions', () => {
  it('creates the chat in the one Roleplay project at the roleplay root', async () => {
    const { calls, services } = fakes()
    const agent = new AgentSessions(() => services, () => '/data/roleplay')
    expect(await agent.ensure('abc', 'Night one')).toBe('session-abc')
    expect(calls).toEqual([
      ['project', '/data/roleplay', PROJECT_TITLE],
      ['session', { workspaceId: 'project-1', sessionId: 'session-abc', agentPreset: AGENT_PRESET }],
      ['rename', { sessionId: 'session-abc', title: 'Night one' }],
    ])
  })

  it('stores the opening of a new chat before the chat is created, so the chat starts from it', async () => {
    const { calls, services } = fakes()
    await new AgentSessions(() => services, () => '/data/roleplay').ensure('abc', 'Night one', [{ type: 'narration', text: 'The lanterns sway.' }])
    expect(calls.map(call => call[0])).toEqual(['project', 'store', 'store-events', 'session', 'rename'])
    expect(calls[1]).toEqual(['store', 'session-abc', '/data/roleplay/canonical', AGENT_PRESET])
    expect(calls[2]).toEqual(['store-events', 'turn/start,step/start,assistant/message,tool/call,tool/result,step/end,turn/end'])
  })

  it('leaves a chat that exists as it is, opening or not', async () => {
    const { calls, services } = fakes(['session-abc'])
    await new AgentSessions(() => services, () => '/data').ensure('abc', 'Night one', [{ type: 'narration', text: 'The lanterns sway.' }])
    expect(calls.map(call => call[0])).toEqual(['project', 'session'])
  })

  it('refuses an opening it cannot store, and does not need storage without one', async () => {
    const { calls, services } = fakes()
    delete services.persistence
    const agent = new AgentSessions(() => services, () => '/data')
    await expect(agent.ensure('abc', 'x', [{ type: 'narration', text: 'Opening.' }])).rejects.toThrow(AgentUnavailableError)
    expect(calls.map(call => call[0])).toEqual(['project'])
    await expect(agent.ensure('def', 'x')).resolves.toBe('session-def')
  })

  it('names a chat that is new after the session, and leaves the name of one that exists', async () => {
    const existing = fakes(['session-abc'])
    await new AgentSessions(() => existing.services, () => '/data').ensure('abc', 'Night one')
    expect(existing.calls.map(call => call[0])).toEqual(['project', 'session'])
  })

  it('follows a moved roleplay root', async () => {
    const { calls, services } = fakes()
    let root = '/one'
    const agent = new AgentSessions(() => services, () => root)
    await agent.ensure('abc', 'x')
    root = '/two'
    await agent.ensure('abc', 'x')
    expect(calls.filter(call => call[0] === 'project').map(call => call[1])).toEqual(['/one', '/two'])
  })

  it('archives the chat and stops its work when retiring', async () => {
    const { calls, services } = fakes()
    await new AgentSessions(() => services, () => '/data').retire('abc')
    expect(calls).toEqual([['archive', 'session-abc', { stopActivity: true }]])
  })

  it('treats a chat that was never created as already retired, but not other failures', async () => {
    const { services } = fakes()
    const unknown = Object.assign(new Error('unknown session'), { name: 'WorkspaceUnknownSessionError' })
    services.registry.archiveSession = () => Promise.reject(unknown)
    const agent = new AgentSessions(() => services, () => '/data')
    await expect(agent.retire('abc')).resolves.toBeUndefined()
    services.registry.archiveSession = () => Promise.reject(new Error('disk full'))
    await expect(agent.retire('abc')).rejects.toThrow('disk full')
  })

  it('propagates a failure to create the chat', async () => {
    const { services } = fakes()
    services.controller.create = () => Promise.reject(new Error('refused'))
    await expect(new AgentSessions(() => services, () => '/data').ensure('abc', 'x')).rejects.toThrow('refused')
  })
})

describe('agentServicesOf', () => {
  it('reports a profile without the session services', () => {
    expect(() => agentServicesOf(new Context())()).toThrow(AgentUnavailableError)
  })
})
