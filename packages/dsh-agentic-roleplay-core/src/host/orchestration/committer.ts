import { promptFor } from '../prompts/access.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { InvalidEditError, characterKey, createTools, dayPart, describeDuration, describeInstant, localTime, parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import { zoneOf } from '../clock/story-clock.ts'
import { childModel, childSampling, childTrace, runChild } from '../agents/child.ts'
import type { CommitJob, CommitReport, Committer, RoundRecord } from './boundaries.ts'


/** What the keeper reads back by default: the parts of the records its edits write. */
const VERIFY_SECTIONS = ['characters', 'factions', 'faction_relationships', 'events', 'beliefs', 'open_threads', 'relationships', 'knowledge', 'variables', 'engagements'] as const

const label = (round: { turn: number; round: number }): string => `turn ${round.turn}, round ${round.round}`

function describeRound(round: RoundRecord): string[] {
  return [
    `## ${label(round)}`,
    round.offstage === true ? `Off stage (away from the player's character; only the characters named here perceive it, and only those who were together perceive each other): ${round.situation}` : `The moment (includes what the player's character did or said): ${round.situation}`,
    ...(round.place === undefined ? [] : [`Place of the moment: ${round.place.name} (${round.place.key})`]),
    ...(round.time === undefined ? [] : [`When: ${describeInstant(round.time.from, round.time.zone)} (${dayPart(localTime(round.time.from, round.time.zone).minuteOfDay)})${round.time.to > round.time.from ? `; the round took ${describeDuration(round.time.to - round.time.from)}` : ''}`]),
    'What each character did, and what became of it:',
    ...round.entries.map(entry => [
      entry.forced === true ? `- ${entry.character} (${entry.name}): decreed, not chosen: ${entry.result}: ${entry.summary}` : entry.player === true ? `- ${entry.character} (${entry.name}, the player's character): ${entry.result}: ${entry.summary}` : `- ${entry.character} (${entry.name}): intended "${entry.intent}" [commitment: ${entry.commitment}]; ${entry.result}: ${entry.summary}`,
      entry.utterance === undefined ? '' : `  said${entry.spoken ? '' : ' (but was prevented from saying)'}: "${entry.utterance}"`,
      entry.publicState === undefined ? '' : `  the game master says anyone present can now see: ${entry.publicState}`,
      entry.variables === undefined ? '' : `  the game master changed what is tracked: ${entry.variables.map(change => `${change.subject}'s ${change.name} ${change.from} -> ${change.to}`).join('; ')}`,
      entry.items === undefined ? '' : `  with things: ${entry.items.map(thing => `${thing.name} (${thing.action}: ${thing.summary})`).join('; ')}`,
      entry.at === undefined ? '' : `  was in ${entry.at.name} (${entry.at.key})${entry.moved === undefined ? '' : ` and went to ${entry.moved.name} (${entry.moved.key})${entry.moved.position === undefined ? '' : `, ${entry.moved.position}`}`}`,
    ].filter(line => line !== '').join('\n')),
    '',
  ]
}

/** What is asked this time: the chat's two settings, the rounds due, and the state of the story around them. */
export function describePrompt(job: CommitJob, memory: { flaky: boolean; verify: boolean }): string {
  const rounds = job.rounds.map(({ turn, round }) => ({ turn, round }))
  const first = job.rounds[0]!
  const records = job.store.story.records({ timeZone: zoneOf(job.store.settings().clock) })
  const own = job.store.story.records({ rounds }).events
  const before = records.events.filter(event => event.turn < first.turn || (event.turn === first.turn && event.round < first.round)).slice(-6)
  return [
    memory.flaky
      ? 'Perception in this chat: characters do not perceive perfectly. Mark a perception partial only when the character could take in just part of it (overheard, glimpsed), and mistaken only when the material shows it taking in something false; in both cases put the character\'s own version in content. Otherwise it is accurate and content is left out.'
      : 'Perception in this chat: every character perceives exactly what happened. Leave accuracy and content out.',
    memory.verify
      ? 'Verification is on: you cannot submit until you have read the records back after your last change.'
      : 'Verification is off: submit as soon as the records are written.',
    '',
    job.rounds.length > 1 ? `${job.rounds.length} rounds are due for records: write all of them, oldest first.` : `${label(first)} is due for records.`,
    ...(job.focus === undefined || job.focus.length === 0 ? [] : ['', `The game master says this is worth keeping: ${job.focus.join('; ')}`]),
    '',
    ...job.rounds.flatMap(describeRound),
    '## State of the characters now',
    ...records.characters.map(entry => `- ${entry.character} (${entry.name}, ${entry.controlled_by}): public: ${entry.public_state || '-'}; inner: ${entry.inner_state || '-'}; doing: ${entry.activity || '-'}${entry.location === null ? '' : `; in: ${entry.location}${entry.position === '' ? '' : ` (${entry.position})`}`}`),
    '',
    '## Recorded before these rounds (do not repeat)',
    ...(before.length === 0 ? ['- nothing'] : before.map(event => `- [turn ${event.turn}] ${event.text}`)),
    '',
    '## Already recorded for these rounds (an earlier attempt wrote them: continue from them, do not repeat them)',
    ...(own.length === 0 ? ['- nothing'] : own.map(event => `- id ${event.id}, ${label(event)}: ${event.text}`)),
    '',
    '## Goals of the characters (ids for intent_edits)',
    ...(records.characters.flatMap(entry => entry.goals.map(goal => `- id ${goal.id}, ${entry.character}: ${goal.name} (${goal.type}, ${goal.status}${goal.deadline === null ? '' : `, deadline ${goal.deadline}`})${goal.plan.length === 0 ? '' : ` plan: ${goal.plan.join('; ')}`}`)).concat(records.characters.every(entry => entry.goals.length === 0) ? ['- none'] : [])),
    '',
    '## Pending engagements (ids for engagement_edits; times in the story\'s time zone)',
    ...(records.engagements.length === 0 ? ['- none'] : records.engagements.map(engagement => `- id ${engagement.id}: ${engagement.title}, ${engagement.at}${engagement.location === null ? '' : `, at ${engagement.location}`}, with ${engagement.participants.join(', ')}`)),
    '',
    '## What is tracked now (values that are not the default; list_variables shows everything tracked)',
    ...(records.variables.length === 0 ? ['- nothing'] : records.variables.slice(0, 30).map(entry => `- ${entry.about} (${entry.subject}): ${entry.variable} ${entry.described}${entry.baseline === null ? '' : ` (usually ${entry.baseline})`}`)),
    '',
    '## Open story threads',
    ...(records.open_threads.length === 0 ? ['- none'] : records.open_threads.map(thread => `- id ${thread.id}: ${thread.text}`)),
  ].join('\n')
}

