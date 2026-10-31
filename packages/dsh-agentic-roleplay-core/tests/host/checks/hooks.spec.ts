import { describe, expect, it } from 'vitest'
import { checkHooks } from '../../../src/host/checks/hooks.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { parseAuthoringCommand } from '../../../src/shared/authoring-commands.ts'
import { CHECK_COMMANDS } from '../../../src/shared/checks.ts'
import { parseImportCommand } from '../../../src/shared/import-card.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'

describe('commands of an authoring chat', () => {
  const names = Object.keys(CHECK_COMMANDS)

  it('are read from the start of a message, by whole word', () => {
    expect(parseAuthoringCommand('  /check-world please', names)).toEqual({ name: 'check-world', rest: 'please' })
    expect(parseAuthoringCommand('/CHECK', names)).toEqual({ name: 'check', rest: '' })
    expect(parseAuthoringCommand('/checkout', names)).toBeUndefined()
    expect(parseAuthoringCommand('run /check', names)).toBeUndefined()
  })

  it('still read the import command with its card', () => {
    expect(parseImportCommand('/import-st .import/card.json make it dark')).toEqual({ card: '.import/card.json', request: 'make it dark' })
    expect(parseImportCommand('/import-stx')).toBeUndefined()
  })

  it('have a notice in each shipped language that names the tool and the command', () => {
    for (const language of ['en', 'zh']) expect(shippedText('checks/notice', language, { command: '/check', tools: 'check_world', request: '-' })).toMatch(/check_world/)
  })
})

describe('the check commands in a chat', () => {
  const prompting = { prompts: () => ({ text: (id: string, language: string | undefined, variables?: Record<string, string | number>) => shippedText(id, language ?? 'en', variables) }), languages: () => ({ get: () => 'en' }) } as never
  const listeners: Record<string, unknown> = {}
  checkHooks({ on: (name: string, listener: unknown) => { listeners[name] = listener } } as never, prompting)
  const agent = (id: string, origin?: 'subagent') => ({ session: { id, header: { ...(origin === undefined ? {} : { origin }) } } })
  const step = (who: unknown, text: string, number = 1) => (listeners['agent/pre-step'] as (payload: unknown, next: () => Promise<unknown>) => Promise<{ messages: { content: { text: string }[] }[] }>)(
    { agent: who, step: number, turn: 1, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }] }, () => Promise.resolve({ kind: 'enter', messages: [] }))
  const chat = authoringChatSessionId('w1')

  it('tell the assistant which tools to run for the kits the command names, and pass on what the person added', async () => {
    const all = (await step(agent(chat), '/check deep please')).messages[0]!.content[0]!.text
    expect(all).toMatch(/check_world, check_card, check_quality, check_play/)
    expect(all).toMatch(/deep please/)
    expect((await step(agent(chat), '/check-card')).messages[0]!.content[0]!.text).toMatch(/check_card now/)
    expect((await step(agent(chat), '/check-quality')).messages[0]!.content[0]!.text).toMatch(/check_quality now/)
  })

  it('leave other messages, later steps, other chats and children alone', async () => {
    expect((await step(agent(chat), 'Add a tavern.')).messages).toEqual([])
    expect((await step(agent(chat), '/check', 2)).messages).toEqual([])
    expect((await step(agent('session-abc'), '/check')).messages).toEqual([])
    expect((await step(agent(chat, 'subagent'), '/check')).messages).toEqual([])
  })
})
