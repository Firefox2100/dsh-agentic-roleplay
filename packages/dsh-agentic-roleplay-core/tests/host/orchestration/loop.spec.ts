import { defineTool } from '@deepseek-ai/dsh-tools'
import { AuthoringTools } from '../../../src/host/tools/authoring-tools.ts'
import { outputBudget } from '../../../src/host/agents/budget.ts'
import { keeperEstimate } from '../../../src/host/orchestration/committer.ts'
import { PromptLibrary } from '../../../src/host/prompts/library.ts'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { HELPER_PRESET } from '../../../src/host/agents/child.ts'
import * as helperPlugin from '../../../src/helper.ts'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoleplayState, sessionFolder, type Session } from '@dsh-agentic-roleplay/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoleplayOrchestration } from '../../../src/host/orchestration/service.ts'
import { readRunDetail } from '../../../src/host/sessions/activity.ts'
import { writeSettings } from '../../../src/host/sessions/settings.ts'
import { readDecisionStats } from '../../../src/host/decisions/stats.ts'
import { decodeOutput } from '../../../src/shared/narration.ts'
import { readTimeline, writeTimeline } from '../../../src/host/timeline/file.ts'
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
  /** Every character keeps looking into its memory this many times, whatever it is told, before it decides. */
  characterLooksUp?: number
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
  /** The game master introduces things itself: how many it brings in before delivering. */
  introduce?: number
  expand?: { author: 'creates' | 'incomplete' | 'declines' | 'pointless' | 'greedy' | 'object' | 'loops' | 'repeats' | 'unfitting'; need?: string }
  /** What Alice and Bob do with things as a result of the round: Alice takes the lantern; both try to take it and the second is refused; Bob unlocks the chest with his key and opens it. */
  things?: 'take' | 'conflict' | 'unlock'
  /** How the game master deals with time: says a round took ten minutes; or skips to seven in the morning before it delivers. */
  time?: 'stated' | 'skip'
  /** How the game master judges the player's action: allows it (the default), refuses it, or does not judge at all. */
  judge?: 'refuses' | 'skipped'
  /** The turn is an out-of-character command: the game master rules it legal and sends Bob down to the cellar by decree, spawns nothing, or rules it illegal. */
  /** What the language model says when asked whether the output has a fault the checks look for. */
  gate?: 'fault'
  ooc?: 'moves-bob' | 'illegal' | 'acts-before-ruling' | 'question'
  /** The player's character walks out to the street, and nobody else needs to react: the game master resolves a round with only its outcome. */
  player?: 'walks'
  /** The suggester writes its lines as plain text instead of submitting them, until it is reminded. */
  suggester?: 'forgets'
  /** The game master has Bob's feelings change as a result of the round: he is upset. */
  variables?: 'upset'
}

const EVENING = Date.UTC(1912, 9, 4, 21, 40)
const SUGGESTED = ['Ask Alice about the key', 'Take the lantern', 'Leave the room']
const PREVIEW = 'Air goes still for a second, and the lamplight catches Alice\'s eyes. How will she answer?'
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
  if (mode === 'repeats') return call(`a-rep-${edits}`, 'edit_world', { turn, items: [{ key: 'note', name: 'Folded note', wearable: '' }] })
  if (mode === 'loops') return call(`a-loop-${lints}`, 'world_lint', {})
  if (mode === 'unfitting') return call(`a-unfit-${timesCalled(request, 'submit_result')}-${request.messages.length}`, 'submit_result', { summary: 'no outcome given, so the result does not fit its schema' })
  if (mode === 'declines') return call('a-decline', 'submit_result', { outcome: 'declined', summary: 'The innkeeper already serves; no new person is needed.' })
  if (mode === 'pointless') {
    if (edits === 0 && !last?.isError) return submitCreated
    return call('a-decline', 'submit_result', { outcome: 'declined', summary: 'On reflection nothing is needed.' })
  }
  if (mode === 'object') {
    if (edits === 0) return call('a-object', 'edit_world', { turn, items: [{ key: 'note', name: 'Folded note', description: 'Handed over at the door.', notable: true, held_by: 'arthur' }] })
    return submitCreated
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
  return answerWithoutSuggestions(script)
}

