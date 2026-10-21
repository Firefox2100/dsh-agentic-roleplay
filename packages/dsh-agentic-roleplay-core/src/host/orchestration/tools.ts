import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describeTime, type SkipRequest } from '../clock/story-clock.ts'
import type { Boundaries, CreateReport, TriggerReport, TurnStore } from './boundaries.ts'
import { answerRunner, characterRunner } from './character-runner.ts'
import { encodeOutput, encodePreview } from '../../shared/narration.ts'
import { trimCharacters } from '../../shared/text.ts'
import { AUTHORING_NEEDS } from './boundaries.ts'
import { ITEM_ACTIONS, describeDuration, type ItemAction } from '@dsh-agentic-roleplay/state'
import { RESULTS, type CharacterFailure, type Outcome, type TurnOutput, type Utterance } from './protocol.ts'
import type { AttemptReport, RawSegment, ResolveReport, TurnEngine, TurnOwner } from './turn-engine.ts'
import { plotAuthorNeeded, updatePlotProgress } from '../pacing/director.ts'
import { authorPlot } from '../pacing/author.ts'

export const ACTIVATE_TOOL = 'activate_characters'
export const RESOLVE_TOOL = 'resolve_round'
export const NARRATE_TOOL = 'narrate'
export const RECORD_TOOL = 'record_memory'
export const EXPAND_TOOL = 'expand_world'
export const INTRODUCE_TOOL = 'introduce_thing'
export const TIME_TOOL = 'advance_time'
export const PREVIEW_TOOL = 'preview_scene'
export const RULING_TOOL = 'ooc_ruling'
export const ANSWER_TOOL = 'ooc_answer'
export const JUDGE_TOOL = 'judge_action'
export const PLOT_TOOL = 'record_plot_progress'
export const AUTHOR_PLOT_TOOL = 'author_plot'

export interface ToolDeps {
  engine: TurnEngine
  boundaries: () => Boundaries
  stores: (chat: string) => TurnStore | undefined
  /** The turn the agent is in. */
  turnOf: (agent: Agent) => number
  /** The output of a turn was delivered. */
  delivered?: (chat: string, output: TurnOutput) => string | undefined
}

/** The JSON value the tool records; the model reads the rendered text. */
function record(value: unknown): never {
  return JSON.parse(JSON.stringify(value)) as never
}

function failures(list: readonly CharacterFailure[]): string[] {
  return list.length === 0 ? [] : ['', 'Could not act:', ...list.map(failure => (failure.technical === true
    ? `- ${failure.character} (${failure.name}): no decision came back. That is a fault of the system, not something that happened in the story: nothing is recorded for ${failure.name} this round, so write nothing for them and say nothing about why`
    : `- ${failure.character} (${failure.name}): ${failure.reason}`))]
}

export function renderAttempt(attempt: AttemptReport): string {
  const heading = attempt.attempt === 1
    ? 'The characters acted. Their intents may conflict with each other; you decide what actually happens.'
    : 'These characters failed but were highly committed, so each tried once more, knowing what just happened.'
  const lines = attempt.reports.map(report => `- ${report.character} (${report.name}): ${report.utterance === undefined ? 'says nothing' : `says "${report.utterance}"`}; does: ${report.intent} [commitment: ${report.commitment}]`)
  const next = attempt.reports.length === 0
    ? ['', 'Nobody could act. Fix the problem or call activate_characters again with a different set.']
    : attempt.attempt === 1
      ? ['', `Now call ${RESOLVE_TOOL} with one outcome for each of: ${attempt.reports.map(report => report.character).join(', ')}.`]
      : ['', `Call ${RESOLVE_TOOL} once more with one outcome for each of: ${attempt.reports.map(report => report.character).join(', ')}. There are no further retries: what you decide now is final.`]
  return [heading, ...lines, ...failures(attempt.failures), ...next].join('\n')
}

/** Who went where because their day says so. */
const routineLine = (move: { name: string; to: string; activity: string }): string => `By their routine, ${move.name} is now at ${move.to} (${move.activity}).`

const OUTPUT_RULES = 'Deliver the output with the narrate tool as ordered segments: utterances and narration. Narration may come before, between and after utterances and is yours to write. Utterances are the characters\' words: include every one exactly as given, once, in the order they were spoken, and never change, add or remove one.'

