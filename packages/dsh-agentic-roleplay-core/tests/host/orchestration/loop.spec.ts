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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoleplayOrchestration } from '../../../src/host/orchestration/service.ts'
import { writeSettings } from '../../../src/host/sessions/settings.ts'
import { decodeOutput } from '../../../src/shared/narration.ts'
import * as orchestrationPlugin from '../../../src/orchestration.ts'
import compactionPlugin from '../../../src/compaction.ts'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
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
  /**
   * How the record keeper works: carefully; trying to submit before it checked; writing a duplicate event that it finds
   * and retracts when it reads back; naming a round it was not given at first and correcting it when refused; or never
   * answering.
   */
  keeper?: 'careful' | 'hasty' | 'duplicating' | 'refused' | 'stuck'
  /** Every character asks itself about the key before it decides. */
  characterLookup?: boolean
  /** Makes every delivered output this many characters longer, so the conversation grows. */
  padding?: number
  /** The game master looks up the records before it acts. */
  lookup?: boolean
  /** Plays a second round of characters (Bob answering Alice) before delivering, when it is allowed. */
  twoRounds?: boolean
  /** The game master does not ask for the round to be recorded: nothing worth remembering happened. */
  skipRecord?: boolean
  /** Bob goes down to the cellar as a result of the round; or tries the locked vault first and is refused. */
  moves?: 'cellar' | 'locked-first'
  /**
   * The game master asks for someone to be made up before it delivers; and how the world author answers: makes a
   * character, makes one that is not usable at first (no place) and fixes it when refused, declines, says it made
   * something it did not, or makes two at once.
   */
  expand?: { author: 'creates' | 'incomplete' | 'declines' | 'pointless' | 'greedy' }
}

const aliceOnly = [{ character: 'alice', result: 'succeeded', summary: 'Alice greets him' }]
const bobOnly = [{ character: 'bob', result: 'succeeded', summary: 'Bob objects' }]
const alicesWords = { type: 'utterance', character: 'alice', text: 'That is not something I expected.' }
const bobsWords = { type: 'utterance', character: 'bob', text: 'Why is he here?' }

/** A game master that lets Bob answer Alice in a second round, and stops when it is told there are no more. */
function twoRounds(request: GenerateOptions, activated: number, resolved: number, record: boolean): StreamChunk[] {
  const turn = thisTurn(request)
  const recording = record && timesCalled(request, 'record_memory') === 0
  if (turn.includes('most this chat allows')) return recording ? call('m-rec', 'record_memory', { focus: 'Alice greeted him.' }) : call('m-stop', 'narrate', { segments: [alicesWords, { type: 'narration', text: 'Alice greets him.' }] })
  if (activated === 0) return call('m1', 'activate_characters', { situation: 'Arthur enters.', characters: ['alice'] })
  if (resolved === 0) return call('m2', 'resolve_round', { outcomes: aliceOnly })
  if (activated === 1) return call('m3', 'activate_characters', { situation: 'Alice has greeted Arthur.', characters: ['bob'] })
  if (resolved === 1) return call('m4', 'resolve_round', { outcomes: bobOnly })
  if (recording) return call('m-rec', 'record_memory', { focus: 'Alice greeted him and Bob objected.' })
  return call('m5', 'narrate', { segments: [alicesWords, { type: 'narration', text: 'Alice greets him; Bob frowns.' }, bobsWords] })
}

const lastToolText = (request: GenerateOptions): string => lastTool(request)?.text ?? ''

const briefOf = (request: GenerateOptions): string => {
  const prompt = request.messages.find(message => message.role === 'user')
  return prompt === undefined ? '' : prompt.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
}

interface BriefRound { turn: number; round: number; place?: string; entries: { character: string; summary: string; seen?: string }[] }

/** The rounds the record keeper is asked to write, read from its brief. */
function keeperRounds(request: GenerateOptions): BriefRound[] {
  const rounds: BriefRound[] = []
  for (const line of briefOf(request).split('\n')) {
    const heading = /^## turn (\d+), round (\d+)$/.exec(line)
    if (heading !== null) rounds.push({ turn: Number(heading[1]), round: Number(heading[2]), entries: [] })
    const entry = /^- (\w+) \([^)]*\): intended ".*" \[commitment: \w+\]; \w+: (.*)$/.exec(line)
    if (entry !== null && rounds.length > 0) rounds.at(-1)!.entries.push({ character: entry[1]!, summary: entry[2]! })
    const where = /^Place of the moment: .*\((\w+)\)$/.exec(line)
    if (where !== null && rounds.length > 0) rounds.at(-1)!.place = where[1]!
    const seen = /^ {2}the game master says anyone present can now see: (.*)$/.exec(line)
    if (seen !== null && rounds.length > 0) rounds.at(-1)!.entries.at(-1)!.seen = seen[1]!
  }
  return rounds
}

const lastTool = (request: GenerateOptions): { isError: boolean; text: string } | undefined => {
  const message = request.messages.findLast(candidate => candidate.role === 'tool')
  return message === undefined ? undefined : { isError: message.isError === true, text: message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('') }
}

/** The change the keeper writes for the rounds it was given: the state of each character that acted, and one event for the round that all of them perceived. */
function keeperEdit(rounds: BriefRound[], flaws: { wrong?: boolean; duplicate?: boolean; badRound?: boolean } = {}): object {
  return {
    turn: Math.max(...rounds.map(round => round.turn)),
    states: rounds.flatMap(round => round.entries).map(entry => ({
      character: entry.character, activity: flaws.wrong === true && entry.character === 'alice' ? 'WRONG' : entry.summary, ...(entry.seen === undefined ? {} : { public_state: entry.seen }),
    })),
    events: rounds.flatMap(round => [round, ...(flaws.duplicate === true ? [round] : [])]).map(round => ({
      turn: flaws.badRound === true ? 99 : round.turn, round: round.round, text: 'The characters acted at the vault.', importance: 3, tags: ['vault'],
      ...(round.place === undefined ? {} : { location: round.place }),
      involves: round.entries.slice(0, 2).map(entry => entry.character),
      perceived_by: [...new Set(round.entries.map(entry => entry.character))].map(character => ({ character, mode: 'witnessed' })),
    })),
  }
}

