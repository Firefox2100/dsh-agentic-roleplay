import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PRESET, AgentSessions, PROJECT_TITLE, agentServicesOf, chatSessionId,
  type AgentServices,
} from '../../../src/host/agent/agent-sessions.ts'
import { AgentUnavailableError } from '../../../src/host/sessions/errors.ts'

function fakes() {
  const calls: unknown[][] = []
  const services: AgentServices = {
    registry: {
      create: (path, title) => { calls.push(['project', path, title]); return Promise.resolve({ id: 'project-1' }) },
      archiveSession: (id, options) => { calls.push(['archive', id, options]); return Promise.resolve() },
    },
    controller: {
      create: (request) => { calls.push(['session', request]); return Promise.resolve({ sessionId: request.sessionId }) },
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
    expect(await agent.ensure('abc')).toBe('session-abc')
    expect(calls).toEqual([
      ['project', '/data/roleplay', PROJECT_TITLE],
      ['session', { workspaceId: 'project-1', sessionId: 'session-abc', agentPreset: AGENT_PRESET }],
    ])
  })

  it('follows a moved roleplay root', async () => {
    const { calls, services } = fakes()
    let root = '/one'
    const agent = new AgentSessions(() => services, () => root)
    await agent.ensure('abc')
    root = '/two'
    await agent.ensure('abc')
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
    await expect(new AgentSessions(() => services, () => '/data').ensure('abc')).rejects.toThrow('refused')
  })
})

describe('agentServicesOf', () => {
  it('reports a profile without the session services', () => {
    expect(() => agentServicesOf(new Context())()).toThrow(AgentUnavailableError)
  })
})
