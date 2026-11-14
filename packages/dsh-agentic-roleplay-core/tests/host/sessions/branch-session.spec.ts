import { describe, expect, it } from 'vitest'
import { branchSession, type BranchDeps } from '../../../src/host/sessions/branch-session.ts'
import { AgentUnavailableError, SessionNotFoundError } from '../../../src/host/sessions/errors.ts'

const CHAT = 'session-5a28d803-4295-4688-9580-5ae2f8a453c7'
const PARENT = 'session-0b6f2f0e-6c1f-4a7e-9d5f-1f2a3b4c5d6e'
const ID = '5a28d803-4295-4688-9580-5ae2f8a453c7'
const AGENT = { name: 'the agent of the forked chat' }

interface Calls {
  adopted: { chat: string; parent: string; atSeq: number; agent: unknown }[]
  discarded: string[]
}

function deps(overrides: Partial<{ adopt: BranchDeps<typeof AGENT>['timelines']; agent: typeof AGENT | undefined }> = {}): { deps: BranchDeps<typeof AGENT>; calls: Calls } {
  const calls: Calls = { adopted: [], discarded: [] }
  const timelines = 'adopt' in overrides
    ? overrides.adopt
    : { adopt: async (chat: string, parent: string, atSeq: number, agent: unknown) => { calls.adopted.push({ chat, parent, atSeq, agent }) } }
  return {
    calls,
    deps: {
      timelines,
      agentOf: () => ('agent' in overrides ? overrides.agent : AGENT),
      discard: async (chat: string) => { calls.discarded.push(chat) },
    },
  }
}

describe('branchSession', () => {
  it('adopts the story of the parent into the chat DSH forked', async () => {
    const { deps: given, calls } = deps()
    await expect(branchSession(given, CHAT, PARENT, 7)).resolves.toEqual({ id: ID })
    expect(calls.adopted).toEqual([{ chat: CHAT, parent: PARENT, atSeq: 7, agent: AGENT }])
    expect(calls.discarded).toEqual([])
  })

  it('refuses chats that are not both chats of stories', async () => {
    const { deps: given, calls } = deps()
    await expect(branchSession(given, 'chat-of-my-own', PARENT, 3)).rejects.toBeInstanceOf(SessionNotFoundError)
    expect(calls.discarded).toEqual([])
  })

  it('leaves the forked copy alone when the agent is not running, so the branch can be tried again', async () => {
    const { deps: given, calls } = deps({ agent: undefined })
    await expect(branchSession(given, CHAT, PARENT, 3)).rejects.toBeInstanceOf(AgentUnavailableError)
    expect(calls.discarded).toEqual([])
  })

  it('leaves the forked copy alone when there is no orchestration to adopt it', async () => {
    const { deps: given, calls } = deps({ adopt: undefined })
    await expect(branchSession(given, CHAT, PARENT, 3)).rejects.toBeInstanceOf(AgentUnavailableError)
    expect(calls.discarded).toEqual([])
  })

  it('discards the forked copy when the story cannot be adopted, and reports the real failure', async () => {
    const failure = new Error('the state was not kept')
    const { deps: given, calls } = deps({ adopt: { adopt: async () => { throw failure } } })
    await expect(branchSession(given, CHAT, PARENT, 3)).rejects.toBe(failure)
    expect(calls.discarded).toEqual([CHAT])
  })

  it('still reports the real failure when the copy cannot be discarded', async () => {
    const failure = new Error('the state was not kept')
    const { deps: given } = deps({ adopt: { adopt: async () => { throw failure } } })
    given.discard = async () => { throw new Error('the chat could not be deleted completely (: the folder is busy)') }
    await expect(branchSession(given, CHAT, PARENT, 3)).rejects.toBe(failure)
  })
})