const listed = (utterances: readonly Utterance[]): string =>
  utterances.map(utterance => `- ${utterance.character} (${utterance.name}), round ${utterance.round}: "${utterance.text}"`).join('\n')

/** What the world did by itself, as the game master is told: what happened, what characters notice, and what it is to weave in. */
export function renderWorld(world: TriggerReport['fired']): string[] {
  return world.flatMap(entry => [
    ...entry.events.map(text => `The world acted (${entry.name}): ${text}`),
    ...entry.cues.map(cue => `${cue.names.join(' and ')} will notice: ${cue.text}`),
    ...entry.beats.map(beat => `Weave this into the story, then say you did with addressed: [${beat.id}] in narrate (${beat.text})`),
  ])
}

function renderResolution(report: ResolveReport): string {
  if (report.next !== undefined) return renderAttempt(report.next)
  const done = report.done
  if (done === undefined) return ''
  const left = done.limit - done.round
  const passed = done.time.to - done.time.from
  const lines = [`Round ${done.round} is recorded (${done.updated.join(', ')}).`, `It is now ${describeTime({ now: done.time.to, zone: done.time.zone })}${passed > 0 ? `; ${describeDuration(passed)} passed` : ''}.`, ...done.moved.map(routineLine), ...done.moves.map(move => `${move.name} is now at ${move.to}${move.via > 0 ? ` (by way of ${move.via} other place${move.via === 1 ? '' : 's'})` : ''}.`), ...done.things.map(thing => `${thing.name}: ${thing.summary}.`), ...done.variables.map(line => `${line}.`), ...renderWorld(done.world), ...failures(done.retryFailures)]
  lines.push(done.spoken.length === 0
    ? 'Nobody has said anything yet this turn.'
    : `Everything said so far this turn, in order; the output must carry all of it exactly:\n${listed(done.spoken)}`)
  lines.push(left > 0
    ? `Now decide. If the story genuinely flows from what just happened (someone is directly answered, a reaction is natural, something is left unresolved that the characters would act on), call activate_characters for the next round: ${left} round(s) are left for this message. Otherwise give control back to the player now.`
    : 'That was the last round allowed for this message: give control back to the player now.')
  lines.push(done.waiting === 0
    ? 'Nothing is waiting to be recorded.'
    : `${done.waiting} round${done.waiting === 1 ? ' is' : 's are'} waiting to be recorded in the story's memory. Memory is not written after every round: call ${RECORD_TOOL} when the story just moved on (a decision made, a secret or fact revealed, a promise, an injury, a relationship changed, the scene or time moved); skip it for small talk and routine movement, which are kept and recorded together with the next thing that matters.`)
  lines.push(OUTPUT_RULES)
  lines.push('Narrate only what the player\'s character can perceive.')
  return lines.join('\n')
}

function renderExpansion(report: CreateReport): string {
  if (report.created.length === 0) return `Nothing was made up: ${trimCharacters((report.declined ?? 'the world author found nothing the story needs').trimEnd(), '.', 'end').trimEnd()}. Work with what exists.`
  const lines = report.created.map(entry => `- ${entry.kind} ${entry.key} (${entry.name})`)
  const characters = report.created.filter(entry => entry.kind === 'character')
  return [
    'Made up and fitted into the world:',
    ...lines,
    ...(characters.length === 0 ? [] : [`${characters.length === 1 ? 'They are' : 'They are all'} now in the cast: ask them to act with ${ACTIVATE_TOOL}, by their keys, like anyone else.`]),
    ...(report.declined === undefined ? [] : [`Not made: ${report.declined}`]),
  ].join('\n')
}

