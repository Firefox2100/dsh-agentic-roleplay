import { describe, expect, it } from 'vitest'
import { DOCTOR_AGENT_PRESET, DOCTOR_PROJECT_TITLE, DoctorSessions } from '../../../src/host/agent/doctor-sessions.ts'
import type { AgentServices } from '../../../src/host/agent/agent-sessions.ts'
import type { PromptLibrary } from '../../../src/host/prompts/library.ts'
import { doctorApproval } from '../../../src/doctor.ts'
import { doctorChatSessionId, doctorSessionOf } from '../../../src/shared/doctor-chat.ts'
import { chatSessionId, roleplaySessionOf } from '../../../src/shared/chat.ts'

const ID = '3f1c1d6e-6f6b-4f55-9d0f-0d6a1c2b3a4d'

function fakes(known: string[] = []) {
  const calls: unknown[][] = []
  const services: AgentServices = {
    persistence: {
      stat: () => Promise.resolve(undefined),
      create: header => { calls.push(['store', header.id, header.cwd, header.agentPreset]); return Promise.resolve({ append: () => Promise.resolve(), flush: () => Promise.resolve(), close: () => Promise.resolve() }) },
    },
    registry: {
      create: (path, title) => { calls.push(['project', path, title]); return Promise.resolve({ id: 'p', path: `${path}/canonical`, sessionIds: known, attachSession: (id) => { calls.push(['attach', id]); return Promise.resolve() } }) },
      archiveSession: () => Promise.resolve(),
      unarchiveSession: () => Promise.resolve(),
    },
    controller: {
      create: request => { calls.push(['session', request]); return Promise.resolve({ sessionId: request.sessionId }) },
      rename: request => { calls.push(['rename', request]); return Promise.resolve({}) },
      prompt: () => Promise.resolve({}),
    },
  }
  return { calls, services }
}

const prompts = { text: (id: string, language: string, variables: Record<string, string>) => `${id}/${language}/${variables['session']}` } as unknown as PromptLibrary

describe('the chat of a session doctor', () => {
  it('is named after the session and is never taken for the story\'s own chat', () => {
    expect(doctorChatSessionId(ID)).toBe(`doctor-${ID}`)
    expect(doctorSessionOf(`doctor-${ID}`)).toBe(ID)
    expect(doctorSessionOf(`doctor-x`)).toBeUndefined()
    expect(doctorSessionOf(chatSessionId(ID))).toBeUndefined()
    expect(roleplaySessionOf(doctorChatSessionId(ID))).toBeUndefined()
  })

  it('is created in its own project with the story\'s name in its opening, and named once', async () => {
    const { calls, services } = fakes()
    const chat = await new DoctorSessions(() => services, () => '/root', prompts).ensure({ id: ID, name: 'Night one' }, 'Doctor: Night one', 'zh')
    expect(chat).toBe(`doctor-${ID}`)
    expect(calls).toEqual([
      ['project', '/root/sessions', DOCTOR_PROJECT_TITLE],
      ['store', `doctor-${ID}`, '/root/sessions/canonical', DOCTOR_AGENT_PRESET],
      ['session', { workspaceId: 'p', sessionId: `doctor-${ID}`, agentPreset: DOCTOR_AGENT_PRESET }],
      ['rename', { sessionId: `doctor-${ID}`, title: 'Doctor: Night one' }],
    ])
  })

  it('reopens a chat that exists without storing its opening again or renaming it', async () => {
    const { calls, services } = fakes([`doctor-${ID}`])
    await new DoctorSessions(() => services, () => '/root', prompts).ensure({ id: ID, name: 'Night one' }, 'Doctor', 'en')
    expect(calls.map(call => call[0])).toEqual(['project'])
  })
})

describe('what the person approves', () => {
  const exec = (chat: string, name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { id: chat } } }) as never

  it('is every edit of a doctor chat, shown as it will be applied and without the turn the tool sets itself', () => {
    const decision = doctorApproval(exec(doctorChatSessionId(ID), 'edit_records', { turn: 9, relationships: [{ from: 'a', to: 'b' }] }))
    expect(decision).toMatchObject({ kind: 'ask' })
    expect((decision as { reason: string }).reason).toContain('"relationships"')
    expect((decision as { reason: string }).reason).not.toContain('"turn"')
  })

  it('refuses an edit that changes nothing instead of asking about it', () => {
    expect(doctorApproval(exec(doctorChatSessionId(ID), 'edit_records', { turn: 0 }))).toMatchObject({ kind: 'deny' })
  })

  it('leaves the record keeper\'s own edits and other tools alone', () => {
    expect(doctorApproval(exec(chatSessionId(ID), 'edit_records', {}))).toBeUndefined()
    expect(doctorApproval(exec(doctorChatSessionId(ID), 'read_records', {}))).toBeUndefined()
  })
})
