import { describe, expect, it, vi } from 'vitest'
import { checkCommands } from '../../../src/host/checks/commands.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { CHECK_COMMANDS } from '../../../src/shared/checks.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'

describe('the notice of a check command', () => {
  it('is written in each shipped language, naming the tool and the command', () => {
    for (const language of ['en', 'zh']) expect(shippedText('checks/notice', language, { command: '/check', tools: 'check_world', request: '-' })).toMatch(/check_world/)
  })
})

describe('the check commands', () => {
  const prompting = { prompts: () => ({ text: (id: string, language: string | undefined, variables?: Record<string, string | number>) => shippedText(id, language ?? 'en', variables) }), languages: () => ({ get: () => 'en' }) } as never
  /** A context with the command registry DSH would have: whatever is registered, by name. */
  const registered = new Map<string, { description: string; input: { hint: string }; recordInput?: boolean; handler: (call: unknown) => { kind: string; text?: string } }>()
  const scope = { commands: { register: (definition: { name: string; description: string; input: { hint: string }; recordInput?: boolean; handler: never }) => { registered.set(definition.name, definition); return () => undefined } }, effect: (run: () => unknown) => { run() } }
  checkCommands({ inject: (_names: string[], run: (scope: unknown) => void) => { run(scope) } } as never, prompting)
  const agentIn = (id: string, origin?: 'subagent') => { const followup = vi.fn(); return { agent: { session: { id, header: { ...(origin === undefined ? {} : { origin }) } }, followup }, followup } }
  const chat = authoringChatSessionId('w1')
  const run = (name: string, rawInput: string, who = agentIn(chat)) => ({ result: registered.get(name)!.handler({ agent: who.agent, rawInput, signal: new AbortController().signal }), who })
  const sentOf = (who: ReturnType<typeof agentIn>): { text: string; source: string } => { const message = who.followup.mock.calls[0]![0] as { content: { text: string }[]; source: { kind: string } }; return { text: message.content[0]!.text, source: message.source.kind } }

  it('are all listed with the interface, each with a description and a hint', () => {
    expect([...registered.keys()].sort()).toEqual(Object.keys(CHECK_COMMANDS).sort())
    for (const entry of registered.values()) {
      expect(entry.description !== '' && entry.input.hint !== '').toBe(true)
      expect(entry.recordInput).toBe(false)
    }
  })

  it('tell the assistant which tools to run for the kits the command names, and pass on what the person added', () => {
    const all = run('check', ' deep please')
    expect(all.result).toMatchObject({ kind: 'success' })
    expect(sentOf(all.who).text).toMatch(/check_world, check_card, check_quality, check_play/)
    expect(sentOf(all.who).text).toMatch(/deep please/)
    expect(sentOf(all.who).source).toBe('roleplay')
    expect(sentOf(run('check-card', '').who).text).toMatch(/check_card now/)
    expect(sentOf(run('check-quality', '').who).text).toMatch(/check_quality now/)
  })

  it('refuse in any chat that is not a world\'s authoring chat, and for a child, and start nothing there', () => {
    const elsewhere = run('check', '', agentIn('session-abc'))
    expect(elsewhere.result).toMatchObject({ kind: 'error' })
    expect(elsewhere.who.followup).not.toHaveBeenCalled()
    const child = run('check', '', agentIn(chat, 'subagent'))
    expect(child.result).toMatchObject({ kind: 'error' })
    expect(child.who.followup).not.toHaveBeenCalled()
  })
})