/** The record keeper's loop: write, read back to check, fix what it finds, submit. */
function keeperAnswer(request: GenerateOptions, script: Script): StreamChunk[] {
  const mode = script.keeper ?? 'careful'
  if (mode === 'stuck') return text('I think that is all.')
  const rounds = keeperRounds(request)
  const edits = timesCalled(request, 'edit_records')
  const reads = timesCalled(request, 'read_records')
  const submits = timesCalled(request, 'submit_result')
  const last = lastTool(request)
  const verifying = briefOf(request).includes('Verification is on')
  const submit = call('k-submit', 'submit_result', { complete: true, notes: 'recorded' })
  if (edits === 0) return call('k-edit', 'edit_records', keeperEdit(rounds, { wrong: mode === 'duplicating', duplicate: mode === 'duplicating', badRound: mode === 'refused' }))
  if (mode === 'refused' && edits === 1 && last?.isError === true) return call('k-edit-again', 'edit_records', keeperEdit(rounds))
  if (verifying) {
    if (mode === 'hasty' && submits === 0) return submit
    if (reads === 0) return call('k-read', 'read_records', { rounds: rounds.map(({ turn, round }) => ({ turn, round })) })
    if (mode === 'duplicating' && edits === 1) {
      const stored = JSON.parse(last!.text) as { events: { id: number; text: string }[]; characters: { character: string; activity: string }[] }
      return call('k-fix', 'edit_records', {
        turn: Math.max(...rounds.map(round => round.turn)),
        event_retractions: stored.events.filter((event, index) => stored.events.findIndex(other => other.text === event.text) !== index).map(event => event.id),
        states: stored.characters.filter(entry => entry.activity === 'WRONG').map(entry => ({ character: entry.character, activity: `${entry.character} takes the lantern` })),
      })
    }
    if (mode === 'duplicating' && reads === 1) return call('k-read-again', 'read_records', {})
  }
  return submit
}

const MIRA = { key: 'mira', name: 'Mira Voss', summary: 'A ferry pilot with news from the river.', personality: 'Dry and tired.', speech: { style: 'Short sentences.' }, state: { public_state: 'Out of breath.', activity: 'delivering news' } }

/** The world author's loop: look, make (or decline), check, submit; and, when fitting things in, connect, resolve, submit. */
function authorAnswer(request: GenerateOptions, script: Script): StreamChunk[] {
  const consolidating = systemOf(request).includes('fitting into the world what was made up')
  const turn = Number(/It is turn (\d+)/.exec(briefOf(request))?.[1] ?? 1)
  const edits = timesCalled(request, 'edit_world')
  const lints = timesCalled(request, 'world_lint')
  const resolves = timesCalled(request, 'resolve_consolidation')
  const last = lastTool(request)
  if (consolidating) {
    const item = Number(/- item (\d+)/.exec(briefOf(request))?.[1] ?? 0)
    if (edits === 0) return call('f-edit', 'edit_world', { turn, relationships: [{ from: 'mira', to: 'arthur', label: 'passenger', summary: 'Brought him over the river.', familiarity: 0.4 }, { from: 'arthur', to: 'mira', label: 'ferry pilot' }] })
    if (resolves === 0) return call('f-resolve', 'resolve_consolidation', { id: item, resolution: 'gave her relationships with Arthur, both ways' })
    return call('f-submit', 'submit_result', { complete: true, notes: 'fitted in' })
  }
  const mode = script.expand?.author ?? 'creates'
  const submitCreated = call('a-submit', 'submit_result', { outcome: 'created', summary: 'Made Mira Voss and connected her.' })
  const place = { location: 'street', position: 'by the bar door' }
  if (mode === 'declines') return call('a-decline', 'submit_result', { outcome: 'declined', summary: 'The innkeeper already serves; no new person is needed.' })
  if (mode === 'pointless') {
    if (edits === 0 && !last?.isError) return submitCreated
    return call('a-decline', 'submit_result', { outcome: 'declined', summary: 'On reflection nothing is needed.' })
  }
  if (mode === 'greedy') {
    if (edits === 0) return call('a-greedy', 'edit_world', { turn, characters: [{ ...MIRA, place }, { key: 'tom', name: 'Tom Voss', summary: 'Her brother.', place }, { key: 'ann', name: 'Ann Voss', summary: 'Her sister.', place }] })
    return call('a-decline', 'submit_result', { outcome: 'declined', summary: 'Too many at once; nothing made.' })
  }
  const withPlace = mode === 'creates'
  if (edits === 0) return call('a-edit', 'edit_world', { turn, characters: [{ ...MIRA, ...(withPlace ? { place } : {}) }], relationships: [{ from: 'mira', to: 'arthur', label: 'passenger' }] })
  if (mode === 'incomplete' && edits === 1) {
    if (last?.isError === true) return call('a-fix', 'edit_world', { turn, moves: [{ character: 'mira', to: 'street', position: 'by the bar door', ignore_exits: true }] })
    return submitCreated
  }
  if (lints === 0) return call('a-lint', 'world_lint', {})
  return submitCreated
}

