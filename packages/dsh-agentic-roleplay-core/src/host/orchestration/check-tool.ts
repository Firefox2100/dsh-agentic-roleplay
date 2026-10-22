import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { rollForCheck } from '@dsh-agentic-roleplay/state'
import { encodeOutput } from '../../shared/narration.ts'
import { characterRunner } from './character-runner.ts'
import { record, type ToolDeps } from './tools.ts'
import type { TurnOutput } from './protocol.ts'

export const CHECK_NARRATE_TOOL = 'roll_and_narrate'

const BRANCHES = [
  ['succeeded', 'on_success'],
  ['partial', 'on_partial'],
  ['failed', 'on_failure'],
] as const

const SUMMARY = 'What concretely happens to the character, in a sentence. It becomes what the character is doing.'
const NARRATION = 'What the player reads: narration only, no one else speaks.'

/**
 * The game master settles a lone attempt of the player's character in one call: it writes what comes of each way the dice may fall and the code rolls and
 * delivers the branch they chose. A fast path only: anything that asks characters, moves someone or handles things goes through the ordinary round.
 */
export function createCheckNarrateTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: CHECK_NARRATE_TOOL,
    description: 'Settle the player\'s own uncertain attempt in one step when nobody else needs to react and nothing moves or changes hands: write what comes of each way the check can fall, the dice are rolled for you, and the branch they choose is recorded as the round and delivered as the output, ending the turn. Give a branch for every result the check can give (list_checks shows its bands). The branches you do not get are discarded, so keep each short. When others must react, anything moves or things change hands, use roll_check, resolve_round and narrate instead.',
    parameters: {
      check: { type: 'string', required: true, description: 'The key of the check, as list_checks gives it.' },
      character: { type: 'string', required: true, description: 'The key of the player\'s character.' },
      reason: { type: 'string', required: true, description: 'What is attempted, in a sentence.' },
      target: { type: 'integer', description: 'When the check is read against a target: the difficulty, set by how hard the attempt is. Never 0 to make it easy.' },
      bonus: { type: 'integer', description: 'What the circumstances add to or take from the roll, from -10 to 10; leave out for none.' },
      on_success: { type: 'object', additionalProperties: false, description: 'What happens when the attempt succeeds.', properties: { summary: { type: 'string', required: true, description: SUMMARY }, narration: { type: 'string', required: true, description: NARRATION } } },
      on_partial: { type: 'object', additionalProperties: false, description: 'What happens when the check gives a partial result; only for a check with a partial band.', properties: { summary: { type: 'string', required: true, description: SUMMARY }, narration: { type: 'string', required: true, description: NARRATION } } },
      on_failure: { type: 'object', additionalProperties: false, description: 'What happens when the attempt fails.', properties: { summary: { type: 'string', required: true, description: SUMMARY }, narration: { type: 'string', required: true, description: NARRATION } } },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const done = value as unknown as { roll: string; output: TurnOutput }
        return [{ type: 'text', text: `${done.roll}\nThe output has been delivered to the player. The turn ends here.\n${encodeOutput(done.output)}` }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('the roleplay tools can only be called by an agent')
      const owner = { chat: agent.session.id, turn: deps.turnOf(agent) }
      await deps.engine.settle(owner.chat, owner.turn)
      const store = deps.stores(owner.chat)
      if (store === undefined) throw new Error('this chat is not a roleplay session')
      const check = store.story.dice.check(args.check)
      if (check === undefined) throw new Error(`there is no check "${args.check}"; list_checks shows the story's checks`)
      const problem = deps.engine.soloCheckProblem(owner, args.character)
      if (problem !== undefined) throw new Error(problem)
      const given = { succeeded: args.on_success, partial: args.on_partial, failed: args.on_failure }
      const missing = BRANCHES.filter(([result]) => check.bands.some(band => band.result === result) && given[result] === undefined).map(([, name]) => name)
      if (missing.length > 0) throw new Error(`the check "${check.key}" can give ${[...new Set(check.bands.map(band => band.result))].join(', ')}: give ${missing.join(' and ')} too; nothing was rolled`)

      const rolled = rollForCheck({ session: store.story, turn: owner.turn }, { check: check.key, reason: args.reason, character: args.character, ...(args.target === undefined ? {} : { target: args.target }), ...(args.bonus === undefined ? {} : { bonus: args.bonus }) })
      const branch = given[rolled.result]
      if (branch === undefined) throw new Error(`the roll gave ${rolled.result}, for which no branch was written`)
      const run = characterRunner({ parent: agent, boundaries: deps.boundaries, store })
      await deps.engine.resolve(owner, [{ character: args.character, result: rolled.result, summary: branch.summary, roll: rolled.roll }], run, exec.signal)
      const output = await deps.engine.narrate(owner, [{ type: 'narration', text: branch.narration }], run, []).catch((error: unknown) => {
        throw new Error(`${error instanceof Error ? error.message : String(error)}. The roll (${rolled.roll}: ${rolled.result}) and the round are already recorded: do not roll again, call narrate with the output`)
      })
      const timelineNode = deps.delivered?.(owner.chat, output)
      exec.concludeTurn()
      return record({ roll: rolled.text, output: timelineNode === undefined ? output : { ...output, timelineNode } })
    },
  })
}