const RESULT: ObjectJsonSchema = {
  type: 'object',
  properties: {
    complete: { type: 'boolean', description: 'True when the records are written and right. False only when something is still wrong that you could not fix.' },
    notes: { type: 'string', description: 'What you recorded, or what is still wrong, in a sentence or two.' },
  },
  required: ['complete', 'notes'],
  additionalProperties: false,
}

/** The tools of the keeper, and what they do to the check it has to make. */
function keeperTools(job: CommitJob, memory: { flaky: boolean; recall: number }, progress: { edits: number; unchecked: boolean }): ToolDefinition[] {
  const turn = Math.max(...job.rounds.map(round => round.turn))
  const keys = job.store.story.characters.list().map(characterKey)
  const wanted = new Set(['read_records', 'edit_records', 'search_events', 'list_threads', 'list_locations', 'get_location', 'list_factions', 'get_faction', 'list_relationships', 'list_items', 'get_item', 'get_agenda', 'list_variables'])
  return createTools(() => ({ session: job.store.story, turn, policy: memory, queryVector: job.store.queryVector, timeZone: zoneOf(job.store.settings().clock) }), { write: true, characters: keys })
    .filter(tool => wanted.has(tool.name))
    .map((tool): ToolDefinition => {
      if (tool.name === 'edit_records') {
        return {
          ...tool,
          execute: async (args, exec) => {
            // The keeper writes about the rounds it was given, and only those.
            const outside = (parseRecordsEdit(args).events ?? []).filter(event => !job.rounds.some(round => round.turn === event.turn && round.round === event.round))
            if (outside.length > 0) {
              throw new InvalidEditError(outside.map(event => `an event has turn ${event.turn}, round ${event.round}, which is not one of the rounds given: ${job.rounds.map(label).join('; ')}`))
            }
            const result = await tool.execute(args, exec)
            progress.edits += 1
            progress.unchecked = true
            return result
          },
        }
      }
      if (tool.name === 'read_records') {
        // To check its work the keeper needs what it writes, not the whole world: the rest is left out unless it asks for it.
        const since = Math.min(...job.rounds.map(round => round.turn))
        return { ...tool, execute: async (args, exec) => { const result = await tool.execute({ sections: [...VERIFY_SECTIONS], relationships_since: since, ...(args as Record<string, unknown>) } as never, exec); progress.unchecked = false; return result } }
      }
      return tool
    })
}

/**
 * Writes rounds into the story's records with a child agent of the game master that has the
 * record tools to itself (the game master and the characters never see them). It writes with
 * `edit_records`, which is applied entirely or refused with the reasons so the agent corrects
 * it and calls again; when the chat asks for verification it cannot finish until it has read
 * the records back after its last change, compared them with the rounds and fixed what did not
 * match. It runs in the background of the narration.
 */
export function recordKeeper(deps: { agentOf: (chat: string) => Agent | undefined }): Committer {
  return {
    async commit(job, signal): Promise<CommitReport> {
      if (job.rounds.length === 0) return { writes: 0, notes: '' }
      const parent = deps.agentOf(job.chat)
      if (parent === undefined) throw new Error(`no agent for chat ${job.chat}`)
      const { memory } = job.store.settings()
      const progress = { edits: 0, unchecked: false }
      let warned = false
      const result = await runChild<{ complete: boolean; notes: string }>({
        parent, signal, reasoningEffort: job.store.settings().reasoning.children, sampling: childSampling(job.store.settings(), 'records'), ...childModel(job.store.settings(), 'records'), trace: childTrace(job.store, 'records', 'record keeper'),
        persona: promptFor(parent, 'roleplay/record-keeper', job.store.settings().prompts.language),
        prompt: describePrompt(job, memory),
        tools: keeperTools(job, memory, progress),
        result: RESULT,
        beforeSubmit: () => {
          if (progress.edits === 0 && !warned) {
            warned = true
            return 'you have written nothing: record the rounds with edit_records. If truly nothing happened, say so in notes and submit again.'
          }
          return memory.verify && progress.unchecked
            ? 'read the records back with read_records and compare them with the rounds before you submit'
            : undefined
        },
        maxCalls: 60,
      })
      if (!result.complete) throw new Error(`the records could not be made to match the rounds: ${result.notes}`)
      return { writes: progress.edits, notes: result.notes }
    },
  }
}
