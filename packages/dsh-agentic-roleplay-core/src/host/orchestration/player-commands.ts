import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { rollArguments } from '../../shared/roll.ts'
import { waitArguments } from '../../shared/wait.ts'
import type { StoryCommand } from '../../shared/commands.ts'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { CommandOutcome, CommandSpec } from '../commands/registry.ts'

/** What the player's message of a turn asks for, beyond being the player's move. */
export type PlayerCommand =
  | { kind: 'ooc'; request: string; question: boolean }
  | { kind: 'dream'; who: string }
  | { kind: 'roll'; expression: string; reason: string }
  | { kind: 'wait'; minutes: number; reason: string }
  | { kind: 'world'; word: string }

/** The most commands waiting for their turn to start: a command is taken the moment its message begins a turn, so this is only a bound. */
const MAX_WAITING = 200

/**
 * What each command message was meant to do, by the id of the message the command sent: the turn that message begins takes it. Nothing reads the words of a message to tell a command from a move.
 */
export class PlayerIntents {
  private readonly byMessage = new Map<string, PlayerCommand>()

  intend(messageId: string, command: PlayerCommand): void {
    this.byMessage.set(messageId, command)
    for (const key of this.byMessage.keys()) { if (this.byMessage.size <= MAX_WAITING) break; this.byMessage.delete(key) }
  }

  /** The command of the first of these messages that has one, which is then forgotten. */
  take(messageIds: readonly string[]): PlayerCommand | undefined {
    for (const id of messageIds) {
      const command = this.byMessage.get(id)
      if (command !== undefined) { this.byMessage.delete(id); return command }
    }
    return undefined
  }
}

/** The game master of a roleplay chat: the agent a player's command is for. */
const isGameMaster = (agent: Agent): boolean => agent.session.header.origin !== 'subagent' && roleplaySessionOf(agent.session.id) !== undefined

/** Sends the command to the game master as the player's own message, which is what the turn it begins is the answer to. */
function play(intents: PlayerIntents, agent: Agent, name: string, rawInput: string, command: PlayerCommand): CommandOutcome {
  if (!isGameMaster(agent)) return { kind: 'error', text: `/${name} is played in a roleplay chat` }
  const message = createUserMessage({ content: [{ type: 'text', text: `/${name}${rawInput}` }], source: { kind: 'user' } })
  intents.intend(String(message.id), command)
  agent.followup(message)
  return { kind: 'success' }
}

/** The commands every roleplay chat has: out-of-character commands and questions, dice, time and dreams. */
export function playerCommands(intents: PlayerIntents): CommandSpec[] {
  const ooc = (name: 'ooc' | 'ask', description: string): CommandSpec => ({
    name, description, hint: name === 'ooc' ? '<what to change in the story>' : '<what to ask>', recordInput: false,
    handler: ({ agent, rawInput }) => {
      const request = rawInput.trim()
      if (request === '') return { kind: 'error', text: name === 'ooc' ? 'Say what to change: /ooc <what the story should do>' : 'Say what to ask: /ask <your question>' }
      return play(intents, agent, name, rawInput, { kind: 'ooc', request, question: name === 'ask' })
    },
  })
  return [
    ooc('ooc', 'Give the story an out-of-character instruction, outside what your character does'),
    ooc('ask', 'Ask the story a question out of character; nothing in the story changes'),
    {
      name: 'roll', description: 'Roll dice as yourself: the result is told to the game master as a fact', hint: '<dice, for example 2d6+1> [why]', recordInput: false,
      handler: ({ agent, rawInput }) => {
        const roll = rollArguments(rawInput)
        if (roll.expression === '') return { kind: 'error', text: 'Say what to roll, for example /roll 2d6' }
        return play(intents, agent, 'roll', rawInput, { kind: 'roll', ...roll })
      },
    },
    {
      name: 'wait', description: 'Let time pass in the story', hint: '<how long, for example 2 hours> [until what]', recordInput: false,
      handler: ({ agent, rawInput }) => {
        const wait = waitArguments(rawInput)
        if (wait.minutes === undefined) return { kind: 'error', text: 'Say how long, for example /wait 2 hours or /wait 30 minutes until the ferry' }
        return play(intents, agent, 'wait', rawInput, { kind: 'wait', minutes: wait.minutes, reason: wait.reason })
      },
    },
    {
      name: 'dream', description: 'Enter the dream of a character who is asleep', hint: '[whose dream]', recordInput: false,
      handler: ({ agent, rawInput }) => play(intents, agent, 'dream', rawInput, { kind: 'dream', who: rawInput.trim() }),
    },
  ]
}

/** DSH names a command with lower case ASCII letters, digits, `_` and `-`; a world's word may be in any script, and is then offered under the key of its flag, which is always such a name. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** The commands a world defines, for its chat: each is the player's move in the story, and raises the world's flag for the turn. */
export function worldCommands(intents: PlayerIntents, defined: readonly StoryCommand[]): CommandSpec[] {
  return defined.map((command): CommandSpec => {
    const name = COMMAND_NAME.test(command.word) ? command.word : command.key
    return {
      name,
      description: name === command.word ? command.description : `/${command.word}: ${command.description}`,
      hint: '[what you do]',
      recordInput: false,
      handler: ({ agent, rawInput }) => play(intents, agent, name, rawInput, { kind: 'world', word: command.word }),
    }
  })
}
