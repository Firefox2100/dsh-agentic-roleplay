import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Boundaries, TurnStore } from './boundaries.ts'
import { characterRunner } from './character-runner.ts'
import { encodeOutput } from '../../shared/narration.ts'
import { RESULTS, type CharacterFailure, type Outcome, type TurnOutput, type Utterance } from './protocol.ts'
import type { AttemptReport, RawSegment, ResolveReport, TurnEngine, TurnOwner } from './turn-engine.ts'

export const ACTIVATE_TOOL = 'activate_characters'
export const RESOLVE_TOOL = 'resolve_round'
export const NARRATE_TOOL = 'narrate'

export interface ToolDeps {
  engine: TurnEngine
  boundaries: () => Boundaries
  stores: (chat: string) => TurnStore | undefined
  /** The turn the agent is in. */
  turnOf: (agent: Agent) => number
}

/** The JSON value the tool records; the model reads the rendered text. */
function record(value: unknown): never {
  return JSON.parse(JSON.stringify(value)) as never
}

function failures(list: readonly CharacterFailure[]): string[] {
  return list.length === 0 ? [] : ['', 'Could not act:', ...list.map(failure => `- ${failure.character} (${failure.name}): ${failure.reason}`)]
}

function renderAttempt(attempt: AttemptReport): string {
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

const OUTPUT_RULES = 'Deliver the output with the narrate tool as ordered segments: utterances and narration. Narration may come before, between and after utterances and is yours to write. Utterances are the characters\' words: include every one exactly as given, once, in the order they were spoken, and never change, add or remove one.'

const listed = (utterances: readonly Utterance[]): string =>
  utterances.map(utterance => `- ${utterance.character} (${utterance.name}), round ${utterance.round}: "${utterance.text}"`).join('\n')

function renderResolution(report: ResolveReport): string {
  if (report.next !== undefined) return renderAttempt(report.next)
  const done = report.done
  if (done === undefined) return ''
  const left = done.limit - done.round
  const lines = [`Round ${done.round} is recorded (${done.updated.join(', ')}).`, ...failures(done.retryFailures)]
  lines.push(done.spoken.length === 0
    ? 'Nobody has said anything yet this turn.'
    : `Everything said so far this turn, in order; the output must carry all of it exactly:\n${listed(done.spoken)}`)
  lines.push(left > 0
    ? `Now decide. If the story genuinely flows from what just happened (someone is directly answered, a reaction is natural, something is left unresolved that the characters would act on), call activate_characters for the next round: ${left} round(s) are left for this message. Otherwise give control back to the player now.`
    : 'That was the last round allowed for this message: give control back to the player now.')
  lines.push(OUTPUT_RULES)
  lines.push('Narrate only what the player\'s character can perceive.')
  return lines.join('\n')
}

/** The three tools the game master plays a turn with. */
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
      situation: {
        type: 'string',
        required: true,
        description: 'An objective description of the moment: in the first round what the player\'s character just did or said; in a later round what is happening now, following from the rounds before (they are told those too). Every character is told this and nothing more, so leave out anyone\'s private thoughts.',
      },
      characters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keys of the characters to ask. Leave out to ask every character the player does not control. In a later round ask only those the moment calls for.',
      },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderAttempt(value as unknown as AttemptReport) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      const run = characterRunner({ parent: agent, boundaries: deps.boundaries, store: storeOf(owner.chat) })
      return record(await deps.engine.activate(owner, { situation: args.situation, ...(args.characters === undefined ? {} : { characters: args.characters }) }, run, exec.signal))
    },
  })

  const resolve = defineTool({
    name: RESOLVE_TOOL,
    description: 'Decide what actually happens to each character that acted in the current round, from their intents and the scene only. Intents can conflict; settle them consistently. A character whose intent fails and who was highly committed gets one more chance, and you resolve that attempt too. When nobody retries, the round is recorded and you decide whether another round is needed or the turn goes back to the player.',
    parameters: {
      outcomes: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            character: { type: 'string', required: true, description: 'The character\'s key.' },
            result: { type: 'string', required: true, enum: RESULTS, description: 'Whether the character\'s intent went through.' },
            summary: { type: 'string', required: true, description: 'What concretely happens to the character, in a sentence. It becomes what the character is doing.' },
            spoken: { type: 'boolean', description: 'Whether the character gets to say its utterance. It does unless something prevents it, such as being silenced or knocked out first.' },
            public_state: { type: 'string', description: 'What anyone present can now see or infer about the character, when that changed.' },
          },
        },
      },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: renderResolution(value as unknown as ResolveReport) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { agent, owner } = ownerOf(exec.agent)
      const run = characterRunner({ parent: agent, boundaries: deps.boundaries, store: storeOf(owner.chat) })
      const outcomes: Outcome[] = args.outcomes.map(outcome => ({
        character: outcome.character,
        result: outcome.result as Outcome['result'],
        summary: outcome.summary,
        ...(outcome.public_state === undefined ? {} : { publicState: outcome.public_state }),
        ...(outcome.spoken === undefined ? {} : { spoken: outcome.spoken }),
      }))
      return record(await deps.engine.resolve(owner, outcomes, run, exec.signal))
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
      const { owner } = ownerOf(exec.agent)
      const segments: RawSegment[] = (args.segments ?? []).map(segment => ({
        type: segment.type as RawSegment['type'],
        text: segment.text,
        ...(segment.character === undefined ? {} : { character: segment.character }),
      }))
      const output = await deps.engine.narrate(owner, segments)
      // The output is the end of the turn: nothing the model adds after it would be checked.
      exec.concludeTurn()
      return record(output)
    },
  })

  return [activate, resolve, narrate]
}