/** The tools the game master plays a turn with. */
export function createTools(deps: ToolDeps): ToolDefinition[] {
  const ownerOf = (agent: Agent | undefined): { agent: Agent; owner: TurnOwner } => {
    if (agent === undefined) throw new Error('the roleplay tools can only be called by an agent')
    return { agent, owner: { chat: agent.session.id, turn: deps.turnOf(agent) } }
  }

  const storeOf = (chat: string): TurnStore => {
    const store = deps.stores(chat)
    if (store === undefined) throw new Error('this chat is not a roleplay session')
    return store
  }

  const activate = defineTool({
    name: ACTIVATE_TOOL,
    description: 'Let the characters act: one round of the turn. Each character asked is asked, separately and at the same time, what it intends to do and say in the situation you describe and how committed it is. Call it after reading what the player did, and again for a later round only when the story genuinely needs the characters to react to what just happened; the number of rounds for one player message is limited.',
    parameters: {
      characters: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Keys of the characters to ask, chosen by you from the scene (where each is, what each is doing). Ask only those the moment reaches: those in the same place, and those elsewhere who can plainly see, hear or are summoned; a character elsewhere perceives nothing by itself. Never the whole cast. In a later round ask only those the moment calls for.',
      },
      situation: {
        type: 'string',
        required: true,
        description: 'An objective description of the moment: in the first round what the player\'s character just did or said; in a later round what is happening now, following from the rounds before (they are told those too). Every character is told this and nothing more, so leave out anyone\'s private thoughts.',
      },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderAttempt(value as unknown as AttemptReport) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      await deps.engine.settle(owner.chat, owner.turn)
      const run = characterRunner({ parent: agent, boundaries: deps.boundaries, store: storeOf(owner.chat) })
      return record(await deps.engine.activate(owner, { situation: args.situation, characters: args.characters }, run, exec.signal))
    },
  })

  const resolve = defineTool({
    name: RESOLVE_TOOL,
    description: 'Decide what actually happens to each character that acted in the current round, from their intents and the scene only. Intents can conflict; settle them consistently. A character whose intent fails and who was highly committed gets one more chance, and you resolve that attempt too. The player\'s character is not asked to act, but you may include an outcome for it (its key is in the scene) when what the player did moves it somewhere or has it handle things; when nobody else needs to react (the player just walks somewhere, picks something up), call this with only that outcome, without activate_characters. When nobody retries, the round is recorded and you decide whether another round is needed or the turn goes back to the player.',
    parameters: {
      outcomes: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            character: { type: 'string', required: true, description: 'The character\'s key; for the player\'s character, only when it moves or handles things; in an out-of-character command, any character of the story.' },
            result: { type: 'string', required: true, enum: RESULTS, description: 'Whether the character\'s intent went through.' },
            summary: { type: 'string', required: true, description: 'What concretely happens to the character, in a sentence. It becomes what the character is doing.' },
            roll: { type: 'integer', description: 'The id of the dice roll that decided this outcome (the id roll_check gave), when you rolled for it: the result you give must be the roll\'s.' },
            spoken: { type: 'boolean', description: 'Whether the character gets to say its utterance. It does unless something prevents it, such as being silenced or knocked out first.' },
            public_state: { type: 'string', description: 'What anyone present can now see or infer about the character, when that changed.' },
            item_changes: {
              type: 'array',
              description: 'What the character does with things as a result, in order, when it does: leave out when it handles nothing. Each is checked, and you are told why when it cannot be done. Not for a character whose intent failed.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  item: { type: 'string', required: true, description: 'The key of the item, as the scene lists it. Leave a way\'s lock to exit.' },
                  action: { type: 'string', required: true, enum: ITEM_ACTIONS, description: 'take (pick up what is here or take it out of a container it carries), drop (leave it here), give (to someone present), put (into an open container), wear, remove (what is worn), open, close, lock, unlock, reveal (find what was hidden).' },
                  to: { type: 'string', description: 'For give: who gets it. For put: the container.' },
                  quantity: { type: 'integer', description: 'How many, of a pile; all when left out.' },
                  position: { type: 'string', description: 'Where, in words, for drop and put.' },
                  feature: { type: 'string', description: 'For drop: the feature of the place it is left at.' },
                  with: { type: 'string', description: 'For lock and unlock: the key item used. It has to be in hand and fit the lock.' },
                  exit: { type: 'string', description: 'For lock and unlock of a way instead of an item: the key of the place it leads to.' },
                  forced: { type: 'boolean', description: 'Only when the story breaks the lock (picked, smashed): no key is needed.' },
                },
              },
            },
            variable_changes: {
              type: 'array',
              description: 'What this changes of what the story keeps track of (the scene lists it; list_variables shows what exists): a feeling, an injury, a flag, a debt. Only what the outcome establishes; to is the new value (a number, true or false, or one of the words of a choice), by is an amount a number goes up or down (it stops at its bounds).',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  variable: { type: 'string', required: true, description: 'The key of the variable.' },
                  subject: { type: 'string', required: true, description: 'The key of the character, item or place it is about; world for the whole story.' },
                  to: { oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }], description: 'The new value.' },
                  by: { type: 'number', description: 'How much a number goes up (positive) or down (negative).' },
                  baseline: { oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }], description: 'For a variable with a temperament (feelings): the new baseline, when what happened changes it lastingly.' },
                },
              },
            },
            moves_to: {
              type: 'object',
              additionalProperties: false,
              description: 'Where the character ends up if it goes somewhere as a result: leave out when it stays. It must be possible (a way over open exits); you are told why if it is not. Not for a character whose intent failed. A journey takes at least as long as the ways on it say, whatever elapsed_seconds you give.',
              properties: {
                location: { type: 'string', required: true, description: 'The key of the place, as the scene lists it.' },
                position: { type: 'string', description: 'Where in the place, in words: "by the window".' },
                feature: { type: 'string', description: 'The key of a feature of that place it is at.' },
                ignore_exits: { type: 'boolean', description: 'Only when the story itself carries it (carried off, teleported, falls): the exits do not matter.' },
              },
            },
          },
        },
      },
      elapsed_seconds: {
        type: 'integer',
        description: 'How long this round took in the story, in seconds:: a few seconds for a remark, a minute or two for a conversation, longer for work or a journey. Left out, the chat\'s default applies. Not when the story\'s time follows the wall clock.',
      },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderResolution(value as unknown as ResolveReport) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      await deps.engine.settle(owner.chat, owner.turn)
      const run = characterRunner({ parent: agent, boundaries: deps.boundaries, store: storeOf(owner.chat) })
      const outcomes: Outcome[] = args.outcomes.map(outcome => ({
        character: outcome.character,
        result: outcome.result as Outcome['result'],
        summary: outcome.summary,
        ...(outcome.public_state === undefined ? {} : { publicState: outcome.public_state }),
        ...(outcome.spoken === undefined ? {} : { spoken: outcome.spoken }),
        ...(outcome.roll === undefined ? {} : { roll: outcome.roll }),
        ...(outcome.item_changes === undefined || outcome.item_changes.length === 0 ? {} : { itemChanges: outcome.item_changes.map(change => ({ item: change.item, action: change.action as ItemAction, ...(change.to === undefined ? {} : { to: change.to }), ...(change.quantity === undefined ? {} : { quantity: change.quantity }), ...(change.position === undefined ? {} : { position: change.position }), ...(change.feature === undefined ? {} : { feature: change.feature }), ...(change.with === undefined ? {} : { with: change.with }), ...(change.exit === undefined ? {} : { exit: change.exit }), ...(change.forced === true ? { forced: true } : {}) })) }),
        ...(outcome.variable_changes === undefined || outcome.variable_changes.length === 0 ? {} : { variableChanges: outcome.variable_changes.map(change => ({ variable: change.variable, subject: change.subject, ...(change.to === undefined ? {} : { to: change.to }), ...(change.by === undefined ? {} : { by: change.by }), ...(change.baseline === undefined ? {} : { baseline: change.baseline }) })) }),
        ...(outcome.moves_to === undefined ? {} : { moveTo: { location: outcome.moves_to.location, ...(outcome.moves_to.position === undefined ? {} : { position: outcome.moves_to.position }), ...(outcome.moves_to.feature === undefined ? {} : { feature: outcome.moves_to.feature }), ...(outcome.moves_to.ignore_exits === true ? { ignoreExits: true } : {}) } }),
      }))
      return record(await deps.engine.resolve(owner, outcomes, run, exec.signal, args.elapsed_seconds))
    },
  })

  const narrate = defineTool({
    name: NARRATE_TOOL,
    description: 'Deliver the output of the turn to the player and give control back to them, once at least one round is recorded: the characters\' utterances from all the rounds and your narration, as ordered segments. Every utterance a character gave must appear exactly once, exactly as given and in the order spoken; narration is free. An output that changes, drops, invents or reorders an utterance is refused with what is wrong.',
    parameters: {
      segments: {
        type: 'array',
        description: 'The output in order. Leave out only when a narrator other than you writes the output.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', required: true, enum: ['utterance', 'narration'] },
            character: { type: 'string', description: 'For an utterance: the key of the character who says it.' },
            text: { type: 'string', required: true, description: 'For an utterance: the words exactly as the character gave them, without quotation marks. For narration: what the player reads.' },
          },
        },
      },
      addressed: { type: 'array', items: { type: 'integer' }, description: 'The ids of the beats you were told to weave in that this output does. Beats you do not address are told again, then let go.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const output = value as unknown as TurnOutput
        const said = output.repaired
          ? 'The output was corrected so that every utterance appears exactly as the characters gave it, and has been delivered to the player. The turn ends here.'
          : 'The output has been delivered to the player. The turn ends here.'
        return [{ type: 'text', text: `${said}\n${encodeOutput(output)}` }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      await deps.engine.settle(owner.chat, owner.turn)
      const segments: RawSegment[] = (args.segments ?? []).map(segment => ({
        type: segment.type as RawSegment['type'],
        text: segment.text,
        ...(segment.character === undefined ? {} : { character: segment.character }),
      }))
      const output = await deps.engine.narrate(owner, segments, characterRunner({ parent: agent, boundaries: deps.boundaries, store: storeOf(owner.chat) }), args.addressed ?? [])
      const timelineNode = deps.delivered?.(owner.chat, output)
      const delivered = timelineNode === undefined ? output : { ...output, timelineNode }
      // The output is the end of the turn: nothing the model adds after it would be checked.
      exec.concludeTurn()
      return record(delivered)
    },
  })

  const remember = defineTool({
    name: RECORD_TOOL,
    description: 'Have the memory keeper write what happened since the last record into the story\'s lasting memory: the events, what each character took in of them, what they now believe, and the threads left open. It works in the background and covers every round still waiting, from this turn and earlier ones. Call it when the story changes phase, not after every round; rounds you do not record are kept and recorded together later.',
    parameters: {
      focus: { type: 'string', description: 'What is worth keeping, in a sentence: the decision, revelation or change that matters. The keeper writes it first and may leave out incidental detail.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: `The memory keeper is writing ${(value as unknown as { rounds: number }).rounds} round${(value as unknown as { rounds: number }).rounds === 1 ? '' : 's'} into the story's memory.` }] },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      return Promise.resolve(record({ rounds: deps.engine.record(owner, args.focus) }))
    },
  })

  const plot = defineTool({
    name: PLOT_TOOL,
    description: 'Record only what play has already established about an optional plot. introduced means the named opportunity actually became perceptible in the resolved round, not merely that the pacing note suggested it. rejected means the player clearly declined that specific hook. resolved or abandoned applies to the plot as a whole. This records pacing state; it creates no event and makes nothing happen.',
    parameters: {
      plot: { type: 'string', required: true, description: 'The plot id from the pacing opportunity.' },
      development: { type: 'string', description: 'The development id; required for introduced or rejected.' },
      action: { type: 'string', required: true, enum: ['introduced', 'rejected', 'resolved', 'abandoned'] },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: `Plot pacing recorded: ${(value as unknown as { plot: { name: string }; status: string }).plot.name} is ${(value as unknown as { status: string }).status}.` }] },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      return Promise.resolve(record(updatePlotProgress(storeOf(owner.chat), args.plot, args.development, args.action)))
    },
  })

  const makePlot = defineTool({
    name: AUTHOR_PLOT_TOOL,
    description: 'Ask a plot author for one optional, branching dramatic scaffold grounded in the current session. Use only when the scene explicitly says the quiet story has no plot scaffold and a reusable tension would help. It creates possibilities, not events, actions or obligations; do not introduce any part until a later pacing opportunity fits.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => { const made = value as unknown as { id: string; name: string; premise: string }; return [{ type: 'text', text: `Authored optional plot ${made.name} [${made.id}]: ${made.premise}. Nothing in it has happened. Continue this turn normally; a later pacing opportunity may offer a hook.` }] } },
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      const store = storeOf(owner.chat)
      if (!plotAuthorNeeded(store, owner.turn)) throw new Error('the story does not currently need a plot author; continue with its existing plots, threads and character goals')
      return record(await authorPlot(agent, store, owner.turn, exec.signal))
    },
  })

  const expand = defineTool({
    name: EXPAND_TOOL,
    description: 'Have a new character or place made up and fitted into the world, only when the story genuinely needs it. Valid reasons: scene_change (the story has actually gone somewhere that no known place covers, even as part of one), arrival (someone new has actually arrived or been brought into the scene), introduction (a specific person who has not appeared is needed by what is happening now and the story has established who they are), object (a thing so important or so complex that it needs inventing, such as an artifact with properties or a vehicle; or a place on the body that the world has no slot for; ordinary things the story uses are yours to bring in with introduce_thing), trigger (the story set up a moment that is bound to come, such as a deadline given, a promised arrival or a trap laid, that can be stated as a condition: a time, someone in a place, a thing held, a variable, an event), variable (a quantity, state or choice the story established matters from here on and nothing tracked fits: a debt, a health, a reputation). Not valid: colour, atmosphere, filling a quiet scene, something mentioned in passing, a passer-by or a crowd, scenery, or anything an existing character, place or thing can serve; use those. Ordinary things go through introduce_thing. A world author decides, and may decline and say what exists that can serve. A few things at most per turn.',
    parameters: {
      need: { type: 'string', required: true, enum: AUTHORING_NEEDS, description: 'Why: scene_change, arrival, introduction, object, variable or trigger.' },
      what: { type: 'string', required: true, description: 'What is needed, from what the story has established: who or where (a name when it was given), their role, what happened to make it needed now, and where it is in relation to what exists.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderExpansion(value as unknown as CreateReport) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      await deps.engine.settle(owner.chat, owner.turn)
      return record(await deps.engine.expand(owner, { need: args.need, what: args.what }, exec.signal))
    },
  })

  const introduce = defineTool({
    name: INTRODUCE_TOOL,
    description: 'Bring a thing into the story as a table\'s game master would: something the story is about to use or that the player can find, take or handle (a barricade, a tool, a note, a bottle, a key) and that does not exist yet. It is made at once, where you say: at a place (at, a place key; the player\'s place when you say nothing), in someone\'s hands (held_by, a character key) or inside a thing (inside, an item key). Afterwards it is a thing like any other: use its key in item_changes. Not for scenery nobody will touch (that is just part of the place), not for something important and complex enough to need a world author (use expand_world, reason object), and never for what exists already (list_items). A few things at most per turn.',
    parameters: {
      name: { type: 'string', required: true, description: 'What it is called, as the story names it.' },
      description: { type: 'string', description: 'One or two sentences: what it looks like, what it is made of, what state it is in.' },
      quantity: { type: 'integer', description: 'How many, when it is a number of the same thing (default 1).' },
      quality: { type: 'string', description: 'Its condition in a word or two (rusty, new), when that matters.' },
      notable: { type: 'boolean', description: 'Whether the characters present would notice it at once.' },
      hidden: { type: 'boolean', description: 'Whether it starts out of sight (until a round reveals it).' },
      at: { type: 'string', description: 'The key of the place it lies in.' },
      held_by: { type: 'string', description: 'The key of the character who holds it.' },
      inside: { type: 'string', description: 'The key of the container it is in.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => { const made = value as unknown as { key: string; name: string; where: string }; return [{ type: 'text', text: `Introduced ${made.name} [${made.key}], ${made.where}. Use the key in item_changes; nobody has taken it up yet.` }] } },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      await deps.engine.settle(owner.chat, owner.turn)
      return record(deps.engine.introduce(owner, {
        name: args.name,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        ...(args.quality === undefined ? {} : { quality: args.quality }),
        ...(args.notable === undefined ? {} : { notable: args.notable }),
        ...(args.hidden === undefined ? {} : { hidden: args.hidden }),
        ...(args.at === undefined ? {} : { at: args.at }),
        ...(args.held_by === undefined ? {} : { heldBy: args.held_by }),
        ...(args.inside === undefined ? {} : { inside: args.inside }),
      }))
    },
  })

  const skip = defineTool({
    name: TIME_TOOL,
    description: 'Skip ahead in the story\'s time, between rounds: the player\'s character sleeps till morning, waits, or travels for days. Say either how long (by_minutes) or until when (until_time, and days_later for a later day). Time does not otherwise pass faster than the rounds take; use this only for a stretch that is summarised rather than played. Nothing else changes: if the skip changes what characters are doing or where they are, run a round for them afterwards. Not available when the story\'s time follows the wall clock.',
    parameters: {
      reason: { type: 'string', required: true, description: 'What happens in the time that passes, in a sentence ("they sleep", "the ferry crosses").' },
      by_minutes: { type: 'integer', description: 'How many minutes to skip.' },
      until_time: { type: 'string', description: 'The time of day to skip to, 24-hour HH:MM: the next time the clock reads it, or the day given by days_later.' },
      days_later: { type: 'integer', description: 'With until_time: that many days after today (0 is later today, 1 is tomorrow).' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => { const done = value as unknown as { from: number; to: number; zone: string; moved: { name: string; to: string; activity: string }[]; world: TriggerReport['fired'] }; return [{ type: 'text', text: `${describeDuration(done.to - done.from)} pass. It is now ${describeTime({ now: done.to, zone: done.zone })}.${done.moved.length === 0 ? '' : ` ${done.moved.map(routineLine).join(' ')}`} Nothing else changed: characters with you are still doing what they were, where they were; run a round for them if the time that passed changes that.${done.world.length === 0 ? '' : `\n${renderWorld(done.world).join('\n')}`}` }] } },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      await deps.engine.settle(owner.chat, owner.turn)
      const given = [args.by_minutes !== undefined, args.until_time !== undefined].filter(Boolean).length
      if (given !== 1) throw new Error('give exactly one of by_minutes and until_time')
      if (args.days_later !== undefined && args.until_time === undefined) throw new Error('days_later goes with until_time')
      const request: SkipRequest = args.by_minutes !== undefined
        ? { byMinutes: args.by_minutes, reason: args.reason }
        : { untilTime: args.until_time ?? '', ...(args.days_later === undefined ? {} : { daysLater: args.days_later }), reason: args.reason }
      return record(deps.engine.advanceTime(owner, request))
    },
  })

  const preview = defineTool({
    name: PREVIEW_TOOL,
    description: 'Show the player how the scene opens, as your very first action of a turn, before you ask any character: two or three sentences that set the mood and what the player\'s character perceives, ending on the open question of the moment. It is on screen at once, while the characters are still being asked, and is replaced in the player\'s view by the output you deliver with narrate, which may use it, change it or start over. Describe only what the scene and the player\'s own action establish: never what any other character does, says, decides or thinks, and nothing the player\'s character cannot perceive. Once per message.',
    parameters: { text: { type: 'string', required: true, description: 'The opening, plain prose in the narration voice.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: `${encodePreview((value as unknown as { text: string }).text)}\nShown to the player. Now call activate_characters.` }] },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      return Promise.resolve(record({ text: deps.engine.preview(owner, args.text) }))
    },
  })

  const ruling = defineTool({
    name: RULING_TOOL,
    description: 'Rule on the player\'s out-of-character command, as the very first thing of an out-of-character turn: legal is false only when the command breaks the rules of the world or the player\'s own rules (the scene lists them); what is merely strange, impossible for the characters, or hard on them is legal, because the player may change the story itself. The reason is shown to the player, so write it plainly to them. Only a legal ruling lets you change anything.',
    parameters: {
      rule_check: { type: 'string', required: true, description: 'First, go through every rule the scene lists, one by one, in a few words each: does the command need what the rule excludes (the rules are literal: a rule against magic is broken by anything magical, however the command words it, and strange is not the same as against a rule)? Write "no rules listed" when there are none.' },
      legal: { type: 'boolean', required: true, description: 'Whether the command is allowed: false when any listed rule is broken.' },
      reason: { type: 'string', required: true, description: 'To the player, in plain words and briefly: what you will do, or which rule it breaks.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: (value as unknown as { legal: boolean }).legal
        ? `Ruled legal. Now make it happen: ${RESOLVE_TOOL} (outcomes for any characters, asked or not, with their moves and things), ${EXPAND_TOOL} (for what does not exist yet), ${TIME_TOOL}; do only what the command says. Then call ${NARRATE_TOOL} with narration only, of what the player can perceive.`
        : `Ruled illegal; nothing changes. Call ${NARRATE_TOOL} with no segments: the player is told why.` }],
    },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      return Promise.resolve(record(deps.engine.rule(owner, args.legal, args.reason)))
    },
  })

  const answer = defineTool({
    name: ANSWER_TOOL,
    description: 'Have the player\'s out-of-character question answered, as the very first thing of a question turn. You do not write the answer: it is written from what the player\'s character knows (what it remembers, knows to exist, carries and sees where it is), so that nothing hidden is given away. Nothing in the story changes, nobody is asked to act and time does not pass.',
    parameters: {},
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: `The player is shown the answer. Now call ${NARRATE_TOOL} with no segments.` }] },
    isConcurrencySafe: () => false,
    async execute(_args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      return record(await deps.engine.answer(owner, answerRunner({ parent: agent, boundaries: deps.boundaries, store: storeOf(owner.chat) }), exec.signal))
    },
  })

  const judge = defineTool({
    name: JUDGE_TOOL,
    description: 'Judge what the player\'s character tries, as the very first thing of an ordinary turn (nothing else is accepted before it): allowed is false when it is not viable (what it needs is out of reach, is not there, or the character cannot do it or does not have it) or when it breaks a rule of the world or of the player (the scene lists them and they are absolute: no magic means no spell works). The player\'s claim of an effect is not a fact. What merely looks strange, rash or foolish is allowed. When it is not allowed the attempt is played as a failure for the player\'s character, and nobody is asked to act on it.',
    parameters: {
      rule_check: { type: 'string', required: true, description: 'First, go through every rule the scene lists, one by one, in a few words each: does what the character tries need what the rule excludes? The rules are literal. Then whether it is viable here. Write "no rules listed" when there are none.' },
      at: { type: 'string', description: 'The key of the place where the action happens, only when the player says it happens at a particular place (talking to the baker in the market, searching the cellar) rather than where the character is. If the character is somewhere else the action cannot work: it has to go there first. Leave it out when the action happens where the character is, and when the player is going somewhere (the journey is its own action).' },
      allowed: { type: 'boolean', required: true, description: 'Whether what the character tries can work: false when any listed rule is broken or it is not viable.' },
      uncertain: { type: 'boolean', required: true, description: 'Always answer, when it can work: true when it can plainly go either way and the result matters to the story, such as talking round someone wary or hostile, a hard lock, a stealthy approach past someone watching, a climb, a leap, a chase, a fight, a hurried search; false for what plainly succeeds (walking, opening an unlocked door, asking a friendly question) or has nothing at stake. When it is true and you have dice tools, you roll for it before anyone is asked to act and the dice decide; without dice tools it changes nothing.' },
      reason: { type: 'string', required: true, description: 'What the character tries, and the rule or the fact that decides it, in a sentence.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: (value as unknown as { allowed: boolean }).allowed
        ? `Judged: it can work${(value as unknown as { roll?: true }).roll === true ? ' but it is uncertain: roll for it now with roll_check (list_checks shows the checks), naming the character it is for; nobody is asked to act before the dice are rolled. Then' : '. Now'} call ${PREVIEW_TOOL} (when the scene asks for it) and ${ACTIVATE_TOOL}, describing only what the character does.`
        : `Judged: it cannot work${(value as unknown as { elsewhere?: true }).elsewhere === true ? ` (${(value as unknown as { reason: string }).reason})` : ''}. Play the failed attempt: ${RESOLVE_TOOL} with one outcome for the player's character (result failed, one sentence: what it does, what comes of it, why not) and nothing else, then ${NARRATE_TOOL}. Narrate what a witness would see of the attempt, never the effect the player claimed.` }],
    },
    isConcurrencySafe: () => false,
    execute(args, exec) {
      const { owner } = ownerOf(exec.agent)
      return Promise.resolve(record(deps.engine.judge(owner, args.allowed, args.reason, args.at, args.uncertain)))
    },
  })

  return [judge, preview, ruling, answer, activate, resolve, skip, remember, expand, introduce, makePlot, plot, narrate]
}
