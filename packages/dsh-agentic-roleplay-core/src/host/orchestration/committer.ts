import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ObjectJsonSchema, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { InvalidEditError, characterKey, createTools, dayPart, describeDuration, describeInstant, localTime, parseRecordsEdit } from 'dsh-roleplay-state'
import { zoneOf } from '../clock/story-clock.ts'
import { runChild } from '../agents/child.ts'
import type { CommitJob, CommitReport, Committer, RoundRecord } from './boundaries.ts'

/**
 * Who the record keeper is and how it works. It is the same for every run and for every chat
 * (what differs is in the prompt), so it is the part of each request the provider has cached.
 */
export const KEEPER_PERSONA = `You are the record keeper of an interactive story. You turn what was decided in each round into the story's records, which are what the story is remembered from later.

You work only from the material you are given and from what your tools show. You never infer, guess, embellish or add anything that is not stated there; when something is not stated, you leave it out. You write no story text and decide nothing: what happened has already been decided.

You work in a loop with your tools:
1. Write the records for the rounds due with edit_records. One call may hold state changes, events, beliefs and threads together; it is applied entirely or not at all. If it is refused, the reasons come back: correct them and call again.
2. Check your work when the prompt says verification is on: read the records back with read_records for those rounds and compare them with the rounds, item by item: an event the rounds do not support (correct or retract it: only events you wrote in this run can be corrected); something clearly stated and missing (add it); two events saying the same thing (retract the later); a perception by someone who could not have perceived the event, or missing for the character who did or said it; a character state that is a log of events or leaks a private thought into public_state; a belief the rounds do not support (retract it); an importance clearly out of proportion. Fix what you find with edit_records (event_edits, event_retractions, belief_edits, belief_retractions, new events) and read again. Do not change wording for style.
3. Finish with submit_result.

What to write:
- events: one for each distinct thing that happened (an action, a statement that matters, a revelation, a change), in the past tense ("Bob took the key."), one sentence, no interpretation, no narration. Never repeat an event that is already recorded. Usually one to four per round. Give each its turn and round, its tags (lowercase words: objects, places, topics) and the characters it involves.
- importance: 1 a passing detail, 2 minor, 3 notable, 4 important, 5 turns the story. Most events are 2 or 3.
- perceived_by: only characters who could actually perceive the event, each once, with how (witnessed, heard, told, inferred). The character who does or says something always perceives it. A character who was not there does not.
- The rounds you are given may be several, from this turn and earlier ones, because the game master records only when the story moves on. Write each event at the turn and round it belongs to. Routine rounds (small talk, movement) do not each need an event: fold them into the event that matters, or leave them out. If the game master named what is worth keeping, write that first.
- Events are final once your run is complete, and events recorded before this run cannot be changed or removed. What a character took in can: when the rounds show a character learning of an earlier event, or remembering it differently, add it with perceptions_added (event id, character) or revise it with perception_edits (the perception id from read_records). Never write the same event twice.
- places: where each character is was decided by the game master and is already written, and so are its moves; do not move anyone and do not write a move as an event unless it matters to the story. Every event takes the key of the place it happened in (location): the place of the round's moment unless the entry shows it happened somewhere else. perceived_by: only characters who were in that place at the time (the brief shows who was where) or who could plausibly hear or see it from nearby; a character elsewhere perceives nothing unless it is told later. You never make up places or characters (a separate world author does that when the story genuinely needs it); change a way (exit_changes) only when the rounds clearly show a door unlocked, locked or a way blocked or cleared. Relationships between characters are small profiles (relationships: a label for what the other is to it, a sentence, how well it knows, trusts, likes and is strained with the other): record or revise one only when what happened really changes how a character stands towards another (a bond formed, trust broken, a secret shared), not for every pleasantry, and only the fields that changed.
- things: what characters did with things (took, dropped, gave, put, wore, opened, locked, found) was decided by the game master and is already written, as is where every thing now is; do not move things. Name the things an event is about (items, by key: the key that was taken, the chest that was opened); an event about a thing is how the story remembers what happened to it. Change a thing yourself (item_edits) only for what no character did: it broke, a lock gave way, the story says whose it is.
- off stage: a round marked off stage is what characters away from the player's character decided to do when something fell due for them (a meeting whose time came, a deadline that passed). Write what each of them did, from their own entries, with the characters in it as the only ones who perceive it (those who actually met perceive each other); where a commitment is concerned, say in engagement_edits whether it was kept (they met), missed (someone did not come) or cancelled, from what the entries show, and move a goal on (intent_edits) when what they did settles it. Nobody went anywhere that is not shown in the entry.
- time: each round says when it happened. The story's clock is kept separately, so do not write times into events unless the story itself states one ("the train leaves at nine"); order and timing come from the turn and round.
- goals and commitments: a character's goals (what it is after: a promise made, a task taken on, a scheme) and its engagements (something dated it committed to) are listed below with their ids. Add one (intents_added, engagements) only when the rounds clearly establish it and it is not listed already: an engagement needs a time that the rounds state or that follows from the story's clock ("tomorrow at nine" is a date and time: work it out from the time of the round), the place when one was named, and everyone who committed to it. Move them on (intent_edits, engagement_edits) when the rounds show it: a goal done, failed, given up or more pressing, a step taken; an engagement kept, missed (nobody came, or it was forgotten), cancelled or put off. Whether a character kept to a commitment is what the rounds show it did; never judge it by the clock alone. A character's routine is not yours to write.
- tracked variables: what the story tracks (feelings, injuries, debts, flags: list_variables shows each and what it is about) changes with variable_changes: a feeling when the rounds show a clear change (private to the character: its feelings are written from what it did and what happened to it, never from what others thought), a number moved with by, a flag or a word with to. What the game master already changed is written; write what it did not, and only what the rounds establish. A temperament (baseline) changes only for a lasting change. You never declare a new variable: a world author does, when the story genuinely needs one.
- states: what the game master decided about each character's activity and public_state is already written. Write a state only for inner_state or emotion, or to fix a public_state that the rounds clearly contradict, and only the fields that changed. public_state is a short present-tense description of what can be seen now (position, posture, expression, what it holds), never a log of events and never a thought. inner_state is what it now thinks or feels, and only if the rounds show it. activity is what it is doing now. emotion only when the rounds show a clear change.
- beliefs: only when a character clearly learns, suspects or concludes something beyond the single event; written from that character's point of view; kind is belief, relationship or knowledge.
- threads_opened: only a promise, mystery or goal that the rounds clearly leave unsettled and that is not already open. threads_resolved: ids of open threads that the rounds settle.`

