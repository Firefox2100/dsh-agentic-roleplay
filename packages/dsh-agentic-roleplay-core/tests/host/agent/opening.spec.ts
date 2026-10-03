import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openingEvents, storeOpening, type SessionPersistenceLike } from '../../../src/host/agent/opening.ts'
import { decodeOutput, type NarrationSegment } from '../../../src/shared/narration.ts'
import { mountAgentServices } from '../../support/mount.ts'
import { ScriptedAdapter } from '../../support/scripted-adapter.ts'

const OPENING: NarrationSegment[] = [
  { type: 'narration', text: 'The festival lanterns sway as you reach the inn.' },
  { type: 'utterance', character: 'clara', name: 'Clara', text: 'You are late, Mr. Moore.' },
  { type: 'narration', text: 'She does not look up from the bar.' },
]
const textOf = (content: readonly { type: string; text?: string }[]) => content.flatMap(block => (block.text === undefined ? [] : [block.text])).join('')

describe('the events of an opening', () => {
  const events = openingEvents(OPENING)

  it('are a finished first turn in which the output was delivered the way every turn delivers it', () => {
    expect(events.map(event => event.type)).toEqual(['turn/start', 'step/start', 'assistant/message', 'tool/call', 'tool/result', 'step/end', 'turn/end'])
    expect(events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    expect(events[3]).toMatchObject({ type: 'tool/call', data: { name: 'narrate', callId: 'opening-narrate' } })
    const sent = JSON.parse((events[3]!.data as { arguments: string }).arguments) as { segments: unknown[] }
    expect(sent.segments).toEqual([
      { type: 'narration', text: 'The festival lanterns sway as you reach the inn.' },
      { type: 'utterance', character: 'clara', text: 'You are late, Mr. Moore.' },
      { type: 'narration', text: 'She does not look up from the bar.' },
    ])
  })

  it('carry the output in the result, where the client reads every output from', () => {
    const result = events.find(event => event.type === 'tool/result')!
    const text = textOf((result.data as unknown as { message: { content: { type: string; text?: string }[] } }).message.content)
    expect(decodeOutput(text)).toEqual({ segments: OPENING, repaired: false })
  })
})

describe('storing a chat with its opening', () => {
  function fakePersistence(failOn?: 'append') {
    const log: string[] = []
    const stored: { header?: SessionHeader; events: readonly SessionEvent[] } = { events: [] }
    const persistence: SessionPersistenceLike = {
      create: (header) => {
        log.push('create')
        stored.header = header
        return Promise.resolve({
          append: (events) => { log.push('append'); stored.events = events; return failOn === 'append' ? Promise.reject(new Error('disk full')) : Promise.resolve() },
          flush: () => { log.push('flush'); return Promise.resolve() },
          close: () => { log.push('close'); return Promise.resolve() },
        })
      },
    }
    return { persistence, log, stored }
  }

  it('writes the header and the events, makes them durable and lets go of the session', async () => {
    const { persistence, log, stored } = fakePersistence()
    await storeOpening(persistence, { id: 'session-abc', cwd: '/data/roleplay', agentPreset: 'roleplay' }, OPENING)
    expect(log).toEqual(['create', 'append', 'flush', 'close'])
    expect(stored.header).toMatchObject({ version: 4, id: 'session-abc', cwd: '/data/roleplay', isSeeded: false, agentPreset: 'roleplay' })
    expect(stored.events.map(event => event.type)).toEqual(['turn/start', 'step/start', 'assistant/message', 'tool/call', 'tool/result', 'step/end', 'turn/end'])
  })

  it('lets go of the session when writing fails', async () => {
    const { persistence, log } = fakePersistence('append')
    await expect(storeOpening(persistence, { id: 'session-abc', cwd: '/data', agentPreset: 'roleplay' }, OPENING)).rejects.toThrow('disk full')
    expect(log.at(-1)).toBe('close')
  })
})

describe('an agent that starts from an opening', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = new Context()
    await mountAgentServices(ctx)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionInvariant)
    await ctx.plugin(AgentInvariant)
    await ctx.plugin(AgentLoopInvariant)
    await ctx.plugin(AgentLoop, { agents: [] })
  })
  afterEach(async () => { await ctx.fiber.dispose() })

  const reply = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'ok' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] as const

  it('has the opening in its history without asking a model, and the player\'s message is turn two', async () => {
    const adapter = new ScriptedAdapter(() => [...reply])
    ctx.llm.registerAdapter(['mock'], adapter)
    const { agent } = await ctx.agents.create({ sessionId: SessionId('opened-chat'), seed: openingEvents(OPENING), agentOptions: { provider: 'mock', model: 'mock' } })
    expect(adapter.requests).toHaveLength(0)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'I go in.' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const conversation = adapter.requests[0]!.messages.filter(message => message.role !== 'system')
    expect(conversation.map(message => message.role)).toEqual(['assistant', 'tool', 'user'])
    expect(JSON.stringify(conversation[0]!.content)).toContain('You are late, Mr. Moore.')
    expect(textOf(conversation[1]!.content)).toContain('delivered to the player')
    const turns = agent.session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => (event.data as { turn: number }).turn)
    expect(turns).toEqual([1, 2])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(2)
  })
})
