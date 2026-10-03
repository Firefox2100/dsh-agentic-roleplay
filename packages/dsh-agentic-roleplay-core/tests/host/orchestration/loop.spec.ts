import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, sessionFolder, type Session } from 'dsh-roleplay-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RoleplayOrchestration } from '../../../src/host/orchestration/service.ts'
import { writeSettings } from '../../../src/host/sessions/settings.ts'
import { decodeOutput } from '../../../src/shared/narration.ts'
import * as orchestrationPlugin from '../../../src/orchestration.ts'
import { mountAgentServices } from '../../support/mount.ts'
import { ScriptedAdapter } from '../../support/scripted-adapter.ts'

let root: string
let ctx: Context
let state: RoleplayState
let orchestration: RoleplayOrchestration

const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (id: string, name: string, args: object): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]

const systemOf = (request: GenerateOptions): string => {
  const head = request.messages[0]
  return head?.role === 'system' ? head.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('') : ''
}
const toolNames = (request: GenerateOptions): string[] => (request.tools ?? []).map(tool => tool.name)
const asText = (request: GenerateOptions): string => JSON.stringify(request.messages)

/** What the game master has done since the player last spoke. */
function thisTurn(request: GenerateOptions): string {
  const index = request.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
  return JSON.stringify(request.messages.slice(Math.max(index, 0)))
}
const timesCalled = (request: GenerateOptions, tool: string): number => (thisTurn(request).match(new RegExp(`"name":"${tool}"`, 'g')) ?? []).length

const intents: Record<string, { intent: string; utterance?: string; commitment: string }> = {
  Alice: { intent: 'Alice takes the lantern', utterance: 'That is not something I expected.', commitment: 'medium' },
  Bob: { intent: 'Bob takes the key', commitment: 'high' },
  Carol: { intent: 'Carol takes the key', utterance: 'Oh, please.', commitment: 'low' },
  Dan: { intent: 'Dan takes the key', utterance: 'Mine!', commitment: 'high' },
}

const round1 = [
  { character: 'alice', result: 'succeeded', summary: 'Alice takes the lantern' },
  { character: 'bob', result: 'succeeded', summary: 'Bob takes the key', public_state: 'holding a brass key' },
  { character: 'carol', result: 'failed', summary: 'Bob got there first' },
  { character: 'dan', result: 'failed', summary: 'Bob pushed Dan aside' },
]

const alice = { type: 'utterance', character: 'alice', text: 'That is not something I expected.' }
const carol = { type: 'utterance', character: 'carol', text: 'Oh, please.' }
const dan = { type: 'utterance', character: 'dan', text: 'Give it here!' }
const goodOutput = [
  alice,
  { type: 'narration', text: 'Alice stands and walks to the door while Bob stares at you.' },
  carol, dan,
  { type: 'narration', text: 'The key stays in Bob\'s hand.' },
]

interface Script {
  /** Finish before doing anything, until sent back. */
  early?: boolean
  /** How the game master delivers the output: well, with a changed utterance until corrected, with one it never corrects, not at all, or by leaving it to a narrator. */
  delivery?: 'good' | 'changed-once' | 'stubborn' | 'none' | 'narrator'
  /** Plays a second round of characters (Bob answering Alice) before delivering, when it is allowed. */
  twoRounds?: boolean
}

const aliceOnly = [{ character: 'alice', result: 'succeeded', summary: 'Alice greets him' }]
const bobOnly = [{ character: 'bob', result: 'succeeded', summary: 'Bob objects' }]
const alicesWords = { type: 'utterance', character: 'alice', text: 'That is not something I expected.' }
const bobsWords = { type: 'utterance', character: 'bob', text: 'Why is he here?' }