function answerWithoutSuggestions(script: Script) {
  return (request: GenerateOptions): StreamChunk[] => {
    if (systemOf(request).includes('You suggest what the player could do next')) return script.suggester === 'forgets' && !asText(request).includes('You have not finished') ? text('1. Ask Alice about the key') : call('sg-submit', 'submit_result', { options: SUGGESTED })
    if (systemOf(request).includes('You check one passage of narration') || systemOf(request).includes('You check one passage of an interactive story')) return call('t-gate', 'submit_result', { reason: 'It stays inside the story.', fault: script.gate === 'fault' })
    if (systemOf(request).includes('You judge statements about an interactive story')) return call('t-judge', 'submit_result', { verdicts: [{ number: 1, holds: true, reason: 'The records show Alice at the vault.' }] })
    if (systemOf(request).includes('You tidy the memory of one character')) {
      const taken = [...asText(request).matchAll(/- p(\d+)/g)].map(match => Number(match[1]))
      return call('r-submit', 'submit_result', { add: taken.length < 2 ? [] : [{ kind: 'belief', text: 'Bob keeps taking what is not his.', about: ['Bob'], importance: 3, perceptions: taken.slice(0, 2) }], revise: [], drop: [] })
    }
    if (systemOf(request).includes('strategist of an organisation')) return call('f-submit', 'submit_result', { summary: 'The Guild quietly buys the cellar lease.', public_state: 'Seen at the cellar door.', new_goal: { name: 'Hold the cellar', description: 'Keep others out of the cellar.', plan: ['post a guard'] } })
    if (systemOf(request).includes('record keeper of an interactive story')) return keeperAnswer(request, script)
    if (systemOf(request).includes('world author of an interactive story')) return authorAnswer(request, script)
    if (systemOf(request).includes('out-of-character question that a player asks')) return call('q-answerer', 'submit_result', { answer: 'Bob has not told Alice, so she does not know.' })
    const who = /You are (Alice|Bob|Carol|Dan)\./.exec(systemOf(request))?.[1]
    if (who !== undefined) {
      const retry = asText(request).includes('trying again')
      const later = asText(request).includes('Earlier in this scene')
      if (script.characterLooksUp !== undefined && toolNames(request).includes('recall_my_memories') && timesCalled(request, 'recall_my_memories') < script.characterLooksUp) return call(`s-${who}-look-${timesCalled(request, 'recall_my_memories')}`, 'recall_my_memories', { about: `the key ${timesCalled(request, 'recall_my_memories')}` })
      if (script.characterLookup === true && timesCalled(request, 'recall_my_memories') === 0) return call(`s-${who}-recall`, 'recall_my_memories', { about: 'the key' })
      if (later && who === 'Bob') return call('s-Bob-later', 'submit_result', { intent: 'Bob objects', utterance: 'Why is he here?', commitment: 'low' })
      const away = asText(request).includes('nothing of this happens in front of anyone') ? { account: `${who} dealt with it out of sight.`, ...(who === 'Carol' ? { commitment: 'medium' } : {}) } : {}
      return call(`s-${who}`, 'submit_result', retry ? { intent: `${who} grabs the lantern instead`, utterance: 'Give it here!', commitment: 'medium' } : { ...intents[who]!, ...away })
    }
    if (systemOf(request).includes('chronicler of an interactive story')) return call('c-summary', 'submit_result', { summary: 'The chronicler wrote this account of the earlier turns.' })
    if (!toolNames(request).includes('activate_characters')) return text('a title')
    if (script.ooc === 'question' && thisTurn(request).includes('OUT-OF-CHARACTER QUESTION')) {
      if (timesCalled(request, 'ooc_answer') === 0) return call('q-ans', 'ooc_answer', {})
      return timesCalled(request, 'narrate') === 0 ? call('q-nar', 'narrate', { segments: [] }) : text('')
    }
    if (script.ooc !== undefined && thisTurn(request).includes('OUT-OF-CHARACTER COMMAND')) {
      const ruled = timesCalled(request, 'ooc_ruling')
      if (script.ooc === 'acts-before-ruling' && ruled === 0 && timesCalled(request, 'resolve_round') === 0) return call('o-early', 'resolve_round', { outcomes: [{ character: 'bob', result: 'succeeded', summary: 'Bob leaves', moves_to: { location: 'cellar', ignore_exits: true } }] })
      if (ruled === 0) return call('o-rule', 'ooc_ruling', script.ooc === 'illegal' ? { rule_check: 'There is no magic: broken.', legal: false, reason: 'The world has no magic, so Bob cannot vanish in smoke.' } : { rule_check: 'no rules listed', legal: true, reason: 'Bob goes down to the cellar.' })
      if (script.ooc === 'illegal') return timesCalled(request, 'narrate') === 0 ? call('o-nar', 'narrate', { segments: [] }) : text('')
      if (timesCalled(request, 'resolve_round') - (script.ooc === 'acts-before-ruling' ? 1 : 0) === 0) return call('o-res', 'resolve_round', { outcomes: [{ character: 'bob', result: 'succeeded', summary: 'Bob goes down to the cellar, urgently', moves_to: { location: 'cellar', ignore_exits: true } }] })
      if (timesCalled(request, 'record_memory') === 0) return call('o-rec', 'record_memory', { focus: 'Bob was sent down to the cellar.' })
      return timesCalled(request, 'narrate') === 0 ? call('o-nar', 'narrate', { segments: [{ type: 'narration', text: 'Bob stands abruptly and hurries down the stair.' }] }) : text('')
    }
    if (timesCalled(request, 'judge_action') - (thisTurn(request).includes('a check of the rules found') ? 1 : 0) === 0 && !thisTurn(request).includes('input is refused') && script.judge !== 'skipped') return call('j-judge', 'judge_action', script.judge === 'refuses' ? { rule_check: 'There is no magic: broken.', allowed: false, uncertain: false, reason: 'The world has no magic, so no fireball can come of a wave of the hand.' } : { rule_check: 'no rules listed', allowed: true, uncertain: false, reason: 'The character acts within what the world allows.' })
    if (script.judge === 'refuses' && timesCalled(request, 'judge_action') > 0) {
      if (timesCalled(request, 'resolve_round') === 0) return call('j-res', 'resolve_round', { outcomes: [{ character: 'arthur', result: 'failed', summary: 'Arthur waves a hand at the lamp; nothing comes of it' }] })
      return timesCalled(request, 'narrate') === 0 ? call('j-nar', 'narrate', { segments: [{ type: 'narration', text: 'You wave a hand at the lamp. Nothing happens.' }] }) : text('')
    }
    if (toolNames(request).includes('preview_scene') && timesCalled(request, 'preview_scene') === 0 && !thisTurn(request).includes('input is refused')) return call('m-prev', 'preview_scene', { text: PREVIEW })
    const activated = timesCalled(request, 'activate_characters')
    // A refused call still counts as a call, so one refusal is taken off.
    const resolved = timesCalled(request, 'resolve_round') - (script.moves === 'locked-first' && thisTurn(request).includes('cannot go to') ? 1 : 0) - (script.things === 'conflict' && thisTurn(request).includes('cannot take') ? 1 : 0)
    const delivered = timesCalled(request, 'narrate')
    if (script.player === 'walks' && !thisTurn(request).includes('input is refused')) {
      if (resolved === 0) return call('m-walk', 'resolve_round', { outcomes: [{ character: 'arthur', result: 'succeeded', summary: 'Arthur walks out to the street', moves_to: { location: 'street', position: 'by the lamp' } }] })
    if (script.skipRecord !== true && timesCalled(request, 'record_memory') === 0) return call('m-rec', 'record_memory', { focus: 'Arthur left the bar.' })
      if (delivered === 0) return call('n-walk', 'narrate', { segments: [{ type: 'narration', text: 'You step out onto Main Street.' }] })
      return text('')
    }
    const objected = thisTurn(request).includes('You may not end the turn yet')
    if (script.early === true && !objected) return text('The scene is over, I think.')
    if (thisTurn(request).includes('input is refused')) return text('I cannot do that.')
    if (script.lookup === true && timesCalled(request, 'search_events') === 0) return call('m0', 'search_events', { text: 'key' })
    if (script.twoRounds === true) return twoRounds(request, activated, resolved, script.skipRecord !== true)
    if (activated === 0) return call('m1', 'activate_characters', { situation: 'Arthur opens the vault door. A key lies inside.', characters: ['alice', 'bob', 'carol', 'dan'] })
    const withMove = (key: string) => round1.map(outcome => (outcome.character === 'bob' ? { ...outcome, moves_to: { location: key, position: 'by the barrels' } } : outcome))
    const handling = (): object[] => round1.map((outcome) => {
      if (script.things === 'take' && outcome.character === 'alice') return { ...outcome, item_changes: [{ item: 'lantern', action: 'take' }] }
      if (script.things === 'conflict' && (outcome.character === 'alice' || outcome.character === 'bob') && !refusedThing) return { ...outcome, item_changes: [{ item: 'lantern', action: 'take' }] }
      if (script.things === 'conflict' && outcome.character === 'alice') return { ...outcome, item_changes: [{ item: 'lantern', action: 'take' }] }
      if (script.things === 'unlock' && outcome.character === 'bob') return { ...outcome, item_changes: [{ item: 'chest', action: 'unlock', with: 'brass-key' }, { item: 'chest', action: 'open' }] }
      return outcome
    })
    const refusedMove = lastTool(request)?.isError === true && lastToolText(request).includes('cannot go to')
    const refusedThing = lastTool(request)?.isError === true && lastToolText(request).includes('cannot take')
    if (script.moves === 'locked-first' && refusedMove) return call('m2b', 'resolve_round', { outcomes: withMove('cellar') })
    if (script.things === 'conflict' && refusedThing) return call('m2c', 'resolve_round', { outcomes: handling() })
    if (resolved === 0) {
      if (script.moves === 'cellar') return call('m2', 'resolve_round', { outcomes: withMove('cellar') })
      if (script.moves === 'locked-first') return call('m2', 'resolve_round', { outcomes: withMove('vault') })
      if (script.things !== undefined) return call('m2', 'resolve_round', { outcomes: handling() })
      return call('m2', 'resolve_round', { ...(script.time === 'stated' ? { elapsed_seconds: 600 } : {}), outcomes: script.variables === 'upset' ? round1.map(entry => (entry.character === 'bob' ? { ...entry, variable_changes: [{ variable: 'valence', subject: 'bob', to: -0.6 }] } : entry)) : round1 })
    }
    if (resolved === 1 && thisTurn(request).includes('tried once more')) {
      return call('m3', 'resolve_round', { outcomes: [{ character: 'dan', result: 'succeeded', summary: 'Dan takes the lantern too' }] })
    }
    if (script.time === 'skip' && timesCalled(request, 'advance_time') === 0) return call('m-time', 'advance_time', { until_time: '07:00', reason: 'they sleep' })
    if (script.expand !== undefined && timesCalled(request, 'expand_world') === 0) return call('m-exp', 'expand_world', { need: script.expand.need ?? 'arrival', what: script.expand.author === 'object' ? 'A folded note was just handed to Arthur by a stranger at the door.' : 'A ferry pilot named Mira Voss has just come up the lane to the bar with news.' })
    if (script.introduce !== undefined && timesCalled(request, 'introduce_thing') < script.introduce) return call(`m-intro-${timesCalled(request, 'introduce_thing')}`, 'introduce_thing', { name: `Plank barricade ${timesCalled(request, 'introduce_thing') + 1}`, description: 'Heavy planks, nailed across the door.' })
    if (script.skipRecord !== true && timesCalled(request, 'record_memory') === 0) return call('m-rec', 'record_memory', { focus: 'The key changed hands.' })
    const delivery = script.delivery ?? 'good'
    if (thisTurn(request).includes('has been delivered to the player')) return text('')
    if (delivery === 'none') return text('Done.')
    if (delivery === 'narrator') return call('n-narrator', 'narrate', {})
    const refused = thisTurn(request).includes('the output is not acceptable')
    if (delivered === 0 || refused) {
      const changed = delivery === 'stubborn' || (delivery === 'changed-once' && delivered === 0)
      const output = script.padding === undefined ? goodOutput : [alice, { type: 'narration', text: `Alice stands and walks to the door while Bob stares at you. ${'z'.repeat(script.padding)}` }, ...goodOutput.slice(2)]
      return call(`n${delivered}`, 'narrate', { segments: changed ? [{ ...alice, text: 'This is unexpected.' }, ...output.slice(1)] : output, ...(thisTurn(request).includes('[1] The inn bell tolls ten.') ? { addressed: [1] } : {}) })
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
    const way = (from: number, to: number, description: string, state: 'open' | 'locked' = 'open', note = '', travelSeconds?: number) => {
      session.locations.addExit({ fromId: from, toId: to, description, state, note, ...(travelSeconds === undefined ? {} : { travelSeconds }) })
      session.locations.addExit({ fromId: to, toId: from, description, state, note, ...(travelSeconds === undefined ? {} : { travelSeconds }) })
    }
    way(bar.id, street.id, 'the door', 'open', '', 120)
    way(bar.id, cellar.id, 'a stair down')
    way(vault.id, cellar.id, '', 'locked', 'needs a key')
    for (const [key, where] of [['arthur', bar], ['alice', bar], ['bob', bar], ['carol', cellar], ['dan', street]] as const) session.placements.place('character', session.characters.getBySourceId(key)!.id, { locationId: where.id })
    const thing = (key: string, name: string, extra: Partial<Parameters<typeof session.items.add>[0]> = {}) => ({ sourceId: key, name, description: '', quantity: 1, unique: false, quality: '', notable: false, hidden: false, ...extra })
    session.items.add(thing('lantern', 'Brass lantern', { notable: true, quality: 'dented' }), { kind: 'location', locationId: bar.id, featureKey: 'counter', position: 'by the till' })
    const key = session.items.add(thing('brass-key', 'Brass key', { unique: true }), { kind: 'character', characterId: session.characters.getBySourceId('bob')!.id, mode: 'held' })
    const chest = session.items.add(thing('chest', 'Oak chest', { container: { state: 'locked' } }), { kind: 'location', locationId: bar.id })
    session.items.setOpeners({ kind: 'item', id: chest.id }, [key.id])
    session.items.add(thing('letter', 'Sealed letter', { hidden: true }), { kind: 'location', locationId: bar.id })
    for (const character of session.characters.list()) {
      const at = session.placements.get('character', character.id)!.locationId
      session.knowledge.learn(character.id, 'location', at, 0, true)
      for (const exit of session.locations.exitsFrom(at)) {
        session.knowledge.learn(character.id, 'exit', exit.id, 0, true)
        session.knowledge.learn(character.id, 'location', exit.toId, 0)
      }
    }
    const bob = session.characters.getBySourceId('bob')!
    session.knowledge.learn(bob.id, 'location', vault.id, 0)
    session.knowledge.learn(bob.id, 'exit', session.locations.getExit(cellar.id, vault.id)!.id, 0)
  }
  session.clock.start('simulated', EVENING)
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
  const agent = handle.agent
  // The records are written behind the story: what looks at them waits for that.
  return new Proxy(agent, {
    get(target, property) {
      if (property === 'whenIdle') return async () => { await target.whenIdle(); await orchestration.settle(chatId) }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
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
  ctx.provide('agentPresets')
  ctx.set('agentPresets', {
    mount: async (childCtx: Context, id: string) => {
      if (id === HELPER_PRESET) await childCtx.plugin(helperPlugin)
    },
    composeFrom: () => undefined,
    composedPreset: () => undefined,
  })
  orchestration = new RoleplayOrchestration(ctx)
  state = new RoleplayState(ctx, { journalMode: 'delete' })
  ctx.provide('roleplayRoot')
  ctx.set('roleplayRoot', { path: root })
  new PromptLibrary(ctx, { path: root } as never)
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
      expect(toolNames(authors(adapter)[0]!).sort()).toEqual(['edit_world', 'get_agenda', 'get_character', 'get_faction', 'get_item', 'get_location', 'list_characters', 'list_factions', 'list_items', 'list_locations', 'list_relationships', 'list_slots', 'list_variables', 'search_events', 'submit_result', 'world_lint'])
      const mira = session.characters.getBySourceId('mira')!
      expect(mira).toMatchObject({ name: 'Mira Voss', role: 'npc', control: 'agent', tier: 'supporting' })
      expect(session.placements.get('character', mira.id)).toMatchObject({ locationId: session.locations.getBySourceId('street')!.id, position: 'by the bar door' })
      expect(session.relationships.get(mira.id, session.characters.getBySourceId('arthur')!.id)?.label).toBe('passenger')
      expect(session.consolidation.pending()).toEqual([expect.objectContaining({ kind: 'character', subjectId: mira.id, createdTurn: 1 })])
      expect(masterSaw(adapter)).toContain('Made up and fitted into the world:\\n- character mira (Mira Voss)')
      expect(masterSaw(adapter)).toContain('now in the cast')
    })

    describe('and the tools of other plugins', () => {
      let board: Record<string, Record<string, boolean>> = {}
      let lift: () => void = () => undefined
      beforeEach(() => {
        lift = ctx.tools.register(defineTool({ name: 'mcp__search__web', description: 'Searches the web.', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'found' } }))
        new AuthoringTools(ctx, () => board)
      })
      afterEach(() => { board = {}; lift() })

      it('has none unless the settings tick them for it', async () => {
        const { adapter } = await playAuthored('creates')
        expect(toolNames(authors(adapter)[0]!)).not.toContain('mcp__search__web')
      })

      it('has the ones ticked for it, and a little more room to call them', async () => {
        board = { worldAuthor: { mcp__search__web: true } }
        const { adapter } = await playAuthored('creates')
        expect(toolNames(authors(adapter)[0]!)).toContain('mcp__search__web')
      })

      it('has none that were ticked for the assistants of other chats or for the story\'s other agents', async () => {
        board = { worldAuthoring: { mcp__search__web: true }, characters: { mcp__search__web: true } }
        const { adapter } = await playAuthored('creates')
        expect(toolNames(authors(adapter)[0]!)).not.toContain('mcp__search__web')
      })
    })

    it('lets the game master introduce a thing itself, where the player is, with no author asked, and not more than the chat allows', async () => {
      const { session, id } = await addSession('Vault', true)
      writeSettings(sessionFolder(join(root, 'sessions'), id), { authoring: { thingsPerTurn: 1 } })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', introduce: 2 }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I barricade the door.'))
      await agent.whenIdle()
      const things = session.items.list().filter(item => item.name.startsWith('Plank'))
      expect(things.map(item => item.name)).toEqual(['Plank barricade 1'])
      expect(session.items.holding(things[0]!.id)).toMatchObject({ holder: { kind: 'location' } })
      expect(authors(adapter)).toEqual([])
      expect(JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))).toContain('already introduced this turn')
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

    it('is stopped when it keeps calling tools past its budget and never submits, and the game master is told it could not be made', async () => {
      const { adapter, session } = await playAuthored('loops')
      expect(authors(adapter).length).toBeLessThan(60)
      expect(session.characters.getBySourceId('mira')).toBeUndefined()
      expect(masterSaw(adapter)).toContain('went on past its 30 calls, or kept repeating a call that failed, without submitting a result and was stopped')
    })

    it('is stopped when every result it submits fails the result\'s own schema, which the harness refuses before the call runs, and the game master is told it could not be made', async () => {
      const { adapter, session } = await playAuthored('unfitting')
      expect(authors(adapter).length).toBeLessThan(60)
      expect(session.characters.getBySourceId('mira')).toBeUndefined()
      expect(masterSaw(adapter)).toContain('without submitting a result and was stopped')
    })

    it('is stopped early when it sends the call that just failed again and again, being told so first, and the game master is told it could not be made', async () => {
      const { adapter, session } = await playAuthored('repeats')
      const author = authors(adapter)
      expect(author.length).toBeLessThan(12)
      expect(JSON.stringify(author.at(-1)!.messages)).toContain('this is exactly the call that just failed')
      expect(session.items.getBySourceId('note')).toBeUndefined()
      expect(masterSaw(adapter)).toContain('kept repeating a call that failed')
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
      expect(toolNames(fitting).sort()).toEqual(['edit_world', 'get_agenda', 'get_character', 'get_faction', 'get_item', 'get_location', 'list_characters', 'list_consolidation', 'list_factions', 'list_items', 'list_locations', 'list_relationships', 'list_slots', 'list_variables', 'resolve_consolidation', 'search_events', 'submit_result', 'world_lint'])
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

  describe('time', () => {
    async function playTime(time?: Script['time'], settings?: object) {
      const { session, id } = await addSession('Vault', true)
      if (settings !== undefined) writeSettings(sessionFolder(join(root, 'sessions'), id), settings)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', ...(time === undefined ? {} : { time }) }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      return { session, adapter, agent, id }
    }
    const characterBrief = (adapter: ScriptedAdapter, who: string) => briefOf(characterRequests(adapter).find(request => systemOf(request).includes(`You are ${who}.`))!)
    const keepers = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('record keeper of an interactive story'))

    it('tells the game master the time and how it moves, and each character what time it is, as the story reads it', async () => {
      const { adapter } = await playTime()
      const scene = thisTurn(masterRequests(adapter)[0]!)
      expect(scene).toContain('Time: Friday 4 October 1912, 21:40 (evening). The story\'s time moves only as you say')
      expect(characterBrief(adapter, 'Alice')).toContain('Now: Friday 4 October 1912, 21:40 (evening).')
    })

    it('passes the default time when the game master says nothing, tells it so, and keeps when the round began', async () => {
      const { session, adapter } = await playTime()
      expect(session.clock.get()).toEqual({ mode: 'simulated', now: EVENING + 30_000 })
      expect(session.clock.at(1, 1)).toBe(EVENING)
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('It is now Friday 4 October 1912, 21:40 (evening); 30 seconds passed.')
    })

    it('asks the characters freely and the record keeper exactly, and has the helpers answer with a tool call', async () => {
      const { adapter } = await playTime('stated')
      const sampled = (requests: GenerateOptions[]) => requests.map(request => adapter.samplings[adapter.requests.indexOf(request)])
      expect(sampled(characterRequests(adapter))).toEqual(characterRequests(adapter).map(() => ({ temperature: 0.8, toolChoice: 'required', maxTokens: 810, priority: 'foreground' })))
      expect(sampled(keepers(adapter))).toEqual(keepers(adapter).map(() => ({ temperature: 0.1, toolChoice: 'required', maxTokens: outputBudget(keeperEstimate(1, 'en'), 2), priority: 'background' })))
      expect(adapter.samplings[adapter.requests.indexOf(masterRequests(adapter)[0]!)]).toBeUndefined()
    })

    it('passes the time the game master says a round took, and the keeper is told when it was and how long it took', async () => {
      const { session, adapter } = await playTime('stated')
      expect(session.clock.get()?.now).toBe(EVENING + 10 * 60_000)
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('It is now Friday 4 October 1912, 21:50 (evening); 10 minutes passed.')
      expect(briefOf(keepers(adapter)[0]!)).toContain('When: Friday 4 October 1912, 21:40 (evening); the round took 10 minutes')
    })

    it('puts the days of the characters into what each is told: their own day and goals to the characters, who went where and what is due to the game master, and the open goals and commitments to the keeper', async () => {
      const { session, id } = await addSession('Vault', true)
      const alice = session.characters.getBySourceId('alice')!.id
      const carol = session.characters.getBySourceId('carol')!.id
      session.routines.replace(alice, [{ days: [], start: 21 * 60, end: 23 * 60, activity: 'tends the bar', locationId: session.locations.getBySourceId('bar')!.id, interruptible: true }])
      session.routines.replace(carol, [{ days: [], start: 20 * 60, end: 23 * 60, activity: 'walks the street', locationId: session.locations.getBySourceId('street')!.id, interruptible: true }])
      session.intents.add(alice, { type: 'obligation', name: 'Find the ledger', description: 'Promised Bob.', status: 'active', horizon: 'day', priority: 0.8, urgency: 0.7, plan: ['Search the shop'], openThreads: [], constraints: [] })
      session.engagements.add({ title: 'Close the bar', at: EVENING + 20 * 60_000, participants: [alice], turn: 1 })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const scene = thisTurn(masterRequests(adapter)[0]!)
      expect(scene).toContain('By their routines since you last looked: Carol went to Main Street (walks the street).')
      expect(scene).toMatch(/Commitments due soon or overdue: \\"Close the bar\\" \(Alice\) is due 22:00/)
      expect(session.placements.get('character', carol)?.locationId).toBe(session.locations.getBySourceId('street')!.id)
      const brief = characterBrief(adapter, 'Alice')
      expect(brief).toContain('Your day, now: tends the bar at The Bar, until 23:00.')
      expect(brief).toContain('You are due to: Close the bar, at 22:00.')
      expect(brief).toContain('What you are after:\n- Find the ledger (obligation): Promised Bob. Next: Search the shop.')
      const keeper = briefOf(keepers(adapter)[0]!)
      expect(keeper).toContain('## Goals of the characters (ids for intent_edits)')
      expect(keeper).toMatch(/- id \d+, alice: Find the ledger \(obligation, active\) plan: Search the shop/)
      expect(keeper).toMatch(/## Pending engagements[^]*- id \d+: Close the bar, 1912-10-04T22:00:00, with alice/)
    })

    it('asks the characters away from the player what they do about a commitment that fell due, after the turn, and moves those who mean to keep it', async () => {
      const { session, id } = await addSession('Vault', true)
      const carol = session.characters.getBySourceId('carol')!.id
      const dan = session.characters.getBySourceId('dan')!.id
      const meeting = session.engagements.add({ title: 'meet in the cellar', at: EVENING - 10 * 60_000, locationId: session.locations.getBySourceId('cellar')!.id, participants: [carol, dan], turn: 0 })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      await vi.waitFor(() => { expect(characterRequests(adapter).filter(request => briefOf(request).includes('You were to meet in the cellar at Cellar')).length).toBe(2) }, { timeout: 5000 })
      const asked = characterRequests(adapter).filter(request => briefOf(request).includes('You were to meet in the cellar at Cellar'))
      expect(asked.map(request => /You are (Carol|Dan)\./.exec(systemOf(request))?.[1]).sort()).toEqual(['Carol', 'Dan'])
      expect(briefOf(asked[0]!)).toContain('It was with: Carol, Dan.')
      const told = asked.filter(request => briefOf(request).includes('has decided:'))
      expect(told).toHaveLength(1)
      expect(systemOf(told[0]!)).toContain('You are Dan.')
      expect(briefOf(told[0]!)).toContain('Carol has decided: Carol takes the key, saying "Oh, please.".')
      await vi.waitFor(() => { expect(session.metadata.getValue('offscene.handled')).toEqual([`e${meeting.id}`]) }, { timeout: 5000 })
      expect(session.placements.get('character', dan)?.locationId).toBe(session.locations.getBySourceId('cellar')!.id)
      expect(session.characterStates.get(dan)?.activity).toBe('Dan takes the key')
      const away = (session.metadata.getValue('notes') as { kind: string; lines: string[] }[]).find(note => note.kind === 'away')
      expect(away?.lines.sort()).toEqual(['Carol dealt with it out of sight.', 'Dan dealt with it out of sight.'])
      const ran = (session.metadata.getValue('activity') as { label: string; error?: string }[]).map(run => run.label)
      expect(ran).toEqual(expect.arrayContaining(['Carol', 'Dan']))
    })

    it('keeps what each helper was told and did, only when the chat asks for it', async () => {
      const { session, id } = await addSession('Vault', true)
      writeSettings(sessionFolder(join(root, 'sessions'), id), { diagnostics: { keepRuns: true } })
      const alice = session.characters.getBySourceId('alice')!.id
      session.events.add({ turn: 0, round: 1, text: 'Alice saw the vault door being sealed.', importance: 3, tags: ['vault'], involves: [] }, [{ characterId: alice, mode: 'witnessed', content: 'The vault door was sealed in front of me.', gist: 'the vault was sealed', accuracy: 'accurate' }])
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      await vi.waitFor(() => { expect((session.metadata.getValue('activity') as { run?: string }[] | undefined)?.some(run => run.run !== undefined)).toBe(true) }, { timeout: 5000 })
      const runs = (session.metadata.getValue('activity') as { label: string; run?: string }[]).filter(run => run.run !== undefined)
      const details = runs.map(run => readRunDetail(sessionFolder(join(root, 'sessions'), id), run.run!))
      expect(details.every(detail => detail !== undefined && detail.persona !== '' && detail.prompt !== '')).toBe(true)
      expect(details.some(detail => detail!.result !== undefined)).toBe(true)
      expect(details.every(detail => detail!.calls.length > 0)).toBe(true)
      expect(details.some(detail => detail!.calls.some(call => call.tool === 'submit_result' && !call.failed))).toBe(true)
      const reminded = details.flatMap(detail => detail!.recalled ?? [])
      expect(reminded.map(entry => entry.text)).toContain('The vault door was sealed in front of me.')
      expect(reminded.every(entry => entry.why !== undefined && entry.why.cues.words >= 0)).toBe(true)
    })

    it('lets an organisation whose time has come decide what it does after the turn, within the limit of the chat, and records it as a deed no one knows', async () => {
      const { session, id } = await addSession('Vault', true)
      const guild = session.factions.add({ sourceId: 'guild', name: 'The Guild', aliases: [], summary: 'Merchants.', description: '', values: [], structure: '' })
      session.factionStates.create(guild.id, { publicState: 'Quiet.' })
      session.factionIntents.add(guild.id, { type: 'agenda', name: 'Control the market', description: 'All of it.', status: 'active', horizon: 'short', priority: 0.6, urgency: 0.4, plan: [], openThreads: [], constraints: [] })
      session.metadata.setValue('strategy.last', { guild: -1e13 })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      await vi.waitFor(() => { expect(session.factionStates.get(guild.id)?.publicState).toBe('Seen at the cellar door.') }, { timeout: 5000 })
      expect(session.factionIntents.list(guild.id, { status: 'active' }).map(goal => goal.name)).toContain('Hold the cellar')
      const deed = session.events.list().find(event => event.text.startsWith('The Guild: '))
      expect(deed).toBeDefined()
      expect(session.events.perceptionsOf(deed!.id)).toEqual([])
      expect((session.metadata.getValue('activity') as { label: string }[]).map(run => run.label)).toContain('faction The Guild')
    })

    describe('reflection', () => {
      const seed = (session: Session): void => {
        for (const turn of [1, 2]) session.edit({ turn, events: [{ turn, round: 1, text: `Bob pockets something at the bar (${turn})`, importance: 2, tags: [], involves: ['bob'], perceivedBy: [{ character: 'alice', mode: 'witnessed', content: `Alice saw Bob pocket something (${turn}).`, gist: 'Bob pockets things' }] }] }, { seal: true })
      }
      const reflections = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('You tidy the memory of one character'))

      it('has a character sort what it took in once the turns asked for have passed, and writes a belief that rests on what it was shown', async () => {
        const { session, id } = await addSession('Vault', true)
        seed(session)
        writeSettings(sessionFolder(join(root, 'sessions'), id), { reflection: { auto: true, everyTurns: 1, onSceneChange: false, minTurns: 1, perRun: 1, minNew: 1 } })
        session.metadata.setValue('reflection.anchor', { now: 0 })
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say('I open the vault door.'))
        await agent.whenIdle()
        await vi.waitFor(() => { expect(session.memories.list(session.characters.getBySourceId('alice')!.id).map(belief => belief.text)).toContain('Bob keeps taking what is not his.') }, { timeout: 5000 })
        const belief = session.memories.list(session.characters.getBySourceId('alice')!.id).find(entry => entry.text.startsWith('Bob keeps'))!
        expect(belief.about).toEqual([session.characters.getBySourceId('bob')!.id])
        expect(session.metadata.getValue('reflection.last')).toMatchObject({ turn: 1, reason: 'turns', characters: [{ name: 'Alice', added: 1, revised: 0, dropped: 0 }] })
        const asked = reflections(adapter)
        expect(asked).toHaveLength(1)
        expect(toolNames(asked[0]!)).toEqual(['submit_result'])
        expect(asText(asked[0]!)).toContain('Alice saw Bob pocket something (1).')
        expect(asText(asked[0]!)).not.toContain('Bob pockets something at the bar')
        expect((session.metadata.getValue('activity') as { label: string }[]).map(run => run.label)).toContain('reflection Alice')
        expect(session.events.list().some(event => event.text.includes('Bob keeps taking'))).toBe(false)
      })

      it('does nothing by itself while the setting is off, and does it when asked', async () => {
        const { session, id } = await addSession('Vault', true)
        seed(session)
        writeSettings(sessionFolder(join(root, 'sessions'), id), { reflection: { auto: false, everyTurns: 1, onSceneChange: false, minTurns: 1, perRun: 1, minNew: 1 } })
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say('I open the vault door.'))
        await agent.whenIdle()
        await orchestration.settle(`session-${id}`)
        expect(reflections(adapter)).toHaveLength(0)
        await orchestration.reflect(`session-${id}`)
        await vi.waitFor(() => { expect(session.metadata.getValue('reflection.last')).toMatchObject({ reason: 'manual' }) }, { timeout: 5000 })
        expect(session.memories.list(session.characters.getBySourceId('alice')!.id).map(belief => belief.text)).toContain('Bob keeps taking what is not his.')
        expect(orchestration.reflecting(`session-${id}`)).toBe(false)
      })
    })

    it('has the game master change what is tracked in an outcome: it is applied, said back, kept for the keeper, and told to those who can tell, and in the next scene', async () => {
      const { session, id } = await addSession('Vault', true)
      session.variables.define({ key: 'health', name: 'Health', kind: 'number', subject: 'character', min: 0, max: 10, default: 10, visibility: 'public', bands: [{ upTo: 3, label: 'hurt' }, { upTo: 10, label: 'well' }] })
      session.variables.set('health', 'character', session.characters.getBySourceId('alice')!.id, { value: 2 }, 0)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', variables: 'upset' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const bob = session.characters.getBySourceId('bob')!.id
      expect(session.variables.get('valence', 'character', bob)).toMatchObject({ value: -0.6, updatedTurn: 1 })
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('Bob\'s Valence is now miserable (-0.6) (it was even (0)).')
      expect(thisTurn(masterRequests(adapter)[0]!)).toMatch(/Alice \(alice\): Health: hurt \(2\)/)
      expect(characterBrief(adapter, 'Bob')).not.toContain('Valence')
      expect(characterBrief(adapter, 'Alice')).toContain('How you are (what you can tell of yourself):\nHealth: hurt (2)')
      expect(characterBrief(adapter, 'Bob')).toContain('What you can tell of the others here:\n- Alice: Health: hurt (2)')
      expect(briefOf(keepers(adapter)[0]!)).toContain('the game master changed what is tracked: Bob\'s Valence even (0) -> miserable (-0.6)')
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(thisTurn(masterRequests(adapter).findLast(request => thisTurn(request).includes('I look around'))!)).toMatch(/Bob \(bob\): Valence: miserable \(-0.6\)/)
    })

    it('offers the player what to do next afterwards, in the background, from what they read: the output is not held back and the game master is not asked', async () => {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const delivered = outputsOf(agent)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]).not.toHaveProperty('suggestions')
      expect(masterRequests(adapter).every(request => !toolNames(request).includes('suggest_actions'))).toBe(true)
      await vi.waitFor(() => { expect(session.metadata.getValue('notes')).toEqual([{ kind: 'suggestions', turn: 1, lines: SUGGESTED }]) }, { timeout: 5000 })
      const asked = adapter.requests.filter(request => systemOf(request).includes('You suggest what the player could do next'))
      expect(asked).toHaveLength(1)
      expect(toolNames(asked[0]!).sort()).toEqual(['submit_result'])
      const prompt = JSON.stringify(asked[0]!.messages)
      expect(prompt).toContain('Write exactly 3 suggestions.')
      expect(prompt).toContain('That is not something I expected.')
      expect(prompt).not.toContain('Alice takes the lantern')
    })

    it('reminds a helper that stopped without submitting, and takes what it submits then', async () => {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', suggester: 'forgets' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      await vi.waitFor(() => { expect(session.metadata.getValue('notes')).toEqual([{ kind: 'suggestions', turn: 1, lines: SUGGESTED }]) }, { timeout: 5000 })
      expect(adapter.requests.filter(request => systemOf(request).includes('You suggest what the player could do next'))).toHaveLength(2)
    })

    it('has a model judge a statement a trigger waits on after the turn, and fires the trigger from the verdict at the next turn, not before', async () => {
      const { session, id } = await addSession('Vault', true)
      session.triggers.add({ key: 'trust', name: 'Trust broken', condition: { type: 'judged', text: 'Alice no longer trusts Bob.' }, effects: [{ type: 'beat', text: 'Alice keeps her distance from Bob.' }], repeat: false, priority: 0 }, 'world', 0)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(session.triggers.getByKey('trust')?.status).toBe('dormant')
      await vi.waitFor(() => { expect(session.metadata.getValue('triggers.judged')).toEqual({ 'Alice no longer trusts Bob.': { holds: true, turn: 1 } }) }, { timeout: 5000 })
      const judge = adapter.requests.find(request => systemOf(request).includes('You judge statements about an interactive story'))!
      expect(asText(judge)).toContain('1. Alice no longer trusts Bob.')
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(session.triggers.getByKey('trust')).toMatchObject({ status: 'fired', fireCount: 1 })
      expect(thisTurn(masterRequests(adapter).at(-1)!)).toContain('Alice keeps her distance from Bob.')
    })

    describe('the trigger judge with a decision model', () => {
      const STATEMENT = 'Alice no longer trusts Bob.'
      const judged = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('You judge statements about an interactive story'))
      const sure = (probability: number) => {
        const seen: { state: unknown; questions: Record<string, { instructions: string }> }[] = []
        ctx.provide('decisions')
        ctx.set('decisions', { provider: 'fake', model: 'decide-1', decide: (state: unknown, questions: Record<string, { instructions: string }>) => { seen.push({ state, questions }); return Promise.resolve({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', probability }])), model: 'decide-1' }) } })
        return seen
      }
      const play = async (mode: string) => {
        const { session, id } = await addSession('Vault', true)
        writeSettings(sessionFolder(join(root, 'sessions'), id), { decisions: { triggers: mode } })
        session.triggers.add({ key: 'trust', name: 'Trust broken', condition: { type: 'judged', text: STATEMENT }, effects: [{ type: 'beat', text: 'Alice keeps her distance from Bob.' }], repeat: false, priority: 0 }, 'world', 0)
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say('I open the vault door.'))
        await agent.whenIdle()
        await vi.waitFor(() => { expect(session.metadata.getValue('triggers.judged')).toEqual({ [STATEMENT]: { holds: true, turn: 1 } }) }, { timeout: 5000 })
        await vi.waitFor(() => { expect(readDecisionStats(sessionFolder(join(root, 'sessions'), id)).sites.triggers.runs).toBe(1) }, { timeout: 5000 })
        return { adapter, stats: readDecisionStats(sessionFolder(join(root, 'sessions'), id)).sites.triggers }
      }

      it('has the decision model judge the statement, without a request to the language model, when the chat is set to use it', async () => {
        const seen = sure(0.97)
        const { adapter, stats } = await play('decision')
        expect(judged(adapter)).toHaveLength(0)
        expect(seen).toHaveLength(1)
        expect(Object.values(seen[0]!.questions)[0]!.instructions).toContain(STATEMENT)
        expect(JSON.stringify(seen[0]!.state)).toContain('recorded_events')
        expect(stats).toMatchObject({ runs: 1, items: 1, decided: 1, escalated: 0, fallbacks: 0 })
      })

      it('has the language model judge it and records whether the decision model agreed, in the comparing mode', async () => {
        sure(0.97)
        const { adapter, stats } = await play('shadow')
        expect(judged(adapter)).toHaveLength(1)
        expect(stats).toMatchObject({ runs: 1, items: 1, decided: 0, agreed: 1, disagreed: 0 })
      })

      it('goes on with the language model, and keeps why, when the chat is set to use a decision model that is not there', async () => {
        const { adapter, stats } = await play('decision')
        expect(judged(adapter)).toHaveLength(1)
        expect(stats).toMatchObject({ decided: 0, fallbacks: 1 })
        expect(stats.problem).toContain('no decision service')
      })
    })

    describe('the checks of the output with a decision model', () => {
      const told = (adapter: ScriptedAdapter, text: string) => masterRequests(adapter).filter(request => asText(request).includes(text)).length
      /** A decision service that answers its questions with the given probabilities in turn, then with the last of them. */
      const answering = (probabilities: number[]) => {
        const seen: { state: Record<string, unknown>; questions: Record<string, { instructions: string }> }[] = []
        ctx.provide('decisions')
        ctx.set('decisions', { provider: 'fake', model: 'decide-1', decide: (state: Record<string, unknown>, questions: Record<string, { instructions: string }>) => { const probability = probabilities[Math.min(seen.length, probabilities.length - 1)]!; seen.push({ state, questions }); return Promise.resolve({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', probability }])), model: 'decide-1' }) } })
        return seen
      }
      const play = async (settings: object, message = 'I open the vault door.', script: Script = {}) => {
        const { id } = await addSession('Vault')
        writeSettings(sessionFolder(join(root, 'sessions'), id), settings)
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', ...script }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say(message))
        await agent.whenIdle()
        return { adapter, agent, folder: sessionFolder(join(root, 'sessions'), id) }
      }

      it('sends the narration back once when the decision model is sure it speaks for the player, and delivers the corrected one', async () => {
        const seen = answering([0.97, 0.05])
        const { adapter, agent, folder } = await play({ decisions: { agency: 'decision' } })
        expect(outputsOf(agent)).toHaveLength(1)
        expect(outputsOf(agent)[0]).toMatchObject({ repaired: false })
        expect(told(adapter, 'speaks, acts or thinks for')).toBe(1)
        expect(seen).toHaveLength(2)
        expect(seen[0]!.state['player_message']).toBe('I open the vault door.')
        expect(String(seen[0]!.state['player_character'])).toContain('Arthur')
        expect(readDecisionStats(folder).sites.agency).toMatchObject({ runs: 2, items: 2, decided: 2 })
      })

      it('lets a game master that will not change it go on after two refusals, so a check cannot trap the chat', async () => {
        const seen = answering([0.99])
        const { adapter, agent } = await play({ decisions: { agency: 'decision' } })
        expect(outputsOf(agent)).toHaveLength(1)
        expect(told(adapter, 'speaks, acts or thinks for')).toBe(2)
        expect(seen).toHaveLength(2)
      })

      it('sends back an output that steps out of the story, from the whole passage with what the characters say', async () => {
        const seen = answering([0.99, 0.01])
        const { adapter, agent } = await play({ decisions: { refusal: 'decision' } })
        expect(outputsOf(agent)).toHaveLength(1)
        expect(told(adapter, 'steps out of the story')).toBe(1)
        expect(String(seen[0]!.state['passage'])).toContain('Alice')
      })

      it('puts the action against the rules once more when the chat has the rule check on, and has the game master judge again with the rule it found, once', async () => {
        const seen = answering([0.9])
        const { adapter, agent, folder } = await play({ decisions: { rules: 'on' }, rules: { own: 'There is no magic.' } }, 'I cast a fireball at the lamp.')
        expect(outputsOf(agent)).toHaveLength(1)
        expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('a check of the rules found that this action may break: \\"There is no magic.\\"')
        expect(masterRequests(adapter).filter(request => timesCalled(request, 'judge_action') === 2).length).toBeGreaterThan(0)
        expect(seen).toHaveLength(1)
        expect(seen[0]!.state).toMatchObject({ player_message: 'I cast a fireball at the lamp.' })
        expect(readDecisionStats(folder).sites.rules).toMatchObject({ runs: 1, items: 1, decided: 1 })
      })

      it('does not ask the decision model about the rules while the check is off, or when there are none', async () => {
        const seen = answering([0.9])
        await play({ rules: { own: 'There is no magic.' } })
        expect(seen).toEqual([])
      })

      it('does not ask the decision model about the rules when there are none to check', async () => {
        const seen = answering([0.9])
        await play({ decisions: { rules: 'on' } })
        expect(seen).toEqual([])
      })

      it('does not put an action the game master refuses itself against the rules', async () => {
        const seen = answering([0.9])
        await play({ decisions: { rules: 'on' }, rules: { own: 'There is no magic.' } }, 'I cast a fireball at the lamp.', { judge: 'refuses' })
        expect(seen).toEqual([])
      })

      it('goes on with the turn, and says why, when the rule check is on and no decision service is there', async () => {
        const { agent, folder } = await play({ decisions: { rules: 'on' }, rules: { own: 'There is no magic.' } })
        expect(outputsOf(agent)).toHaveLength(1)
        expect(readDecisionStats(folder).sites.rules.problem).toContain('no decision service')
      })

      it('sends the output back once for hidden lore the decision model finds given away, names it, and lets a revelation the game master repeats go through', async () => {
        const { session, id } = await addSession('Vault', true)
        session.lore.add({ sourceId: 'vault-secret', title: 'The vault key', kind: 'other', scope: 'listed', summary: 'The key to the vault is hidden under the third stone.', body: '', subjects: [], related: [], sources: [] })
        writeSettings(sessionFolder(join(root, 'sessions'), id), { decisions: { secrets: 'on' } })
        const seen = answering([0.9])
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say('I open the vault door.'))
        await agent.whenIdle()
        expect(outputsOf(agent)).toHaveLength(1)
        expect(told(adapter, 'may give away what Arthur does not know yet (The vault key)')).toBe(1)
        expect(seen).toHaveLength(1)
        expect(Object.values(seen[0]!.questions)[0]!.instructions).toContain('The key to the vault is hidden under the third stone.')
        expect(readDecisionStats(sessionFolder(join(root, 'sessions'), id)).sites.secrets).toMatchObject({ runs: 1, items: 1, decided: 1 })
      })

      it('does not check for secrets while the check is off, or when nothing is hidden from the player', async () => {
        const seen = answering([0.9])
        await play({})
        await play({ decisions: { secrets: 'on' } })
        expect(seen).toEqual([])
      })

      it('asks nobody while the checks are off, and does not check an out-of-character turn', async () => {
        const seen = answering([0.99])
        await play({})
        expect(seen).toEqual([])
        const { agent } = await play({ decisions: { agency: 'decision', refusal: 'decision' } }, '/ooc Bob now goes down to the cellar, something urgent came up')
        expect(outputsOf(agent).length).toBeLessThanOrEqual(1)
        expect(seen).toEqual([])
      })

      it('sends the narration back when the language model finds the fault, up to the same limit', async () => {
        const { adapter, agent } = await play({ decisions: { agency: 'llm' } }, 'I open the vault door.', { gate: 'fault' })
        expect(outputsOf(agent)).toHaveLength(1)
        expect(told(adapter, 'speaks, acts or thinks for')).toBe(2)
        expect(adapter.requests.filter(request => systemOf(request).includes('You check one passage of narration'))).toHaveLength(2)
      })

      it('asks the language model when the check is set to it, and delivers as before when it finds no fault', async () => {
        const { adapter, agent } = await play({ decisions: { agency: 'llm' } })
        expect(outputsOf(agent)).toHaveLength(1)
        expect(adapter.requests.filter(request => systemOf(request).includes('You check one passage of narration'))).toHaveLength(1)
        expect(told(adapter, 'speaks, acts or thinks for')).toBe(0)
      })
    })

    it('has the world act by itself: what came true at the start of the turn is told to the game master with its beat, the character is made to notice its cue, and the beat is done once woven in', async () => {
      const { session, id } = await addSession('Vault', true)
      session.triggers.add({ key: 'dusk', name: 'Dusk bell', condition: { type: 'time', from: '1912-10-04T21:00' }, effects: [{ type: 'beat', text: 'The inn bell tolls ten.' }, { type: 'cue', audience: { characters: ['alice'] }, text: 'You smell smoke.' }], repeat: false, priority: 0 }, 'world', 0)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const scene = thisTurn(masterRequests(adapter)[0]!)
      expect(scene).toContain('The world acted since the last turn, by itself:')
      expect(scene).toContain('Alice noticed: You smell smoke.')
      expect(scene).toContain('- [1] The inn bell tolls ten.')
      expect(briefOf(characterRequests(adapter).find(request => systemOf(request).includes('You are Alice.'))!)).toContain('Just now you notice:\n- You smell smoke.')
      expect(characterRequests(adapter).filter(request => systemOf(request).includes('You are Bob.')).every(request => !briefOf(request).includes('smell smoke'))).toBe(true)
      expect(outputsOf(agent)).toHaveLength(1)
      expect(session.triggers.notes({ status: 'pending' })).toEqual([])
      expect(session.triggers.getByKey('dusk')).toMatchObject({ status: 'fired', fireCount: 1 })
    })

    it('tells what is known beforehand to the game master and to those who know of it, and never a secret', async () => {
      const { session, id } = await addSession('Vault', true)
      const effects = [{ type: 'beat' as const, text: 'x' }]
      session.triggers.add({ key: 'exam', name: 'Exam', condition: { type: 'time', from: '1912-10-08T09:00' }, effects, repeat: false, priority: 0, announce: { audience: { characters: ['alice'] }, text: 'The final exam is at nine.' } }, 'world', 0)
      session.triggers.add({ key: 'war', name: 'War', condition: { type: 'time', from: '1912-10-20T00:00' }, effects, repeat: false, priority: 0 }, 'world', 0)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(thisTurn(masterRequests(adapter)[0]!)).toContain('The final exam is at nine. (Tuesday 8 October 1912, 09:00, in 3 days 11 hours) [known to Alice]')
      expect(briefOf(characterRequests(adapter).find(request => systemOf(request).includes('You are Alice.'))!)).toContain('What you know is coming:\n- The final exam is at nine. (Tuesday 8 October 1912, 09:00, in 3 days 11 hours)')
      expect(characterRequests(adapter).filter(request => systemOf(request).includes('You are Bob.')).every(request => !briefOf(request).includes('final exam'))).toBe(true)
      expect(JSON.stringify(adapter.requests.map(request => request.messages))).not.toContain('Trigger')
      expect(JSON.stringify(adapter.requests.map(request => [systemOf(request), request.messages]))).not.toContain('1912-10-20')
    })

    describe('withdrawing a turn from the middle of the conversation', () => {
      const marker = () => createUserMessage({ content: [{ type: 'text', text: '(empty message)' }], source: { kind: 'roleplay' } })
      async function playThree() {
        const { id } = await addSession('Vault', true)
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        for (const message of ['move one', 'move two', 'move three']) { agent.followup(say(message)); await agent.whenIdle() }
        return { adapter, agent }
      }
      const rangeOfSecond = (session: { snapshotEvents(): readonly { seq: number; type: string; data: unknown }[]; surface: { nodes: readonly number[] } }) => {
        const humans = session.snapshotEvents().filter(event => event.type === 'user/message' && (event.data as { source: { kind: string } }).source.kind === 'user')
        const surface = [...session.surface.nodes]
        return surface.slice(surface.indexOf(humans[1]!.seq), surface.indexOf(humans[2]!.seq))
      }
      const sentText = (request: { messages: readonly unknown[] }) => JSON.stringify(request.messages)

      it('is accepted when a newer message follows it: the marker takes the range\'s place on the surface and the next request no longer carries the withdrawn turn', async () => {
        const { adapter, agent } = await playThree()
        const range = rangeOfSecond(agent.session as never)
        agent.session.append('user/message', marker(), { surfaceOp: { op: 'replace', startSeq: range[0] as never, endSeq: range.at(-1) as never }, sourceEventSeqs: range as never })
        const surface = [...agent.session.surface.nodes] as number[]
        expect(range.some(seq => surface.includes(seq))).toBe(false)
        expect(surface.length).toBeLessThan(43)
        agent.followup(say('move four'))
        await agent.whenIdle()
        const first = masterRequests(adapter).find(request => sentText(request).includes('move four'))!
        expect(sentText(first)).toContain('move one')
        expect(sentText(first)).toContain('move three')
        expect(sentText(first)).not.toContain('move two')
      })

      it('may also be made inside the first step of the next turn, and applies to that very request', async () => {
        const { adapter, agent } = await playThree()
        const off = ctx.on('agent/pre-step', async (payload, next) => {
          const decision = await next()
          if (payload.step !== 1 || payload.agent.session.header.origin === 'subagent' || !String(payload.agent.session.id).startsWith('session-')) return decision
          const range = rangeOfSecond(payload.agent.session as never)
          payload.agent.session.append('user/message', marker(), { surfaceOp: { op: 'replace', startSeq: range[0] as never, endSeq: range.at(-1) as never }, sourceEventSeqs: range as never })
          return decision
        })
        agent.followup(say('move four'))
        await agent.whenIdle()
        off()
        const first = masterRequests(adapter).find(request => sentText(request).includes('move four'))!
        expect(sentText(first)).not.toContain('move two')
        expect(sentText(first)).toContain('move three')
        expect(outputsOf(agent)).toHaveLength(4)
      })
    })

    describe('taking the story back to a turn', () => {
      const folderOf = (id: string) => sessionFolder(join(root, 'sessions'), id)
      const turnsIn = (id: string) => state.openSession(join(root, 'sessions'), id).metadata.get().turns
      const sent = (request: { messages: readonly unknown[] }) => JSON.stringify(request.messages)
      async function play(messages: readonly string[]) {
        const { id, session } = await addSession('Vault', true)
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        for (const message of messages) { agent.followup(say(message)); await agent.whenIdle() }
        await orchestration.timelines!.read(id)
        await vi.waitFor(() => { expect(readTimeline(folderOf(id)).nodes.at(-1)?.snapshot).toBeDefined() }, { timeout: 5000 })
        return { id, session, adapter, agent, chatId: `session-${id}`, timeline: () => readTimeline(folderOf(id)) }
      }
      const lastRequestWith = (adapter: ScriptedAdapter, text: string) => masterRequests(adapter).filter(request => sent(request).includes(text)).at(0)!

      it('keeps each turn as it is played: whose it follows, where it is in the log, what was said and delivered, and the state after it', async () => {
        const { id, timeline } = await play(['move one', 'move two', 'move three'])
        const { nodes, head } = timeline()
        expect(nodes.map(node => [node.id, node.parent, node.player])).toEqual([['n1', null, 'move one'], ['n2', 'n1', 'move two'], ['n3', 'n2', 'move three']])
        expect(head).toBe('n3')
        expect(nodes.every(node => node.userSeq > 0 && node.endSeq !== undefined && node.endSeq > node.userSeq && node.output !== undefined)).toBe(true)
        expect(nodes[1]!.userSeq).toBeGreaterThan(nodes[0]!.endSeq!)
        expect(nodes.map(node => node.snapshot)).toEqual(['after-n1', 'after-n2', 'after-n3'])
        expect(state.snapshots(join(root, 'sessions'), id)).toEqual(['after-n1', 'after-n2', 'after-n3', 'start'])
        expect(orchestration.timelines!.view(id).path.map(turn => [turn.id, turn.restorable])).toEqual([['n1', true], ['n2', true], ['n3', true]])
      })

      it('puts the story back as it was after the turn, replaces the later turns on the conversation, gives back what the player said, and the next turn follows from there', async () => {
        const { id, adapter, agent, chatId, timeline } = await play(['move one', 'move two', 'move three'])
        expect(turnsIn(id)).toBe(3)
        const moved = await orchestration.timelines!.move(chatId, 'n1')
        expect(moved).toEqual({ draft: 'move two' })
        expect(turnsIn(id)).toBe(1)
        expect(timeline().head).toBe('n1')
        agent.followup(say('move four'))
        await agent.whenIdle()
        const first = lastRequestWith(adapter, 'move four')
        expect(sent(first)).toContain('move one')
        expect(sent(first)).not.toContain('move two')
        expect(sent(first)).not.toContain('move three')
        expect(timeline().nodes.map(node => [node.id, node.parent])).toEqual([['n1', null], ['n2', 'n1'], ['n3', 'n2'], ['n4', 'n1']])
        expect(turnsIn(id)).toBe(2)
        expect(orchestration.timelines!.view(id).path.map(turn => [turn.id, turn.alternatives])).toEqual([['n1', ['n1']], ['n4', ['n2', 'n4']]])
      })

      it('takes the story forward again: the state comes back, and the turns that are no longer on the conversation are told once, in order, as notices', async () => {
        const { id, adapter, agent, chatId, timeline } = await play(['move one', 'move two', 'move three'])
        await orchestration.timelines!.move(chatId, 'n1')
        expect(orchestration.timelines!.view(id).forward.map(turn => turn.id)).toEqual(['n2'])
        expect(await orchestration.timelines!.move(chatId, 'n3')).toEqual({})
        expect(turnsIn(id)).toBe(3)
        expect(timeline().nodes.filter(node => node.noticeSeq !== undefined).map(node => node.id)).toEqual(['n2', 'n3'])
        agent.followup(say('move five'))
        await agent.whenIdle()
        const request = sent(lastRequestWith(adapter, 'move five'))
        expect(request.indexOf('The player said: move two')).toBeGreaterThan(-1)
        expect(request.indexOf('The player said: move two')).toBeLessThan(request.indexOf('The player said: move three'))
        expect(request.indexOf('The player said: move three')).toBeLessThan(request.indexOf('move five'))
        expect(request.match(/The story, as it went earlier/g)).toHaveLength(2)
      })

      it('swaps one answer for another to the same message: regenerate, then swap back', async () => {
        const { id, adapter, agent, chatId, timeline } = await play(['move one', 'move two'])
        const first = timeline().nodes[1]!
        await orchestration.timelines!.move(chatId, 'n1')
        agent.followup(say('move two again'))
        await agent.whenIdle()
        await vi.waitFor(() => { expect(timeline().nodes.at(-1)?.snapshot).toBeDefined() }, { timeout: 5000 })
        expect(orchestration.timelines!.view(id).path.at(-1)!.alternatives).toEqual(['n2', 'n3'])
        await orchestration.timelines!.move(chatId, 'n2')
        expect(timeline().head).toBe('n2')
        expect(timeline().nodes[1]!.userSeq).toBe(first.userSeq)
        agent.followup(say('move three'))
        await agent.whenIdle()
        const request = sent(lastRequestWith(adapter, 'move three'))
        expect(request).toContain('The player said: move two')
        expect(request).not.toContain('move two again')
        expect(request).not.toContain('The player said: move two again')
      })

      it('goes back to the start, and refuses a turn that is not there, or whose state was not kept', async () => {
        const { id, adapter, agent, chatId, timeline } = await play(['move one', 'move two'])
        await expect(orchestration.timelines!.move(chatId, 'n9')).rejects.toThrow(/there is no turn "n9"/)
        const nodes = timeline()
        delete nodes.nodes[0]!.snapshot
        writeTimeline(folderOf(id), nodes)
        await expect(orchestration.timelines!.move(chatId, 'n1')).rejects.toThrow(/was not kept/)
        expect(await orchestration.timelines!.move(chatId, null)).toEqual({ draft: 'move one' })
        expect(turnsIn(id)).toBe(0)
        agent.followup(say('move zero'))
        await agent.whenIdle()
        expect(sent(lastRequestWith(adapter, 'move zero'))).not.toContain('move one')
        expect(timeline().nodes.map(node => node.parent)).toEqual([null, 'n1', null])
      })

      describe('a branch made by DSH\'s own fork', () => {
        const branchOf = async (chatId: string, agent: { session: { snapshotEvents(): readonly never[] } }, cut: number) => {
          const child = `session-${randomUUID()}`
          const events = agent.session.snapshotEvents()
          await ctx.agents.create({
            sessionId: SessionId(child),
            seed: buildForkSeed(events, SessionSeq(cut)),
            inheritedEventCount: SessionLogOffset(cut + 1),
            meta: { parentSession: SessionId(chatId), isSeeded: true },
            agentOptions: { provider: 'mock', model: 'mock' },
            async setup(agentCtx) { await agentCtx.plugin(orchestrationPlugin) },
          })
          return child
        }

        it('gets a session of its own from the state where it was cut, with the turns it inherits, and the story goes on in it without touching the first', async () => {
          const { id, agent, chatId, timeline } = await play(['move one', 'move two', 'move three'])
          const cut = timeline().nodes[1]!.endSeq!
          const child = await branchOf(chatId, agent as never, cut)
          const branchId = child.slice('session-'.length)
          expect(turnsIn(branchId)).toBe(2)
          expect(turnsIn(id)).toBe(3)
          expect(state.openSession(join(root, 'sessions'), branchId).metadata.get()).toMatchObject({ id: branchId, name: 'Vault 2' })
          const branch = readTimeline(folderOf(branchId))
          expect(branch.nodes.map(node => node.id)).toEqual(['n1', 'n2'])
          expect(branch.head).toBe('n2')
          expect(state.snapshots(join(root, 'sessions'), branchId)).toEqual(['after-n1', 'after-n2', 'start'])
          expect(timeline().nodes).toHaveLength(3)
        })

        it('does not make a session twice: a chat that is loaded again keeps the one it has', async () => {
          const { agent, chatId, timeline } = await play(['move one', 'move two'])
          const child = await branchOf(chatId, agent as never, timeline().nodes[0]!.endSeq!)
          const branchId = child.slice('session-'.length)
          state.openSession(join(root, 'sessions'), branchId).metadata.setName('Renamed')
          await expect(orchestration.timelines!.adopt(child, chatId, timeline().nodes[0]!.endSeq!, agent as never)).resolves.toBe(false)
          expect(state.openSession(join(root, 'sessions'), branchId).metadata.get().name).toBe('Renamed')
        })

        it('is not made, and says why, when the state at the cut was not kept', async () => {
          const { id, agent, chatId, timeline } = await play(['move one', 'move two'])
          const nodes = timeline()
          delete nodes.nodes[0]!.snapshot
          writeTimeline(folderOf(id), nodes)
          state.removeSnapshot(join(root, 'sessions'), id, 'after-n1')
          await expect(branchOf(chatId, agent as never, nodes.nodes[0]!.endSeq!)).rejects.toThrow(/was not kept/)
          expect(readdirSync(join(root, 'sessions')).filter(name => name !== id)).toEqual([])
        })
      })

      it('keeps no state when the chat asks for none: nothing can be gone back to', async () => {
        const { id, session } = await addSession('Vault', true)
        writeSettings(folderOf(id), { rewind: { keepSnapshots: 0 } })
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say('move one'))
        await agent.whenIdle()
        expect(state.snapshots(join(root, 'sessions'), id)).toEqual([])
        await expect(orchestration.timelines!.move(`session-${id}`, 'n1')).rejects.toThrow(/was not kept/)
        expect(session.metadata.get().turns).toBe(1)
      })
    })

    it('has the next turn clear the notes of the last one', async () => {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      await vi.waitFor(() => { expect((session.metadata.getValue('notes') as unknown[]).length).toBe(1) }, { timeout: 5000 })
      agent.followup(say('I look around.'))
      await vi.waitFor(() => { expect(masterRequests(adapter).some(request => thisTurn(request).includes('I look around'))).toBe(true) }, { timeout: 5000 })
      await agent.whenIdle()
      await vi.waitFor(() => { expect(session.metadata.getValue('notes')).toEqual([{ kind: 'suggestions', turn: 2, lines: SUGGESTED }]) }, { timeout: 5000 })
    })

    it('has the chat ask for none, and nobody is asked to make any', async () => {
      const { session, id } = await addSession('Vault', true)
      writeSettings(sessionFolder(join(root, 'sessions'), id), { suggestions: { count: 0 } })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(adapter.requests.some(request => systemOf(request).includes('You suggest what the player could do next'))).toBe(false)
      expect(session.metadata.getValue('notes')).toBeUndefined()
    })

    it('has the game master show a preview first, which the characters never see, and the output is still delivered whole', async () => {
      const { id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const results = masterRequests(adapter).flatMap(request => request.messages.filter(message => message.role === 'tool'))
      expect(JSON.stringify(results)).toContain('<roleplay-preview>')
      expect(JSON.stringify(results)).toContain('lamplight catches Alice')
      expect(JSON.stringify(characterRequests(adapter).map(request => request.messages))).not.toContain('lamplight')
      expect(outputsOf(agent)).toHaveLength(1)
      expect(timesCalled(masterRequests(adapter).at(-1)!, 'preview_scene')).toBe(1)
    })

    it('leaves the preview out of a chat that shows none: no instruction, no tool, and the output is still delivered', async () => {
      const { id } = await addSession('Vault', true)
      writeSettings(sessionFolder(join(root, 'sessions'), id), { preview: { enabled: false } })
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const requests = masterRequests(adapter)
      expect(requests.some(request => toolNames(request).includes('preview_scene'))).toBe(false)
      expect(requests.some(request => systemOf(request).includes('preview_scene'))).toBe(false)
      expect(outputsOf(agent)).toHaveLength(1)
    })

    it('uses a prompt the session carries instead of the one in the root', async () => {
      const { id } = await addSession('Vault', true)
      const folder = join(sessionFolder(join(root, 'sessions'), id), 'prompts', 'en', 'roleplay')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'persona.md'), 'You are the narrator of this one table.')
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(masterRequests(adapter).every(request => systemOf(request).includes('narrator of this one table'))).toBe(true)
    })

    it('plays what the game master judges cannot work as a failed attempt: no preview, nobody is asked, and the story is as it was', async () => {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', judge: 'refuses' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I cast a fireball at the lamp.'))
      await agent.whenIdle()
      expect(characterRequests(adapter)).toEqual([])
      expect(masterRequests(adapter).some(request => timesCalled(request, 'preview_scene') > 0)).toBe(false)
      expect(outputsOf(agent)[0]).toMatchObject({ segments: [{ type: 'narration', text: 'You wave a hand at the lamp. Nothing happens.' }] })
      expect(session.metadata.get().turns).toBe(1)
    })

    it('has the game master judge first in an ordinary turn, and steers it back when it does not', async () => {
      const { id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', judge: 'skipped' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(JSON.stringify(masterRequests(adapter).map(request => request.messages))).toContain('call judge_action first')
    })

    describe('out-of-character commands', () => {
      const playOoc = async (ooc: NonNullable<Script['ooc']>, command = '/ooc Bob now goes down to the cellar, something urgent came up') => {
        const { session, id } = await addSession('Vault', true)
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', ooc }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say(command))
        await agent.whenIdle()
        return { session, id, adapter, agent }
      }
      const bobAt = (session: Session) => session.placements.get('character', session.characters.getBySourceId('bob')!.id)?.locationId === session.locations.getBySourceId('cellar')!.id

      it('is a turn of its own: no preview, nobody is asked to act, the game master rules first, then decrees what the command says, and the player reads a note and what they perceive', async () => {
        const { session, adapter, agent } = await playOoc('moves-bob')
        expect(characterRequests(adapter)).toEqual([])
        expect(adapter.requests.some(request => thisTurn(request).includes('OUT-OF-CHARACTER COMMAND') && timesCalled(request, 'preview_scene') > 0)).toBe(false)
        expect(bobAt(session)).toBe(true)
        const [output] = outputsOf(agent)
        expect(output).toMatchObject({ segments: [{ type: 'narration', text: 'Bob stands abruptly and hurries down the stair.' }], ooc: { legal: true, note: 'Bob goes down to the cellar.' } })
        expect(session.metadata.get().turns).toBe(1)
      })

      it('records what was decreed as what happened to the character, marked as not chosen', async () => {
        const { adapter } = await playOoc('moves-bob')
        const brief = briefOf(keepers(adapter)[0]!)
        expect(brief).toContain('- bob (Bob): decreed, not chosen: succeeded: Bob goes down to the cellar, urgently')
        expect(brief).toContain("By the player's out-of-character command")
      })

      it('changes nothing when the game master rules it illegal, and the player is told why', async () => {
        const { session, agent } = await playOoc('illegal', '/ooc Bob vanishes in a puff of smoke')
        expect(bobAt(session)).toBe(false)
        expect(outputsOf(agent)[0]).toMatchObject({ segments: [], ooc: { legal: false, note: 'The world has no magic, so Bob cannot vanish in smoke.' } })
        expect(session.metadata.get().turns).toBe(1)
      })

      it('lets nothing change before the ruling, and says so', async () => {
        const { session, adapter } = await playOoc('acts-before-ruling')
        const early = adapter.requests.flatMap(request => request.messages).filter(message => message.role === 'tool').map(message => JSON.stringify(message)).find(text => text.includes('rule on it first with ooc_ruling'))
        expect(early).toBeDefined()
        expect(bobAt(session)).toBe(true)
      })

      it('tells the game master the rules of the world and of the player every turn, and an ordinary action is not an out-of-character command', async () => {
        const { session, id } = await addSession('Vault', true)
        session.metadata.setValue('rules', ['There is no magic.'])
        writeSettings(sessionFolder(join(root, 'sessions'), id), { rules: { own: 'No one can fly.\n\nNo guns.' } })
        const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful' }))
        const agent = await chat(`session-${id}`, adapter)
        agent.followup(say('I open the vault door. /ooc is a word here'))
        await agent.whenIdle()
        const notice = thisTurn(masterRequests(adapter)[0]!)
        expect(notice).toContain(JSON.stringify("What is not allowed in this story (the rules of the world, and the player's own). They are absolute: an action of the player's character that breaks one does not work, whatever the player says it does:\n- There is no magic.\n- No one can fly.\n- No guns.").slice(1, -1))
        expect(notice).not.toContain('OUT-OF-CHARACTER COMMAND')
        expect(characterRequests(adapter).length).toBeGreaterThan(0)
      })

      it('answers a question with /ask as a turn of its own that changes nothing, and the player reads the answer', async () => {
        const { session, adapter, agent } = await playOoc('question', '/ask Does Alice know where Bob went?')
        expect(characterRequests(adapter)).toEqual([])
        expect(adapter.requests.some(request => thisTurn(request).includes('OUT-OF-CHARACTER QUESTION') && timesCalled(request, 'preview_scene') > 0)).toBe(false)
        expect(bobAt(session)).toBe(false)
        expect(outputsOf(agent)[0]).toMatchObject({ segments: [], ooc: { legal: true, note: 'Bob has not told Alice, so she does not know.', question: true } })
        expect(session.metadata.get().turns).toBe(1)
        expect(keepers(adapter)).toEqual([])
      })

      it('is told to ask what the player wants when the question is empty', async () => {
        const { adapter } = await playOoc('question', '/ask')
        expect(characterRequests(adapter)).toEqual([])
        expect(JSON.stringify(masterRequests(adapter)[0]!.messages)).toContain('empty out-of-character message (/ask)')
      })

      it('is not an empty command: the game master is told to ask what the player wants, and nobody acts', async () => {
        const { adapter } = await playOoc('moves-bob', '/ooc')
        expect(characterRequests(adapter)).toEqual([])
        expect(JSON.stringify(masterRequests(adapter)[0]!.messages)).toContain('The player sent an empty out-of-character message (/ooc)')
      })
    })

    it('moves the player\'s character by its own outcome, with no one else asked to act, and the journey takes its time', async () => {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', player: 'walks' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I step out to the street.'))
      await agent.whenIdle()
      expect(characterRequests(adapter)).toEqual([])
      const arthur = session.characters.getBySourceId('arthur')!
      expect(session.placements.get('character', arthur.id)).toMatchObject({ locationId: session.locations.getBySourceId('street')!.id, position: 'by the lamp' })
      expect(session.clock.get()?.now).toBe(EVENING + 120_000)
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('Arthur is now at Main Street.')
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('It is now Friday 4 October 1912, 21:42 (evening); 2 minutes passed.')
      expect(briefOf(keepers(adapter)[0]!)).toContain('- arthur (Arthur, the player\'s character): succeeded: Arthur walks out to the street')
      expect(session.metadata.get().turns).toBe(1)
    })

    it('skips to a time of day when the game master asks, and the next turn starts from there', async () => {
      const { session, adapter, agent } = await playTime('skip')
      expect(session.clock.get()?.now).toBe(Date.UTC(1912, 9, 5, 7))
      expect(session.clock.log({ kind: 'skip' })).toEqual([expect.objectContaining({ turn: 1, round: 1, reason: 'they sleep', to: Date.UTC(1912, 9, 5, 7) })])
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('It is now Saturday 5 October 1912, 07:00 (morning). Nothing else changed')
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(thisTurn(masterRequests(adapter).findLast(request => thisTurn(request).includes('I look around'))!)).toContain('Time: Saturday 5 October 1912, 07:00 (morning)')
    })

    it('reads the time in the zone of the settings', async () => {
      const { adapter } = await playTime(undefined, { clock: { timeZone: 'Asia/Shanghai' } })
      expect(thisTurn(masterRequests(adapter)[0]!)).toContain('Time: Saturday 5 October 1912, 05:40 (morning)')
    })

    it('follows the wall clock when the settings say so: it cannot be skipped, and the game master hears how long the player was away', async () => {
      const { session, id } = await addSession('Vault', true)
      writeSettings(sessionFolder(join(root, 'sessions'), id), { clock: { mode: 'real', timeZone: 'UTC' } })
      session.clock.resync('real', Date.now() - 3 * 3_600_000, 0, 'the player left three hours ago')
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', time: 'skip' }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(session.clock.get()?.mode).toBe('real')
      expect(session.clock.get()!.now).toBeGreaterThan(Date.UTC(2026, 0, 1))
      expect(session.clock.log({ kind: 'skip' })).toEqual([])
      expect(JSON.stringify(masterRequests(adapter).flatMap(request => request.messages.filter(message => message.role === 'tool' && message.isError === true)))).toContain('follows the wall clock, so it cannot be skipped')
      const scene = thisTurn(masterRequests(adapter)[0]!)
      expect(scene).toContain('follows the real clock')
      expect(scene).toContain('The player was away for 3 hours of real time')
    })
  })

  describe('things', () => {
    async function playThings(things: NonNullable<Script['things']>) {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', things }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      return { session, adapter, agent }
    }
    const holderOf = (session: Session, key: string) => session.items.holding(session.items.getBySourceId(key)!.id)?.holder
    const characterBrief = (adapter: ScriptedAdapter, who: string) => briefOf(characterRequests(adapter).find(request => systemOf(request).includes(`You are ${who}.`))!)
    const keepers = (adapter: ScriptedAdapter) => adapter.requests.filter(request => systemOf(request).includes('record keeper of an interactive story'))

    it('tells the game master what lies where and who has what, hidden things included, and each character only what it can see and has', async () => {
      const { adapter } = await playThings('take')
      const scene = thisTurn(masterRequests(adapter)[0]!)
      expect(scene).toContain('Lying about: lantern: Brass lantern (dented) [by the till, at Counter]; chest: Oak chest [locked]; letter: Sealed letter [hidden]')
      expect(scene).toContain('What characters have on them:\\n- Bob (bob): brass-key: Brass key [carried]')
      const alices = characterBrief(adapter, 'Alice')
      expect(alices).toContain('Lying about: Brass lantern (dented) [by the till, at Counter]; Oak chest [locked]')
      expect(alices).not.toContain('Sealed letter')
      expect(characterBrief(adapter, 'Bob')).toContain('What you have on you:\nBrass key [carried]')
      expect(alices).not.toContain('What you have on you')
    })

    it('does what the game master decides a character does with a thing, with the round, and tells it and the keeper what came of it', async () => {
      const { session, adapter } = await playThings('take')
      expect(holderOf(session, 'lantern')).toEqual({ kind: 'character', characterId: session.characters.getBySourceId('alice')!.id, mode: 'held' })
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('Brass lantern: now carried by Alice')
      expect(briefOf(keepers(adapter)[0]!)).toContain('with things: Brass lantern (take: now carried by Alice)')
      expect(systemOf(keepers(adapter)[0]!)).toContain('do not move things')
    })

    it('sends the game master back when two characters take the same thing, and applies the corrected round', async () => {
      const { session, adapter } = await playThings('conflict')
      expect(JSON.stringify(masterRequests(adapter).flatMap(request => request.messages.filter(message => message.role === 'tool' && message.isError === true)))).toMatch(/bob: cannot take lantern: Brass lantern is held by Alice, who has to give it/)
      expect(holderOf(session, 'lantern')).toMatchObject({ kind: 'character', characterId: session.characters.getBySourceId('alice')!.id })
    })

    it('unlocks a chest with the key in hand and opens it, in order', async () => {
      const { session } = await playThings('unlock')
      expect(session.items.getBySourceId('chest')?.container?.state).toBe('open')
    })

    it('has the game master ask for a thing the story needs, which the world author makes where the story put it', async () => {
      const { session, id } = await addSession('Vault', true)
      const adapter = new ScriptedAdapter(answerFor({ keeper: 'careful', expand: { author: 'object', need: 'object' } }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('A stranger hands me a note.'))
      await agent.whenIdle()
      expect(holderOf(session, 'note')).toMatchObject({ kind: 'character', characterId: session.characters.getBySourceId('arthur')!.id, mode: 'held' })
      expect(session.items.getBySourceId('note')).toMatchObject({ notable: true, name: 'Folded note' })
      expect(session.consolidation.pending()).toEqual([expect.objectContaining({ kind: 'item' })])
      expect(JSON.stringify(masterRequests(adapter).at(-1)!.messages)).toContain('item note (Folded note)')
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
      expect(carolsBrief).toMatch(/Present:\n- Carol \(you\)[^\n]*(?:\n|$)/)
    })

    it('never shows a character a key or the number of a turn or round: those belong to the code, the story has only names and times', async () => {
      const { adapter } = await playPlaced({})
      const requests = characterRequests(adapter)
      expect(requests.length).toBeGreaterThan(0)
      for (const request of requests) {
        const shown = `${systemOf(request)}\n${asText(request)}`
        expect(shown).not.toMatch(/\((arthur|alice|bob|carol|dan|bar|cellar)\)/)
        expect(shown).not.toMatch(/\b(turn|round|step) \d+\b/i)
      }
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
    expect(events.filter(event => event.type !== 'subagent/catalog').at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
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
      expect(toolNames(request)).toEqual(['recall_my_known_entities', 'recall_my_lore', 'recall_my_memories', 'submit_result'])
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

    const KEEPER_TEXT = 'The characters acted at the vault.'
    /** What the keeper wrote, apart from the plain events every recorded round leaves by itself. */
    const keptEvents = (session: Awaited<ReturnType<typeof addSession>>['session']) => session.events.list().filter(event => event.text === KEEPER_TEXT)

    async function play(keeper: NonNullable<Script['keeper']>, settings?: object) {
      const { session, id } = await addSession('Vault')
      if (settings !== undefined) writeSettings(sessionFolder(join(root, 'sessions'), id), settings)
      const adapter = new ScriptedAdapter(answerFor({ keeper }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      return { session, adapter, agent }
    }

    it('has the look-ups its switches leave on and always the two it cannot work without', async () => {
      const { adapter } = await play('careful', { tools: { records: { search_events: false, list_items: false } } })
      expect(toolNames(keeperRequests(adapter)[0]!).sort()).toEqual(['edit_records', 'get_agenda', 'get_faction', 'get_item', 'get_location', 'list_factions', 'list_locations', 'list_relationships', 'list_threads', 'list_variables', 'read_records', 'submit_result'])
    })

    it('loops through its own tools: writes, reads the records back to check, and only then submits', async () => {
      const { session, adapter, agent } = await play('careful')
      expect(keeperCalls(adapter)).toEqual(['edit_records', 'read_records'])
      expect(toolNames(keeperRequests(adapter)[0]!).sort()).toEqual(['edit_records', 'get_agenda', 'get_faction', 'get_item', 'get_location', 'list_factions', 'list_items', 'list_locations', 'list_relationships', 'list_threads', 'list_variables', 'read_records', 'search_events', 'submit_result'])
      expect(activityOf(session, 'alice')).toBe('Alice takes the lantern')
      expect(activityOf(session, 'dan')).toBe('Dan takes the lantern too')
      expect(publicStateOf(session, 'bob')).toBe('holding a brass key')
      expect(keptEvents(session)).toHaveLength(1)
      expect(session.events.list().map(event => event.text)).toEqual(expect.arrayContaining(['Alice takes the lantern', 'Alice: "That is not something I expected."', 'Carol: "Oh, please."', 'Dan: "Give it here!"']))
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
      expect(keptEvents(session).map(event => event.text)).toEqual([KEEPER_TEXT])
      expect(activityOf(session, 'alice')).toBe('alice takes the lantern')
    })

    it('gets the reasons when an edit is refused, writes nothing from it, and corrects it in the same run', async () => {
      const { session, adapter } = await play('refused')
      expect(keeperRequests(adapter).length).toBeGreaterThan(2)
      expect(JSON.stringify(keeperRequests(adapter)[1]!.messages)).toContain('turn 99, round 1')
      expect(keptEvents(session)).toHaveLength(1)
      expect(session.events.get(1)?.turn).toBe(1)
    })

    it('skips the check when the chat turns verification off, and submits right after writing', async () => {
      const { session, adapter } = await play('careful', { memory: { verify: false } })
      expect(keeperCalls(adapter)).toEqual(['edit_records'])
      expect(briefOf(keeperRequests(adapter)[0]!)).toContain('Verification is off')
      expect(keptEvents(session)).toHaveLength(1)
    })

    it('that never submits does not lose the turn, and does not put a word of it in the output', async () => {
      const { session, agent } = await play('stuck')
      const results = JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))
      expect(results).not.toMatch(/records|Warning|could not be/)
      expect(outputsOf(agent)).toHaveLength(1)
      expect(session.metadata.get().turns).toBe(1)
      expect(session.pendingCommits.list().map(entry => [entry.turn, entry.round])).toEqual([[1, 1]])
    })

    it('that failed is written again when the next turn starts, before anything is recalled, silently', async () => {
      const { session, id } = await addSession('Vault')
      const script: Script = { keeper: 'stuck' }
      const adapter = new ScriptedAdapter(answerFor(script))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      expect(session.pendingCommits.list()).toHaveLength(1)
      expect(session.events.list().length).toBeGreaterThan(0)
      script.keeper = 'careful'
      agent.followup(say('I look around.'))
      await agent.whenIdle()
      expect(session.pendingCommits.list()).toEqual([])
      const briefs = keeperRequests(adapter).map(request => briefOf(request))
      expect(briefs.some(brief => brief.includes('turn 1, round 1 is due for records'))).toBe(true)
      expect(briefs.at(-1)).toContain('turn 2, round 1 is due for records')
      expect(keptEvents(session).map(event => event.turn)).toEqual([1, 2])
      expect(session.metadata.get().turns).toBe(2)
    })

    it('writes the events of the round with who took each in', async () => {
      const { session } = await play('careful')
      const [event] = keptEvents(session)
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
      expect(keptEvents(session)).toEqual([])
      expect(session.events.list().length).toBeGreaterThan(0)
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
      expect(keptEvents(session).map(event => event.turn)).toEqual([1, 2])
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
      expect(keptEvents(session)).toHaveLength(1)
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
      expect(keptEvents(session)).toHaveLength(1)
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
      const everything = session.events.list()
      expect(session.recallIndex.info()?.embedded).toBe(everything.length + everything.reduce((count, event) => count + session.events.perceptionsOf(event.id).length, 0))
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
      expect(result('Carol')).toBe('You do not remember anything about that, and there is nothing more to find: go on with what you know.')
      expect(session.events.perceivedBy(idOf('alice'))[0]?.perception.recalls).toBeGreaterThan(0)
    })

    it('are left with only the way to submit once they have used their look-ups, so that a model forced to call something can only finish', async () => {
      const { id } = await addSession('Vault')
      const adapter = new ScriptedAdapter(answerFor({ characterLooksUp: 9 }))
      const agent = await chat(`session-${id}`, adapter)
      agent.followup(say('I open the vault door.'))
      await agent.whenIdle()
      const alice = characterRequests(adapter).filter(candidate => /You are Alice\./.test(systemOf(candidate)))
      expect(alice.map(request => toolNames(request).length)).toEqual([...Array(5).fill(4), 1])
      expect(toolNames(alice.at(-1)!)).toEqual(['submit_result'])
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

  it('gives a character only the look-ups its switches leave on, and says nothing of one it lacks', async () => {
    const { id } = await addSession('Vault')
    writeSettings(sessionFolder(join(root, 'sessions'), id), { tools: { characters: { recall_my_memories: false, recall_my_lore: false } } })
    const adapter = new ScriptedAdapter(answerFor())
    const agent = await chat(`session-${id}`, adapter)
    agent.followup(say('I open the vault door.'))
    await agent.whenIdle()
    expect(characterRequests(adapter).length).toBeGreaterThan(0)
    for (const request of characterRequests(adapter)) {
      expect(toolNames(request)).toEqual(['recall_my_known_entities', 'submit_result'])
      expect(systemOf(request)).not.toContain('recall_my_memories')
    }
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
    expect(asText(asBob!)).not.toContain('What you remember that bears on this')
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

    it('follows the model\'s context window when the chat gives no limit, and folds past its share of it', async () => {
      const { session } = await playLong(8, { context: { limitTokens: 0, limitRatio: 0.1, retainRatio: 0.3 } })
      expect(session.summaries.list().length).toBeGreaterThan(0)
    })

    it('does not fold under that share: with the default share of a roomy window nothing is folded', async () => {
      const { session } = await playLong(3, {})
      expect(session.summaries.list()).toEqual([])
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
