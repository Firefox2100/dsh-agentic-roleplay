import { describe, expect, it, vi } from 'vitest'
import { authoringApproval } from '../../../src/host/authoring/write-tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'

const exec = (name: string, chat = authoringChatSessionId('harbor'), args: Record<string, unknown> = {}) => ({ name, arguments: args, agent: { session: { id: chat } } }) as never

describe('world authoring approval gate', () => {
  it('asks once for every mutation in an authoring chat', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('delete_world_element', undefined, { kind: 'character', key: 'clara' }), next)).resolves.toMatchObject({
      kind: 'ask', reason: 'delete authored world character “clara”', displayReason: { en: 'Delete character “clara” in the world files?' },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('asks before a trigger is written or removed', async () => {
    const next = vi.fn()
    await expect(authoringApproval(exec('write_world_trigger', undefined, { key: 'knock', document: {} }), next)).resolves.toMatchObject({ kind: 'ask', reason: 'write authored world trigger “knock”', displayReason: { en: 'Write trigger “knock” in the world files?', zh: '写入世界文件中的trigger “knock”？' } })
    await expect(authoringApproval(exec('delete_world_trigger', undefined, { key: 'knock' }), next)).resolves.toMatchObject({ kind: 'ask', reason: 'delete authored world trigger “knock”' })
    expect(next).not.toHaveBeenCalled()
  })

  it('does not intercept reads or calls outside authoring chats', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(authoringApproval(exec('list_characters'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(authoringApproval(exec('delete_world_element', 'ordinary-chat'), next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('lets the turn that has just imported a card correct the world without asking', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(authoringApproval(exec('replace_world_element', undefined, { kind: 'location', key: 'dock' }), next, () => Promise.resolve(true))).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })
})