/** A game master that lets Bob answer Alice in a second round, and stops when it is told there are no more. */
function twoRounds(request: GenerateOptions, activated: number, resolved: number): StreamChunk[] {
  const turn = thisTurn(request)
  if (turn.includes('most this chat allows')) return call('m-stop', 'narrate', { segments: [alicesWords, { type: 'narration', text: 'Alice greets him.' }] })
  if (activated === 0) return call('m1', 'activate_characters', { situation: 'Arthur enters.', characters: ['alice'] })
  if (resolved === 0) return call('m2', 'resolve_round', { outcomes: aliceOnly })
  if (activated === 1) return call('m3', 'activate_characters', { situation: 'Alice has greeted Arthur.', characters: ['bob'] })
  if (resolved === 1) return call('m4', 'resolve_round', { outcomes: bobOnly })
  return call('m5', 'narrate', { segments: [alicesWords, { type: 'narration', text: 'Alice greets him; Bob frowns.' }, bobsWords] })
}

/** The game master, following the protocol, and characters answering from their own sheets. */
function answerFor(script: Script = {}) {
  return (request: GenerateOptions): StreamChunk[] => {
    const who = /You are (Alice|Bob|Carol|Dan)\./.exec(systemOf(request))?.[1]
    if (who !== undefined) {
      const retry = asText(request).includes('trying again')
      const later = asText(request).includes('Earlier in this scene')
      if (later && who === 'Bob') return call('s-Bob-later', STRUCTURED_OUTPUT_TOOL, { intent: 'Bob objects', utterance: 'Why is he here?', commitment: 'low' })
      return call(`s-${who}`, STRUCTURED_OUTPUT_TOOL, retry ? { intent: `${who} grabs the lantern instead`, utterance: 'Give it here!', commitment: 'medium' } : intents[who]!)
    }
    if (!toolNames(request).includes('activate_characters')) return text('a title')
    const activated = timesCalled(request, 'activate_characters')
    const resolved = timesCalled(request, 'resolve_round')
    const delivered = timesCalled(request, 'narrate')
    const objected = thisTurn(request).includes('You may not end the turn yet')
    if (script.early === true && !objected) return text('The scene is over, I think.')
    if (thisTurn(request).includes('input is refused')) return text('I cannot do that.')
    if (script.twoRounds === true) return twoRounds(request, activated, resolved)
    if (activated === 0) return call('m1', 'activate_characters', { situation: 'Arthur opens the vault door. A key lies inside.' })
    if (resolved === 0) return call('m2', 'resolve_round', { outcomes: round1 })
    if (resolved === 1 && thisTurn(request).includes('tried once more')) {
      return call('m3', 'resolve_round', { outcomes: [{ character: 'dan', result: 'succeeded', summary: 'Dan takes the lantern too' }] })
    }
    const delivery = script.delivery ?? 'good'
    if (thisTurn(request).includes('has been delivered to the player')) return text('')
    if (delivery === 'none') return text('Done.')
    if (delivery === 'narrator') return call('n-narrator', 'narrate', {})
    const refused = thisTurn(request).includes('the output is not acceptable')
    if (delivered === 0 || refused) {
      const changed = delivery === 'stubborn' || (delivery === 'changed-once' && delivered === 0)
      return call(`n${delivered}`, 'narrate', { segments: changed ? [{ ...alice, text: 'This is unexpected.' }, ...goodOutput.slice(1)] : goodOutput })
    }
    return text('')
  }
}

async function addSession(name: string): Promise<{ session: Session; id: string }> {
  const session = state.createSession(join(root, 'sessions'), { name, world: { id: 'w', name: 'The Vault' } })
  const base = { aliases: [], kind: 'person' as const, tier: 'principal' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, characterName, control] of [['arthur', 'Arthur', 'player'], ['alice', 'Alice', 'agent'], ['bob', 'Bob', 'agent'], ['carol', 'Carol', 'agent'], ['dan', 'Dan', 'agent']] as const) {
    const { id } = session.characters.add({ ...base, sourceId, name: characterName, role: control === 'player' ? 'playable' : 'npc', control })
    session.characterStates.create(id, { publicState: `${characterName} waits`, innerState: '', activity: 'idle' })
  }
  return { session, id: session.metadata.get().id }
}

let registered = false

