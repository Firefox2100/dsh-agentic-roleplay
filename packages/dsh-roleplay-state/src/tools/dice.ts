import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DiceCheck, DiceRoll } from 'dsh-roleplay-model'
import { NotFoundError } from '../errors.ts'
import { rollCheck, rollPlain, systemRoller, type Roller } from '../records/dice.ts'
import { characterKey } from '../records/edit-types.ts'
import type { AgentLink } from './index.ts'

export const ROLL_DICE_TOOL = 'roll_dice'
export const ROLL_CHECK_TOOL = 'roll_check'
export const LIST_CHECKS_TOOL = 'list_checks'

/** The tools that need the dice and nothing else of the story. */
export type DiceLink = Pick<AgentLink, 'turn'> & { session: Pick<AgentLink['session'], 'dice' | 'characters' | 'variables'> }

const sign = (value: number): string => (value >= 0 ? `+${value}` : String(value))

/** How a roll reads to the agent that asked for it: what fell, what it adds up to, and what the world's check makes of it. */
export function describeRoll(roll: DiceRoll, check?: DiceCheck): string {
  const dice = `[${roll.faces.join(', ')}]${roll.kept.length < roll.faces.length ? ` keeping [${roll.kept.join(', ')}]` : ''}`
  const lines = [`Roll ${roll.id}: ${roll.expression}${check === undefined ? '' : ` for the check "${check.name}"`}${roll.character === undefined ? '' : ` (${roll.character})`} - ${dice}${roll.modifier === 0 ? '' : ` ${sign(roll.modifier)}`} = ${roll.total}${check?.reading === 'successes' ? ' successes' : ''}.`]
  if (roll.target !== undefined) lines.push(`Against ${roll.target}: ${roll.value >= 0 ? '+' : ''}${roll.value}.`)
  if (roll.readout !== undefined) lines.push(`That is: ${roll.readout.label}${roll.readout.critical ? ' (critical)' : ''}; the result is ${roll.readout.result}. This is decided by the dice: do not change it, narrate it.${check === undefined || roll.character === undefined ? '' : ` In resolve_round give ${roll.character}'s outcome this result and cite the roll: roll ${roll.id}.`}`)
  return lines.join(' ')
}

export interface CheckRolled {
  roll: number
  check: string
  total: number
  result: 'succeeded' | 'partial' | 'failed'
  label: string
  critical: boolean
  text: string
}

/** Rolls one of the story's checks for a character and records it: the one place that decides what a check roll is, for the tool and for whatever rolls on an agent's behalf. */
export function rollForCheck(link: DiceLink, args: { check: string; reason: string; character: string; target?: number; bonus?: number }, roller: Roller = systemRoller, by: 'agent' | 'player' = 'agent'): CheckRolled {
  const { session, turn } = link
  const check = session.dice.check(args.check)
  if (check === undefined) throw new NotFoundError(`there is no check "${args.check}"; list_checks shows the story's checks`)
  const who = session.characters.list().find(entry => characterKey(entry) === args.character)
  if (who === undefined) throw new NotFoundError(`there is no character "${args.character}"; list_characters shows the keys`)
  let modifier: number | undefined
  if (check.modifier !== undefined) {
    const value = session.variables.value(check.modifier, 'character', who.id)
    if (typeof value !== 'number') throw new NotFoundError(`the character's ${check.modifier} is not a number, so the check cannot add it`)
    modifier = value
  }
  const bonus = Math.max(-10, Math.min(10, args.bonus ?? 0))
  const made = rollCheck(check, { ...(modifier === undefined ? {} : { modifier }), bonus, ...(args.target === undefined ? {} : { target: args.target }) }, roller)
  const roll = session.dice.record({
    turn, check: check.key, expression: check.dice, faces: made.faces, kept: made.kept, modifier: made.modifier, ...(made.target === undefined ? {} : { target: made.target }),
    total: made.total, value: made.value, readout: made.readout, reason: args.reason, character: args.character, by,
  })
  return { roll: roll.id, check: check.key, total: roll.total, result: made.readout.result, label: made.readout.label, critical: made.readout.critical, text: describeRoll(roll, check) }
}

const rolled = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: (value as { text: string }).text }]

