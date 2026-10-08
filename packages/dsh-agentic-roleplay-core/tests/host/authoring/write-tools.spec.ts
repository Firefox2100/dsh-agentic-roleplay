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

  it('does not intercept reads or calls outside authoring chats', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(authoringApproval(exec('list_characters'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(authoringApproval(exec('delete_world_element', 'ordinary-chat'), next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })
})