async function chat(chatId: string, adapter: ScriptedAdapter) {
  if (!registered) ctx.llm.registerAdapter(['mock'], adapter)
  registered = true
  const handle = await ctx.agents.create({
    sessionId: SessionId(chatId),
    agentOptions: { provider: 'mock', model: 'mock' },
    async setup(agentCtx) { await agentCtx.plugin(orchestrationPlugin) },
  })
  return handle.agent
}

const say = (value: string) => createUserMessage({ content: [{ type: 'text', text: value }], source: { kind: 'user' } })
const activityOf = (session: Session, sourceId: string) => session.characterStates.get(session.characters.getBySourceId(sourceId)?.id ?? 0)?.activity
const publicStateOf = (session: Session, sourceId: string) => session.characterStates.get(session.characters.getBySourceId(sourceId)?.id ?? 0)?.publicState
/** The outputs the game master delivered, read back the way the client reads them. */
const outputsOf = (agent: { session: { snapshotEvents(): readonly { seq: number; type: string; data: unknown }[] } }) =>
  agent.session.snapshotEvents().flatMap((event) => {
    if (event.type !== 'tool/result') return []
    const { message } = event.data as { message: { content: { type: string; text?: string }[] } }
    const output = decodeOutput(message.content.flatMap(block => (block.text === undefined ? [] : [block.text])).join('\n'))
    return output === undefined ? [] : [{ seq: event.seq, ...output }]
  })
const characterRequests = (adapter: ScriptedAdapter) => adapter.requests.filter(request => /You are (Alice|Bob|Carol|Dan)\./.test(systemOf(request)))
const masterRequests = (adapter: ScriptedAdapter) => adapter.requests.filter(request => toolNames(request).includes('activate_characters'))