/**
 * Tools that roll dice for an agent, so that numbers are not made up. `roll_check` rolls a check the story defines and reads
 * the result with the check's own bands; `roll_dice` rolls plain notation for what has no check. The roller is the system's
 * source of randomness unless one is given.
 */
export function createDiceTools(resolve: (agentSessionId: string) => DiceLink | undefined, options: { roller?: Roller; by?: 'agent' | 'player' } = {}): ToolDefinition[] {
  const roller = options.roller ?? systemRoller
  const linkOf = (agent: { session: { id: string } } | undefined): DiceLink => {
    const found = agent === undefined ? undefined : resolve(agent.session.id)
    if (found === undefined) throw new NotFoundError('this agent is not working in a roleplay session, so there are no dice to roll')
    return found
  }
  return [
    defineTool({
      name: LIST_CHECKS_TOOL,
      description: 'List the checks this story defines for settling uncertain attempts: when each is used, the dice it rolls and how its result is read.',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] },
      isConcurrencySafe: () => true,
      execute(_args, exec) {
        const { session } = linkOf(exec.agent)
        return Promise.resolve(session.dice.checks().map(check => ({ key: check.key, name: check.name, use: check.use, dice: check.dice, compare: check.compare ?? 'absolute', ...(check.modifier === undefined ? {} : { modifier: `the character's ${check.modifier}` }), bands: check.bands.map(band => ({ ...(band.min === undefined ? {} : { from: band.min }), ...(band.max === undefined ? {} : { to: band.max }), label: band.label, result: band.result })) })) as never)
      },
    }),
    defineTool({
      name: ROLL_CHECK_TOOL,
      description: 'Roll one of the story\'s checks for an attempt whose outcome is uncertain and matters: the dice are rolled for you and the result is read with the check\'s own bands, so you never choose or make up a number. Use the check whose "use" fits (list_checks shows them). Roll once per attempt, before you decide what happens, and let the result stand: a failed roll is a failure, whatever the story would like.',
      parameters: {
        check: { type: 'string', required: true, description: 'The key of the check, as list_checks gives it.' },
        reason: { type: 'string', required: true, description: 'What is attempted, by whom, in a sentence.' },
        character: { type: 'string', required: true, description: 'The key of the character the attempt is for (the player\'s character included): the roll is theirs, and their outcome in resolve_round takes its result from it.' },
        target: { type: 'integer', description: 'When the check is read against a target (list_checks says compare over or under): the difficulty, the number the total must meet or beat (or stay under). Set it by how hard the attempt is, using what the check\'s "use" says about difficulty; never 0 to make it easy.' },
        bonus: { type: 'integer', description: 'What the circumstances add to or take from the roll, from -10 to 10; leave out for none.' },
      },
      output: { schema: { type: 'json' }, render: rolled },
      isConcurrencySafe: () => false,
      execute(args, exec) {
        return Promise.resolve(rollForCheck(linkOf(exec.agent), args, roller, options.by) as never)
      },
    }),
    defineTool({
      name: ROLL_DICE_TOOL,
      description: 'Roll dice for something the story has no check for (damage, a random pick, who goes first, a rumour table): the dice are rolled for you, so you never make up a number. Write the notation like 1d6, 2d4+1, 4d6kh3 (keep the highest 3) or d100. What the number means is for you to decide from the rules you were given; when a check fits the attempt, use roll_check instead.',
      parameters: {
        expression: { type: 'string', required: true, description: 'Dice notation, for example 2d6+1.' },
        reason: { type: 'string', required: true, description: 'What the roll is for, in a sentence.' },
        character: { type: 'string', description: 'The key of the character it is for, when it is for one.' },
      },
      output: { schema: { type: 'json' }, render: rolled },
      isConcurrencySafe: () => false,
      execute(args, exec) {
        const { session, turn } = linkOf(exec.agent)
        const made = rollPlain(args.expression, roller)
        const roll = session.dice.record({ turn, expression: made.expression, faces: made.faces, kept: made.kept, modifier: made.modifier, total: made.total, value: made.total, reason: args.reason, ...(args.character === undefined ? {} : { character: args.character }), by: options.by ?? 'agent' })
        return Promise.resolve({ roll: roll.id, total: roll.total, text: describeRoll(roll) } as never)
      },
    }),
  ]
}
