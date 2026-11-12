import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandResult, CommandRuntime } from '@deepseek-ai/dsh-commands'

/** What a command's handler is given: the agent that received it and everything typed after its name (separator included). */
export interface CommandCall {
  agent: Agent
  rawInput: string
  signal: AbortSignal
}

export type CommandOutcome = CommandResult

/** A human command of DSH's interface: listed and completed in the input box, and run by the handler instead of being sent to the model. */
export interface CommandSpec {
  /** Lower case, letters, digits, `_` and `-`, without the slash. */
  name: string
  description: string
  /** What the input box shows after the name while nothing has been typed after it. */
  hint: string
  /** Whether the log keeps what was typed after the name; false when a record of the command's own already holds it. */
  recordInput?: boolean
  handler: (call: CommandCall) => CommandOutcome | Promise<CommandOutcome>
}

/**
 * Registers the commands of the plugin's scope with DSH while the registry exists: they are listed, completed and run by the interface, and a command is not sent to the model.
 * A plugin mounted by an agent preset registers them for that preset's agents only.
 */
export function registerCommands(ctx: Context, specs: readonly CommandSpec[]): void {
  ctx.inject(['commands'], (scope) => {
    for (const spec of specs) {
      scope.effect(() => scope.commands.register({
        name: spec.name,
        description: spec.description,
        input: { hint: spec.hint },
        ...(spec.recordInput === undefined ? {} : { recordInput: spec.recordInput }),
        handler: call => spec.handler(call),
      } satisfies CommandDefinition), `roleplay: /${spec.name}`)
    }
  })
}

/** The registry of the running profile, or nothing when it has none. */
export const registryOf = (ctx: Context): CommandRuntime | undefined => ctx.get('commands')

/**
 * Runs a line the way the input box does when the agent knows the command it starts, for callers that are not the input box (the plugin's own starts, the HTTP API, the benchmark).
 * Nothing when the line is no command of this agent; the caller then sends it on as a message.
 */
export async function runCommandLine(ctx: Context, agent: Agent, line: string, signal: AbortSignal): Promise<CommandOutcome | undefined> {
  const registry = registryOf(ctx)
  if (registry === undefined) return undefined
  return (await registry.execute(agent, line, [], signal))?.result
}

/** A command that was run from outside the input box and refused: what it says is for the person. */
export class CommandRefusedError extends Error {}

/**
 * Registers commands for one agent only, through the agent's own context: they are listed and run for that chat and for no other, and go with the agent. For commands that depend on
 * what the chat holds (the commands a world defines).
 */
export function registerAgentCommands(agent: Agent, specs: readonly CommandSpec[]): void {
  if (specs.length === 0) return
  agent.ctx.inject(['commands'], (scope) => {
    for (const spec of specs) {
      scope.effect(() => scope.commands.register({
        name: spec.name,
        description: spec.description,
        input: { hint: spec.hint },
        ...(spec.recordInput === undefined ? {} : { recordInput: spec.recordInput }),
        handler: call => spec.handler(call),
      } satisfies CommandDefinition), `roleplay: /${spec.name}`)
    }
  })
}