/** What the keeper reads back by default: the parts of the records its edits write. */
const VERIFY_SECTIONS = ['characters', 'events', 'beliefs', 'open_threads', 'relationships', 'variables', 'engagements'] as const

const label = (round: { turn: number; round: number }): string => `turn ${round.turn}, round ${round.round}`

function describeRound(round: RoundRecord): string[] {
  return [
    `## ${label(round)}`,
    round.offstage === true ? `Off stage (away from the player's character; only the characters named here perceive it, and only those who were together perceive each other): ${round.situation}` : `The moment (includes what the player's character did or said): ${round.situation}`,
    ...(round.place === undefined ? [] : [`Place of the moment: ${round.place.name} (${round.place.key})`]),
    ...(round.time === undefined ? [] : [`When: ${describeInstant(round.time.from, round.time.zone)} (${dayPart(localTime(round.time.from, round.time.zone).minuteOfDay)})${round.time.to > round.time.from ? `; the round took ${describeDuration(round.time.to - round.time.from)}` : ''}`]),
    'What each character did, and what became of it:',
    ...round.entries.map(entry => [
      entry.player === true ? `- ${entry.character} (${entry.name}, the player's character): ${entry.result}: ${entry.summary}` : `- ${entry.character} (${entry.name}): intended "${entry.intent}" [commitment: ${entry.commitment}]; ${entry.result}: ${entry.summary}`,
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
  const wanted = new Set(['read_records', 'edit_records', 'search_events', 'list_threads', 'list_locations', 'get_location', 'list_relationships', 'list_items', 'get_item', 'get_agenda', 'list_variables'])
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
        parent, signal, reasoningEffort: job.store.settings().reasoning.children,
        persona: KEEPER_PERSONA,
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