/** The game master, following the protocol, and characters answering from their own sheets. */
function answerFor(script: Script = {}) {
  return (request: GenerateOptions): StreamChunk[] => {
    if (systemOf(request).includes('record keeper of an interactive story')) return keeperAnswer(request, script)
    if (systemOf(request).includes('world author of an interactive story')) return authorAnswer(request, script)
    const who = /You are (Alice|Bob|Carol|Dan)\./.exec(systemOf(request))?.[1]
    if (who !== undefined) {
      const retry = asText(request).includes('trying again')
      const later = asText(request).includes('Earlier in this scene')
      if (script.characterLookup === true && timesCalled(request, 'recall_my_memories') === 0) return call(`s-${who}-recall`, 'recall_my_memories', { about: 'the key' })
      if (later && who === 'Bob') return call('s-Bob-later', 'submit_result', { intent: 'Bob objects', utterance: 'Why is he here?', commitment: 'low' })
      return call(`s-${who}`, 'submit_result', retry ? { intent: `${who} grabs the lantern instead`, utterance: 'Give it here!', commitment: 'medium' } : intents[who]!)
    }
    if (systemOf(request).includes('chronicler of an interactive story')) return call('c-summary', STRUCTURED_OUTPUT_TOOL, { summary: 'The chronicler wrote this account of the earlier turns.' })
    if (!toolNames(request).includes('activate_characters')) return text('a title')
    const activated = timesCalled(request, 'activate_characters')
    // A refused call still counts as a call, so one refusal is taken off.
    const resolved = timesCalled(request, 'resolve_round') - (script.moves === 'locked-first' && thisTurn(request).includes('cannot go to') ? 1 : 0)
    const delivered = timesCalled(request, 'narrate')
    const objected = thisTurn(request).includes('You may not end the turn yet')
    if (script.early === true && !objected) return text('The scene is over, I think.')
    if (thisTurn(request).includes('input is refused')) return text('I cannot do that.')
    if (script.lookup === true && timesCalled(request, 'search_events') === 0) return call('m0', 'search_events', { text: 'key' })
    if (script.twoRounds === true) return twoRounds(request, activated, resolved, script.skipRecord !== true)
    if (activated === 0) return call('m1', 'activate_characters', { situation: 'Arthur opens the vault door. A key lies inside.' })
    const withMove = (key: string) => round1.map(outcome => (outcome.character === 'bob' ? { ...outcome, moves_to: { location: key, position: 'by the barrels' } } : outcome))
    const refusedMove = lastTool(request)?.isError === true && lastToolText(request).includes('cannot go to')
    if (script.moves === 'locked-first' && refusedMove) return call('m2b', 'resolve_round', { outcomes: withMove('cellar') })
    if (resolved === 0) {
      if (script.moves === 'cellar') return call('m2', 'resolve_round', { outcomes: withMove('cellar') })
      if (script.moves === 'locked-first') return call('m2', 'resolve_round', { outcomes: withMove('vault') })
      return call('m2', 'resolve_round', { outcomes: round1 })
    }
    if (resolved === 1 && thisTurn(request).includes('tried once more')) {
      return call('m3', 'resolve_round', { outcomes: [{ character: 'dan', result: 'succeeded', summary: 'Dan takes the lantern too' }] })
    }
    if (script.expand !== undefined && timesCalled(request, 'expand_world') === 0) return call('m-exp', 'expand_world', { need: 'arrival', what: 'A ferry pilot named Mira Voss has just come up the lane to the bar with news.' })
    if (script.skipRecord !== true && timesCalled(request, 'record_memory') === 0) return call('m-rec', 'record_memory', { focus: 'The key changed hands.' })
    const delivery = script.delivery ?? 'good'
    if (thisTurn(request).includes('has been delivered to the player')) return text('')
    if (delivery === 'none') return text('Done.')
    if (delivery === 'narrator') return call('n-narrator', 'narrate', {})
    const refused = thisTurn(request).includes('the output is not acceptable')
    if (delivered === 0 || refused) {
      const changed = delivery === 'stubborn' || (delivery === 'changed-once' && delivered === 0)
      const output = script.padding === undefined ? goodOutput : [alice, { type: 'narration', text: `Alice stands and walks to the door while Bob stares at you. ${'z'.repeat(script.padding)}` }, ...goodOutput.slice(2)]
      return call(`n${delivered}`, 'narrate', { segments: changed ? [{ ...alice, text: 'This is unexpected.' }, ...output.slice(1)] : output })
    }
    return text('')
  }
}

async function addSession(name: string, withPlaces = false): Promise<{ session: Session; id: string }> {
  const session = state.createSession(join(root, 'sessions'), { name, world: { id: 'w', name: 'The Vault' } })
  const base = { aliases: [], kind: 'person' as const, tier: 'principal' as const, summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } }
  for (const [sourceId, characterName, control] of [['arthur', 'Arthur', 'player'], ['alice', 'Alice', 'agent'], ['bob', 'Bob', 'agent'], ['carol', 'Carol', 'agent'], ['dan', 'Dan', 'agent']] as const) {
    const { id } = session.characters.add({ ...base, sourceId, name: characterName, role: control === 'player' ? 'playable' : 'npc', control })
    session.characterStates.create(id, { publicState: `${characterName} waits`, innerState: '', activity: 'idle' })
  }
  if (withPlaces) {
    const place = (key: string, name: string, description = '', features: { key: string; name: string; description: string }[] = []) => session.locations.add({ sourceId: key, name, description, features })
    const [bar, street, cellar, vault] = [place('bar', 'The Bar', 'Smoky.', [{ key: 'counter', name: 'Counter', description: '' }]), place('street', 'Main Street'), place('cellar', 'Cellar', 'Cold.'), place('vault', 'Vault')]
    const way = (from: number, to: number, description: string, state: 'open' | 'locked' = 'open', note = '') => {
      session.locations.addExit({ fromId: from, toId: to, description, state, note })
      session.locations.addExit({ fromId: to, toId: from, description, state, note })
    }
    way(bar.id, street.id, 'the door')
    way(bar.id, cellar.id, 'a stair down')
    way(vault.id, cellar.id, '', 'locked', 'needs a key')
    for (const [key, where] of [['arthur', bar], ['alice', bar], ['bob', bar], ['carol', cellar], ['dan', street]] as const) session.placements.place('character', session.characters.getBySourceId(key)!.id, { locationId: where.id })
  }
  return { session, id: session.metadata.get().id }
}