beforeEach(async () => {
  registered = false
  root = await mkdtemp(join(tmpdir(), 'orchestration-'))
  ctx = new Context()
  await mountAgentServices(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  orchestration = new RoleplayOrchestration(ctx)
  state = new RoleplayState(ctx, { journalMode: 'delete' })
  ctx.provide('roleplayRoot')
  ctx.set('roleplayRoot', { path: root })
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('a turn with the real agent loop', () => {
  it('plays the round: everyone acts, the game master resolves, one committed loser retries, the turn is recorded', async () => {
    const { session, id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()

    const characters = characterRequests(adapter)
    expect(characters.map(request => /You are (\w+)\./.exec(systemOf(request))?.[1]).sort()).toEqual(['Alice', 'Bob', 'Carol', 'Dan', 'Dan'])
    const retry = characters.find(request => asText(request).includes('trying again'))
    expect(retry && /You are (\w+)\./.exec(systemOf(retry))?.[1]).toBe('Dan')
    expect(asText(retry!)).toContain('Bob pushed Dan aside')
    expect(asText(retry!)).toContain('Bob got there first')
    expect(asText(retry!)).toContain('Dan takes the key')

    expect(activityOf(session, 'alice')).toBe('Alice takes the lantern')
    expect(activityOf(session, 'bob')).toBe('Bob takes the key')
    expect(publicStateOf(session, 'bob')).toBe('holding a brass key')
    expect(activityOf(session, 'carol')).toBe('Bob got there first')
    expect(activityOf(session, 'dan')).toBe('Dan takes the lantern too')
    expect(activityOf(session, 'arthur')).toBe('idle')
    expect(session.metadata.get().turns).toBe(1)
    expect(session.metadata.get().lastPlayedAt).toBeDefined()

    const events = agent.session.snapshotEvents()
    const delivered = outputsOf(agent)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ repaired: false })
    expect(delivered[0]?.segments).toEqual([
      { type: 'utterance', character: 'alice', name: 'Alice', text: 'That is not something I expected.' },
      { type: 'narration', text: 'Alice stands and walks to the door while Bob stares at you.' },
      { type: 'utterance', character: 'carol', name: 'Carol', text: 'Oh, please.' },
      { type: 'utterance', character: 'dan', name: 'Dan', text: 'Give it here!' },
      { type: 'narration', text: 'The key stays in Bob\'s hand.' },
    ])
    const after = events.filter(event => event.seq > (delivered[0]?.seq ?? Infinity))
    expect(after.filter(event => event.type === 'assistant/message' || event.type === 'step/start')).toEqual([])
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('keeps the characters apart from the game master', async () => {
    const { id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()

    const master = masterRequests(adapter)
    expect(master.length).toBeGreaterThan(0)
    expect(toolNames(master[0]!)).toEqual(expect.arrayContaining(['activate_characters', 'resolve_round']))
    expect(systemOf(master[0]!)).toContain('game master')
    expect(asText(master[0]!)).toContain('Scene before turn 1')
    expect(asText(master[0]!)).toContain('Alice (acts through')

    for (const request of characterRequests(adapter)) {
      expect(toolNames(request)).toEqual([STRUCTURED_OUTPUT_TOOL])
      expect(systemOf(request)).not.toContain('game master')
      expect(asText(request)).not.toContain('Scene before turn')
      expect(asText(request)).toContain('Arthur opens the vault door')
    }
  })

  it('does not let the game master end the turn before the round is recorded', async () => {
    const { session, id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor({ early: true }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()

    expect(masterRequests(adapter).some(request => asText(request).includes('You may not end the turn yet: call activate_characters'))).toBe(true)
    expect(session.metadata.get().turns).toBe(1)
    expect(activityOf(session, 'dan')).toBe('Dan takes the lantern too')
    expect(outputsOf(agent)).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('gives up objecting after a few tries, so a stubborn model cannot trap the chat', async () => {
    const { session, id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(request => (toolNames(request).includes('activate_characters') ? text('I am done.') : text('a title')))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    expect(masterRequests(adapter)).toHaveLength(4)
    expect(session.metadata.get().turns).toBe(0)
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('holds the game master to the utterances: a changed one is refused, and the corrected output is delivered', async () => {
    const { id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor({ delivery: 'changed-once' }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    const last = masterRequests(adapter).find(request => asText(request).includes('the utterance of Alice was changed'))
    expect(last).toBeDefined()
    expect(asText(last!)).toContain('it must be exactly')
    const output = outputsOf(agent)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ repaired: false })
    expect(JSON.stringify(output[0])).toContain('That is not something I expected.')
    expect(JSON.stringify(output[0])).not.toContain('This is unexpected.')
  })

  it('corrects the output itself when the game master keeps changing an utterance', async () => {
    const { id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor({ delivery: 'stubborn' }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    const output = outputsOf(agent)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ repaired: true })
    expect(JSON.stringify(output[0])).toContain('That is not something I expected.')
    expect(JSON.stringify(output[0])).not.toContain('This is unexpected.')
  })

  it('sends the game master back to deliver the output when it stops after recording the turn', async () => {
    const { session, id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor({ delivery: 'none' }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    expect(masterRequests(adapter).some(request => asText(request).includes('call narrate with the output of the turn; it must carry these utterances exactly'))).toBe(true)
    expect(session.metadata.get().turns).toBe(0)
    expect(activityOf(session, 'dan')).toBe('Dan takes the lantern too')
    expect(outputsOf(agent)).toHaveLength(0)
  })

  it('lets a narrator boundary write the output, which is checked like any other', async () => {
    const { id } = await addSession('Vault')
    orchestration.replace({ narrator: { narrate: () => Promise.resolve([{ type: 'narration', text: 'Everyone is quiet.' }]) } })
    const adapter = new ScriptedAdapter(answerFor({ delivery: 'narrator' }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    const output = outputsOf(agent)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ repaired: true })
    expect(output[0]?.segments.filter(segment => segment.type === 'utterance')).toHaveLength(3)
  })

  it('plays several rounds in one turn when the game master asks for them, and delivers every line in order', async () => {
    const { session, id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor({ twoRounds: true }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I enter the inn.'))
    await agent.whenIdle()

    const bob = characterRequests(adapter).find(request => /You are Bob\./.test(systemOf(request)))
    expect(asText(bob!)).toContain('Earlier in this scene')
    expect(asText(bob!)).toContain('That is not something I expected.')
    expect(activityOf(session, 'alice')).toBe('Alice greets him')
    expect(activityOf(session, 'bob')).toBe('Bob objects')
    expect(session.metadata.get().turns).toBe(1)
    const delivered = outputsOf(agent)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ repaired: false })
    expect(delivered[0]?.segments.map(segment => (segment.type === 'utterance' ? `${segment.name}: ${segment.text}` : segment.text))).toEqual([
      'Alice: That is not something I expected.', 'Alice greets him; Bob frowns.', 'Bob: Why is he here?',
    ])
    expect(masterRequests(adapter).some(request => asText(request).includes('Round 1 is recorded') && asText(request).includes('round(s) are left for this message'))).toBe(true)
  })

  it('stops a second round the chat settings do not allow, and tells the game master to deliver', async () => {
    const { session, id } = await addSession('Vault')
    writeSettings(sessionFolder(join(root, 'sessions'), id), { maxRounds: 1 })
    const adapter = new ScriptedAdapter(answerFor({ twoRounds: true }))
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I enter the inn.'))
    await agent.whenIdle()
    expect(characterRequests(adapter).some(request => /You are Bob\./.test(systemOf(request)))).toBe(false)
    expect(masterRequests(adapter).some(request => asText(request).includes('1 round of characters were already played'))).toBe(true)
    expect(outputsOf(agent)).toHaveLength(1)
    expect(session.metadata.get().turns).toBe(1)
  })

  it('plays another turn from the new state of the characters', async () => {
    const { session, id } = await addSession('Vault')
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    agent.followup(say('I ask Bob for the key.'))
    await agent.whenIdle()
    expect(session.metadata.get().turns).toBe(2)
    const second = masterRequests(adapter).filter(request => asText(request).includes('Scene before turn 2')).at(0)
    expect(asText(second!)).toContain('Currently: holding a brass key; Bob takes the key')
  })

  it('refuses a turn the input validator rejects, without asking any character', async () => {
    const { session, id } = await addSession('Vault')
    orchestration.replace({ inputValidator: { validate: () => ({ ok: false, reason: 'the vault is not in this scene' }) } })
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    expect(characterRequests(adapter)).toHaveLength(0)
    expect(asText(masterRequests(adapter)[0]!)).toContain('the vault is not in this scene')
    expect(session.metadata.get().turns).toBe(0)
  })

  it('gives each character the brief the context boundary builds', async () => {
    const { id } = await addSession('Vault')
    orchestration.replace({ characterContext: { brief: ({ member, situation }) => ({ persona: `You are ${member.character.name}. Secret of ${member.key}.`, prompt: `Only for ${member.key}: ${situation}` }) } })
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    const bob = characterRequests(adapter).find(request => systemOf(request).includes('Secret of bob'))
    expect(bob).toBeDefined()
    expect(asText(bob!)).toContain('Only for bob')
    expect(asText(bob!)).not.toContain('Secret of alice')
  })

  it('keeps chats apart: two sessions play at the same time', async () => {
    const one = await addSession('One')
    const two = await addSession('Two')
    const adapter = new ScriptedAdapter(answerFor())
    const first = await chat(`session-${one.id}`, adapter)
    const second = await chat(`session-${two.id}`, adapter)
    first.followup(say('I open the vault door.'))
    second.followup(say('I open the vault door.'))
    await Promise.all([first.whenIdle(), second.whenIdle()])
    for (const { session } of [one, two]) {
      expect(session.metadata.get().turns).toBe(1)
      expect(activityOf(session, 'dan')).toBe('Dan takes the lantern too')
    }
  })

  it('leaves a chat that is not a roleplay session alone', async () => {
    const adapter = new ScriptedAdapter(() => text('hello'))
    const agent = await chat('session-not-a-roleplay-session', adapter)
    agent.followup(say('hi'))
    await agent.whenIdle()
    expect(adapter.requests.filter(request => request.messages.length > 0 && toolNames(request).includes('activate_characters')).length).toBeGreaterThan(0)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced' && JSON.stringify(event.data).includes('You may not end'))).toHaveLength(0)
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })
})