let registered = false
let withCompaction = false

async function chat(chatId: string, adapter: ScriptedAdapter) {
  if (!registered) ctx.llm.registerAdapter(['mock'], adapter)
  registered = true
  const handle = await ctx.agents.create({
    sessionId: SessionId(chatId),
    agentOptions: { provider: 'mock', model: 'mock' },
    async setup(agentCtx) {
      await agentCtx.plugin(orchestrationPlugin)
      if (withCompaction) await agentCtx.plugin(compactionPlugin)
    },
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
  withCompaction = false
  root = await mkdtemp(join(tmpdir(), 'orchestration-'))
  ctx = new Context()
  await mountAgentServices(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
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
  describe('the world author', () => {
    async function playAuthored(author: NonNullable<Script['expand']>['author'], settings?: object) {
      const { session, id } = await addSession('Vault', true)
      if (settings !== undefined) writeSettings(sessionFolder(join(root, 'sessions'), id), settings)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', expand: { author } }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I wait for the ferry.'))
      await agent.whenIdle()
      return { session, adapter, agent }
    }
    const authors = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('world author of an interactive story'))
    const masterSaw = (adapter: ScriptedAdapter) => JSON.stringify(masterRequests(adapter).at(-1)!.messages)

    it('is asked through expand_world, which only the game master has, and makes the character the story needs, placed, connected and queued', async () => {
      const { session, adapter } = await playAuthored('creates')
      expect(masterRequests(adapter).every(request => toolNames(request).includes('expand_world'))).toBe(true)
      expect(characterRequests(adapter).some(request => toolNames(request).includes('expand_world'))).toBe(false)
      expect(toolNames(authors(adapter)[0]!).sort()).toEqual(['edit_world', 'get_character', 'get_location', 'list_characters', 'list_locations', 'list_relationships', 'search_events', 'submit_result', 'world_lint'])
      const mira = session.characters.getBySourceId('mira')!
      expect(mira).toMatchObject({ name: 'Mira Voss', role: 'npc', control: 'agent', tier: 'supporting' })
      expect(session.placements.get('character', mira.id)).toMatchObject({ locationId: session.locations.getBySourceId('street')!.id, position: 'by the bar door' })
      expect(session.relationships.get(mira.id, session.characters.getBySourceId('arthur')!.id)?.label).toBe('passenger')
      expect(session.consolidation.pending()).toEqual([expect.objectContaining({ kind: 'character', subjectId: mira.id, createdTurn: 1 })])
      expect(masterSaw(adapter)).toContain('Made up and fitted into the world:\\n- character mira (Mira Voss)')
      expect(masterSaw(adapter)).toContain('now in the cast')
    })

    it('is told the bar, the request, what exists and what happened, before it decides', async () => {
      const { adapter } = await playAuthored('creates')
      const brief = briefOf(authors(adapter)[0]!)
      expect(brief).toContain('Reason given: arrival.')
      expect(brief).toContain('A ferry pilot named Mira Voss has just come up the lane')
      expect(brief).toContain('At most 2 new things may be made in a turn, and 0 already were this turn.')
      expect(brief).toContain('## Characters that exist\n- arthur: Arthur in The Bar [the player]')
      expect(brief).toContain('## Places that exist\n- bar: The Bar')
      expect(systemOf(authors(adapter)[0]!)).toContain('Something is made up only when ALL of this holds')
    })

    it('does not finish until what it made is usable: a character in no place is an error it must fix', async () => {
      const { session, adapter } = await playAuthored('incomplete')
      expect(JSON.stringify(authors(adapter).at(-1)!.messages)).toContain('what you made is not usable yet')
      expect(JSON.stringify(authors(adapter).at(-1)!.messages)).toContain('character-unplaced')
      expect(session.placements.get('character', session.characters.getBySourceId('mira')!.id)?.locationId).toBe(session.locations.getBySourceId('street')!.id)
      expect(masterSaw(adapter)).toContain('character mira (Mira Voss)')
    })

    it('can decline, and the game master is told to work with what exists', async () => {
      const { session, adapter } = await playAuthored('declines')
      expect(session.characters.getBySourceId('mira')).toBeUndefined()
      expect(session.consolidation.pending()).toEqual([])
      expect(masterSaw(adapter)).toContain('Nothing was made up: The innkeeper already serves; no new person is needed. Work with what exists.')
    })

    it('may not say it made something it did not', async () => {
      const { adapter, session } = await playAuthored('pointless')
      expect(JSON.stringify(authors(adapter).at(-1)!.messages)).toContain('you have made nothing')
      expect(session.characters.getBySourceId('mira')).toBeUndefined()
      expect(masterSaw(adapter)).toContain('Nothing was made up: On reflection nothing is needed.')
    })

    it('may not make more in a turn than the chat allows, and an edit that would is refused whole', async () => {
      const { session, adapter } = await playAuthored('greedy', { authoring: { perTurn: 2 } })
      expect(JSON.stringify(authors(adapter).at(-1)!.messages)).toMatch(/makes 3 new things.*pass the 2 this chat allows per turn/)
      expect(session.characters.getBySourceId('mira')).toBeUndefined()
      expect(session.characters.getBySourceId('tom')).toBeUndefined()
    })

    it('is not asked in a closed world: the game master is told so and no author runs', async () => {
      const { session, adapter } = await playAuthored('creates', { authoring: { enabled: false } })
      expect(authors(adapter)).toEqual([])
      expect(session.characters.getBySourceId('mira')).toBeUndefined()
      expect(masterSaw(adapter)).toContain('this world is closed')
    })

    it('fits what was made up into the world in the background, with relationships both ways, once enough waits', async () => {
      const { session, agent, adapter } = await playAuthored('creates', { authoring: { consolidateAfter: 1 } })
      const mira = session.characters.getBySourceId('mira')!
      const arthur = session.characters.getBySourceId('arthur')!
      await vi.waitFor(() => { expect(session.consolidation.pending()).toEqual([]) })
      expect(session.relationships.get(mira.id, arthur.id)).toMatchObject({ label: 'passenger', familiarity: 0.4 })
      expect(session.relationships.get(arthur.id, mira.id)?.label).toBe('ferry pilot')
      expect(session.consolidation.get(1)?.resolution).toBe('gave her relationships with Arthur, both ways')
      const fitting = authors(adapter).find(request => systemOf(request).includes('fitting into the world what was made up'))!
      expect(briefOf(fitting)).toContain('- item 1, character mira (Mira Voss), made in turn 1')
      expect(toolNames(fitting).sort()).toEqual(['edit_world', 'get_character', 'get_location', 'list_characters', 'list_consolidation', 'list_locations', 'list_relationships', 'resolve_consolidation', 'search_events', 'submit_result', 'world_lint'])
      expect(session.metadata.get().turns).toBe(1)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(1)
    })

    it('does not fit anything in while fewer than the chat asks for wait, and the new character already acts in the next round', async () => {
      const { session, agent, adapter } = await playAuthored('creates', { authoring: { consolidateAfter: 5 } })
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(session.consolidation.pending()).toHaveLength(1)
      expect(authors(adapter).filter(request => systemOf(request).includes('fitting into the world'))).toEqual([])
      expect(session.characters.getBySourceId('mira')?.control).toBe('agent')
      expect(agent.session.id).toContain('session-')
    })
  })

  describe('in a world with places', () => {
    async function playPlaced(script: Script) {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', ...script }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      return { session, adapter, agent }
    }
    const placeOf = (session: Session, key: string) => session.placements.get('character', session.characters.getBySourceId(key)!.id)
    const keepers = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('record keeper of an interactive story'))
    const briefFor = (adapter: ScriptedAdapter, who: string) => briefOf(characterRequests(adapter).find(request => systemOf(request).includes(`You are ${who}.`))!)

    it('tells the game master where everyone is, and each character only where it is and who is there', async () => {
      const { adapter } = await playPlaced({})
      const scene = thisTurn(masterRequests(adapter)[0]!)
      expect(scene).toContain("The player's character is in The Bar (bar): Smoky.")
      expect(scene).toContain('Characters elsewhere')
      expect(scene).toContain('in Cellar (cellar)')
      const alicesBrief = briefFor(adapter, 'Alice')
      expect(alicesBrief).toContain('Where you are:\nThe Bar: Smoky.')
      expect(alicesBrief).toMatch(/Present:\n- Arthur[^\n]*\n- Alice \(you\)[^\n]*\n- Bob/)
      expect(alicesBrief).not.toContain('Carol')
      const carolsBrief = briefFor(adapter, 'Carol')
      expect(carolsBrief).toContain('Where you are:\nCellar: Cold.')
      expect(carolsBrief).toMatch(/Present:\n- Carol \(you\)[^\n]*$/)
    })

    it('moves a character the game master sends somewhere, with the round, and commits it for the keeper', async () => {
      const { session, adapter } = await playPlaced({ moves: 'cellar' })
      expect(placeOf(session, 'bob')).toMatchObject({ locationId: session.locations.getBySourceId('cellar')!.id, position: 'by the barrels' })
      expect(placeOf(session, 'alice')?.locationId).toBe(session.locations.getBySourceId('bar')!.id)
      const brief = briefOf(keepers(adapter)[0]!)
      expect(brief).toContain('Place of the moment: The Bar (bar)')
      expect(brief).toMatch(/was in The Bar \(bar\) and went to Cellar \(cellar\), by the barrels/)
      expect(brief).toMatch(/- bob \(Bob, an agent\): .*in: cellar \(by the barrels\)/)
      const [event] = session.events.list()
      expect(event?.locationId).toBe(session.locations.getBySourceId('bar')!.id)
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('Bob is now at Cellar')
    })

    it('sends the game master back when the way is locked, and applies the corrected round', async () => {
      const { session, adapter } = await playPlaced({ moves: 'locked-first' })
      const refused = masterRequests(adapter).flatMap(request => request.messages.filter(message => message.role === 'tool' && message.isError === true))
      expect(JSON.stringify(refused)).toMatch(/bob: cannot go to vault: the way from The Bar to Vault is locked at Cellar -> Vault: needs a key/)
      expect(placeOf(session, 'bob')?.locationId).toBe(session.locations.getBySourceId('cellar')!.id)
    })
  })

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
      expect(toolNames(request)).toEqual(['recall_my_memories', 'submit_result'])
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

  describe('the record keeper', () => {
    const keeperRequests = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('record keeper of an interactive story'))
    const keeperCalls = (adapter: ScriptedAdapter): string[] => {
      const last = keeperRequests(adapter).at(-1)
      return last === undefined ? [] : [...JSON.stringify(last.messages).matchAll(/"type":"tool-call","id":"[^"]*","name":"(\w+)"/g)].map(match => match[1]!)
    }

    async function play(keeper: NonNullable<Script['keeper']>, settings?: object) {
      const { session, id } = await addSession('Vault')
      if (settings !== undefined) writeSettings(sessionFolder(join(root, 'sessions'), id), settings)
      const adapter = new ScriptedAdapter(answerFor({ keeper }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      return { session, adapter, agent }
    }

    it('loops through its own tools: writes, reads the records back to check, and only then submits', async () => {
      const { session, adapter, agent } = await play('careful')
      expect(keeperCalls(adapter)).toEqual(['edit_records', 'read_records'])
      expect(toolNames(keeperRequests(adapter)[0]!).sort()).toEqual(['edit_records', 'get_location', 'list_locations', 'list_relationships', 'list_threads', 'read_records', 'search_events', 'submit_result'])
      expect(activityOf(session, 'alice')).toBe('Alice takes the lantern')
      expect(activityOf(session, 'dan')).toBe('Dan takes the lantern too')
      expect(publicStateOf(session, 'bob')).toBe('holding a brass key')
      expect(session.events.list().map(event => event.text)).toEqual(['The characters acted at the vault.'])
      expect(session.metadata.get().turns).toBe(1)
      expect(outputsOf(agent)).toHaveLength(1)
      expect(session.pendingCommits.list()).toEqual([])
    })

    it('has tools the game master and the characters do not have', async () => {
      const { adapter } = await play('careful')
      expect(masterRequests(adapter).every(request => !toolNames(request).some(name => ['edit_records', 'submit_result'].includes(name)))).toBe(true)
      expect(characterRequests(adapter).every(request => !toolNames(request).includes('edit_records'))).toBe(true)
      expect(toolNames(masterRequests(adapter)[0]!)).toEqual(expect.arrayContaining(['search_events', 'get_character', 'recall_memories', 'list_threads', 'list_characters', 'read_records']))
    })

    it('is told the rounds, the state, what is recorded and what is open, and nothing of the narration', async () => {
      const { adapter } = await play('careful')
      const brief = briefOf(keeperRequests(adapter)[0]!)
      expect(brief).toContain('## turn 1, round 1')
      expect(brief).toContain('Arthur opens the vault door')
      expect(brief).toContain('bob (Bob): intended "Bob takes the key"')
      expect(brief).toContain('## State of the characters now')
      expect(brief).toContain('## Open story threads')
      expect(brief).toContain('Verification is on')
      expect(brief).not.toContain('stands and walks to the door')
    })

    it('cannot submit before it has read the records back, and is told so', async () => {
      const { adapter } = await play('hasty')
      expect(JSON.stringify(keeperRequests(adapter).at(-1)!.messages)).toContain('read the records back with read_records')
      expect(keeperCalls(adapter)).toEqual(['edit_records', 'submit_result', 'read_records'])
    })

    it('finds a repeated event and a state that does not match when it reads back, and corrects them', async () => {
      const { session, adapter } = await play('duplicating')
      expect(keeperCalls(adapter)).toEqual(['edit_records', 'read_records', 'edit_records', 'read_records'])
      expect(session.events.list().map(event => event.text)).toEqual(['The characters acted at the vault.'])
      expect(activityOf(session, 'alice')).toBe('alice takes the lantern')
    })

    it('gets the reasons when an edit is refused, writes nothing from it, and corrects it in the same run', async () => {
      const { session, adapter } = await play('refused')
      expect(keeperRequests(adapter).length).toBeGreaterThan(2)
      expect(JSON.stringify(keeperRequests(adapter)[1]!.messages)).toContain('turn 99, round 1')
      expect(session.events.list()).toHaveLength(1)
      expect(session.events.get(1)?.turn).toBe(1)
    })

    it('skips the check when the chat turns verification off, and submits right after writing', async () => {
      const { session, adapter } = await play('careful', { memory: { verify: false } })
      expect(keeperCalls(adapter)).toEqual(['edit_records'])
      expect(briefOf(keeperRequests(adapter)[0]!)).toContain('Verification is off')
      expect(session.events.list()).toHaveLength(1)
    })

    it('that never submits does not lose the turn, and does not put a word of it in the output', async () => {
      const { session, agent } = await play('stuck')
      const results = JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))
      expect(results).not.toMatch(/records|Warning|could not be/)
      expect(outputsOf(agent)).toHaveLength(1)
      expect(session.metadata.get().turns).toBe(1)
      expect(session.pendingCommits.list().map(entry => [entry.turn, entry.round])).toEqual([[1, 1]])
    })

    it('that failed is caught up with the next turn, which writes both, silently', async () => {
      const { session, id } = await addSession('Vault')
      const script: Script = { keeper: 'stuck' }
      const adapter = new ScriptedAdapter(answerFor(script))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(session.pendingCommits.list()).toHaveLength(1)
      script.keeper = 'careful'
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(session.pendingCommits.list()).toEqual([])
      const brief = briefOf(keeperRequests(adapter).at(-1)!)
      expect(brief).toContain('2 rounds are due for records')
      expect(brief).toContain('## turn 1, round 1')
      expect(brief).toContain('## turn 2, round 1')
      expect(session.events.list().map(event => event.turn)).toEqual([1, 2])
      expect(session.metadata.get().turns).toBe(2)
    })

    it('writes the events of the round with who took each in', async () => {
      const { session } = await play('careful')
      const [event] = session.events.list()
      expect(event).toMatchObject({ turn: 1, round: 1, importance: 3, tags: ['vault'] })
      expect(event?.involves).toHaveLength(2)
      const perceptions = session.events.perceptionsOf(event!.id)
      expect(perceptions).toHaveLength(4)
      expect(perceptions.every(entry => entry.mode === 'witnessed' && entry.accuracy === 'accurate' && entry.content === event!.text)).toBe(true)
    })

    it('runs only when the game master asks: quiet rounds wait, and the next record writes them with the one that matters', async () => {
      const { session, id } = await addSession('Vault')
      const script: Script = { keeper: 'careful', skipRecord: true }
      const adapter = new ScriptedAdapter(answerFor(script))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(keeperRequests(adapter)).toHaveLength(0)
      expect(session.events.list()).toEqual([])
      expect(session.pendingCommits.list()).toHaveLength(1)
      expect(session.metadata.get().turns).toBe(1)
      expect(activityOf(session, 'alice')).toBe('Alice takes the lantern')
      script.skipRecord = false
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      const brief = briefOf(keeperRequests(adapter).at(-1)!)
      expect(brief).toContain('2 rounds are due for records')
      expect(brief).toContain('The game master says this is worth keeping: The key changed hands.')
      expect(session.pendingCommits.list()).toEqual([])
      expect(session.events.list().map(event => event.turn)).toEqual([1, 2])
    })

    it('has the game master ask through record_memory, which no character or keeper has', async () => {
      const { adapter } = await play('careful')
      expect(masterRequests(adapter).every(request => toolNames(request).includes('record_memory'))).toBe(true)
      expect(characterRequests(adapter).some(request => toolNames(request).includes('record_memory'))).toBe(false)
      expect(keeperRequests(adapter).some(request => toolNames(request).includes('record_memory'))).toBe(false)
    })

    it('seals the events once the run is complete, so they cannot be changed afterwards', async () => {
      const { session } = await play('careful')
      const [event] = session.events.list()
      expect(event?.sealed).toBe(true)
      expect(() => session.events.update(event!.id, { text: 'changed' })).toThrow(/sealed/)
    })

    it('runs anyway at the end of the turn when more rounds wait than the chat allows', async () => {
      const { session, id } = await addSession('Vault')
      writeSettings(sessionFolder(join(root, 'sessions'), id), { memory: { backlogRounds: 1 } })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', skipRecord: true }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(keeperCalls(adapter)).toEqual(['edit_records', 'read_records'])
      expect(session.pendingCommits.list()).toEqual([])
      expect(session.events.list()).toHaveLength(1)
    })

    it('has the pool of memories a character is reminded of judged by the reranking service, when there is one', async () => {
      const asked: { query: string; documents: readonly string[] }[] = []
      ctx.provide('rerankers')
      ctx.set('rerankers', {
        rerank: (query: string, documents: readonly string[]) => {
          asked.push({ query, documents })
          return Promise.resolve({ results: documents.map((_document, index) => ({ index, score: 1 - index / 10 })) })
        },
      })
      const { session, id } = await addSession('Vault')
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(asked).toEqual([])
      expect(session.events.list()).toHaveLength(1)
      agent.followup(say('I look at the vault door again.'))
      await agent.whenIdle()
      expect(asked.length).toBeGreaterThan(0)
      expect(asked.every(call => call.query.includes('Arthur opens the vault door'))).toBe(true)
      expect(asked.some(call => call.documents.includes('The characters acted at the vault.'))).toBe(true)
    })

    it('has the vectors of what was written made afterwards by the embedding service, when there is one', async () => {
      const seen: { texts: readonly string[]; options: Record<string, unknown> | undefined }[] = []
      ctx.provide('embeddings')
      ctx.set('embeddings', {
        embed: (texts: readonly string[], options?: Record<string, unknown>) => {
          seen.push({ texts, options })
          return Promise.resolve({ vectors: texts.map(() => [0.5, 0.5, 0.5]), model: 'fake', dimensions: 3 })
        },
      })
      const { session, id } = await addSession('Vault')
      writeSettings(sessionFolder(join(root, 'sessions'), id), { embedding: { options: { dimensions: 3 } } })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      await vi.waitFor(() => { expect(session.recallIndex.info()).toMatchObject({ model: 'fake', dimensions: 3, pending: 0 }) })
      expect(session.recallIndex.info()?.embedded).toBe(5)
      const documents = seen.filter(call => call.options?.['inputType'] === 'document')
      expect(documents.length).toBeGreaterThan(0)
      expect(documents[0]?.options).toMatchObject({ dimensions: 3 })
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(seen.some(call => call.options?.['inputType'] === 'query')).toBe(true)
    })

    it('is told whether characters remember imperfectly, as the chat\'s settings say', async () => {
      const first = await play('careful')
      expect(briefOf(keeperRequests(first.adapter)[0]!)).toContain('characters do not perceive perfectly')
      const { id } = await addSession('Exact')
      writeSettings(sessionFolder(join(root, 'sessions'), id), { memory: { flaky: false } })
      const agent = await chat(`session-${id}`, first.adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(briefOf(keeperRequests(first.adapter).at(-1)!)).toContain('every character perceives exactly what happened')
    })

    it('keeps the start of every request the same from one run to the next, so the provider\'s cache holds', async () => {
      const { adapter } = await play('careful')
      const second = await addSession('Again')
      const agent = await chat(`session-${second.id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const runs = keeperRequests(adapter).filter(request => !request.messages.some(message => message.role === 'tool'))
      expect(runs.length).toBeGreaterThan(1)
      expect(new Set(runs.map(systemOf)).size).toBe(1)
      expect(new Set(runs.map(request => JSON.stringify(request.tools))).size).toBe(1)
      const alices = characterRequests(adapter).filter(request => /You are Alice\./.test(systemOf(request)) && !request.messages.some(message => message.role === 'tool'))
      expect(alices.length).toBeGreaterThan(1)
      expect(new Set(alices.map(systemOf)).size).toBe(1)
      expect(new Set(alices.map(request => JSON.stringify(request.tools))).size).toBe(1)
    })
  })

  describe('characters acting at the same time', () => {
    it('each reach only their own memories through the same tool, whatever the others ask in the meantime', async () => {
      const { session, id } = await addSession('Vault')
      const idOf = (sourceId: string) => session.characters.getBySourceId(sourceId)!.id
      session.edit({ turn: 1, events: [
        { turn: 1, round: 1, text: 'Alice hid the brass key.', importance: 3, tags: ['key'], involves: ['alice'], perceivedBy: [{ character: 'alice', mode: 'witnessed', content: 'ALICE-ONLY: I hid the brass key under the floor.' }] },
        { turn: 1, round: 1, text: 'Bob found the brass key.', importance: 3, tags: ['key'], involves: ['bob'], perceivedBy: [{ character: 'bob', mode: 'witnessed', content: 'BOB-ONLY: I found the brass key in the hall.' }] },
      ] })
      const adapter = new ScriptedAdapter(answerFor({ characterLookup: true }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const result = (who: string) => {
        const request = characterRequests(adapter).find(candidate => new RegExp(`You are ${who}\\.`).test(systemOf(candidate)) && lastToolText(candidate).length > 0)
        return request === undefined ? '' : lastToolText(request)
      }
      expect(result('Alice')).toContain('ALICE-ONLY')
      expect(result('Alice')).not.toContain('BOB-ONLY')
      expect(result('Bob')).toContain('BOB-ONLY')
      expect(result('Bob')).not.toContain('ALICE-ONLY')
      expect(result('Carol')).toBe('You do not remember anything about that.')
      expect(session.events.perceivedBy(idOf('alice'))[0]?.perception.recalls).toBeGreaterThan(0)
    })

    it('are not offered the tool when the chat turns it off', async () => {
      const { id } = await addSession('Vault')
      writeSettings(sessionFolder(join(root, 'sessions'), id), { memory: { lookup: false } })
      const adapter = new ScriptedAdapter(answerFor())
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(characterRequests(adapter).every(request => toolNames(request).join() === 'submit_result')).toBe(true)
      expect(characterRequests(adapter).every(request => !systemOf(request).includes('recall_my_memories'))).toBe(true)
    })
  })

  it('reminds a character by meaning when another plugin supplies a ranker, though no word of the moment matches', async () => {
    const { session, id } = await addSession('Vault')
    session.edit({ turn: 1, events: [
      { turn: 1, round: 1, text: 'The treasure is buried under the old oak.', importance: 2, tags: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] },
      { turn: 1, round: 1, text: 'The band played a march.', importance: 3, tags: [], perceivedBy: [{ character: 'alice', mode: 'witnessed' }] },
    ] })
    writeSettings(sessionFolder(join(root, 'sessions'), id), { memory: { recall: 1 } })
    const unrank = state.rankMemories(({ candidates }) => Promise.resolve(new Map(candidates.map(candidate => [candidate.key, candidate.text.includes('treasure') ? 1 : 0]))))
    try {
      const adapter = new ScriptedAdapter(answerFor())
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door and look for the gold.'))
      await agent.whenIdle()
      const asAlice = characterRequests(adapter).find(request => /You are Alice\./.test(systemOf(request)))
      expect(asText(asAlice!)).toContain('The treasure is buried under the old oak.')
      expect(asText(asAlice!)).not.toContain('The band played a march.')
    } finally {
      unrank()
    }
  })

  it('reminds each character of what it took in itself, and of nothing it did not', async () => {
    const { session, id } = await addSession('Vault')
    const idOf = (sourceId: string) => session.characters.getBySourceId(sourceId)!.id
    session.events.add(
      { turn: 1, round: 1, text: 'Dan stole the vault key at night.', importance: 4, tags: ['vault', 'key'], involves: [idOf('dan')] },
      [{ characterId: idOf('alice'), mode: 'witnessed', content: 'I saw Dan sneak out with a key under his coat.', gist: 'Dan sneaked out with a key', accuracy: 'accurate' }],
    )
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    const asAlice = characterRequests(adapter).find(request => /You are Alice\./.test(systemOf(request)))
    const asBob = characterRequests(adapter).find(request => /You are Bob\./.test(systemOf(request)))
    expect(asText(asAlice!)).toContain('What you remember that bears on this')
    expect(asText(asAlice!)).toContain('I saw Dan sneak out with a key under his coat.')
    expect(asText(asBob!)).not.toContain('sneak out')
    expect(asText(asBob!)).not.toContain('What you remember')
    expect(session.events.perceivedBy(idOf('alice'))[0]?.perception.recalls).toBe(1)
  })

  describe('a long conversation', () => {
    async function playLong(turns: number, settings: object) {
      withCompaction = true
      const { session, id } = await addSession('Vault')
      writeSettings(sessionFolder(join(root, 'sessions'), id), settings)
      const adapter = new ScriptedAdapter(answerFor({ padding: 7000 }))
      const agent = await chat(`session-${id}`, adapter)
      for (let turn = 1; turn <= turns; turn++) {
        agent.followup(say(`Move number ${turn} of the player.`))
        await agent.whenIdle()
      }
      return { session, adapter, agent }
    }
    const chronicleRequests = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('chronicler of an interactive story'))

    it('is sent whole until the limit, then the oldest turns are folded into summaries written from the events', async () => {
      const { session, adapter } = await playLong(6, { context: { limitTokens: 4000, retainRatio: 0.3 } })
      const summaries = session.summaries.list()
      expect(summaries.length).toBeGreaterThan(0)
      expect(summaries[0]).toMatchObject({ level: 'digest', fromTurn: 1 })
      const chronicle = chronicleRequests(adapter)
      expect(chronicle.length).toBeGreaterThan(0)
      expect(JSON.stringify(chronicle[0]!.messages)).toContain('The characters acted at the vault.')
      const last = masterRequests(adapter).at(-1)!
      expect(asText(last)).toContain('Recently (short term)')
      expect(asText(last)).toContain('The chronicler wrote this account of the earlier turns.')
      expect(asText(last)).not.toContain('Move number 1 of the player.')
      expect(asText(last)).toContain('Move number 6 of the player.')
    })

    it('sends the whole conversation while it is under the limit, and does not fold', async () => {
      const { session, adapter } = await playLong(3, { context: { limitTokens: 200_000 } })
      expect(session.summaries.list()).toEqual([])
      const last = masterRequests(adapter).at(-1)!
      expect(asText(last)).toContain('Move number 1 of the player.')
      expect(asText(last)).not.toContain('Recently (short term)')
    })

    it('keeps the head of the conversation the same between folds, so the provider\'s cache holds', async () => {
      const { adapter } = await playLong(7, { context: { limitTokens: 4000, retainRatio: 0.3 } })
      const heads = masterRequests(adapter).map(request => JSON.stringify(request.messages.slice(0, 3)))
      const changes = heads.filter((head, index) => index > 0 && head !== heads[index - 1]).length
      expect(changes).toBeLessThan(heads.length / 2)
    })
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
