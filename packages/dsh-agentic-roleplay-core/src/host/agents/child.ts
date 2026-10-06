import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides, applyChildComposition, captureDelegatedPolicyOverrides, childSessionMeta,
  resolveChildAgentOptions, resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import { ToolArgsError, validateJsonSchemaValue, type ObjectJsonSchema, type ToolDefinition } from '@deepseek-ai/dsh-tools'

/** The tool every child ends with: its arguments are the child's result. */
export const SUBMIT_TOOL = 'submit_result'

/** Said to every child once, after its persona, so it is the same for all of them and the start of every request stays the same. */
const SUBMIT_RULE = `When you are done, call ${SUBMIT_TOOL} with your result. It is the only way to finish: text you write instead is lost.`

/** Calls a child may make before it is given up; a child that keeps going is not converging. */
const DEFAULT_MAX_CALLS = 40

/** A child that stops without a result is told to submit this many times before it is given up. */
const MAX_REMINDERS = 2
/** A child that goes on calling tools this many times past its budget, in spite of being told to submit, is stopped: it would otherwise loop for as long as the model keeps at it. */
const OVERRUN = 5
/** The same call, with the same arguments, that failed before is refused after this many repeats, and the child is stopped at twice that: the model is not reading the reasons it was given. */
const REPEATS_TOLD = 1
const REPEATS_STOPPED = 4

/** A one-shot agent of the game master, with tools of its own. */
export interface ChildTask {
  /** The agent the child works for; the child runs on its model and inside its preset. */
  parent: Agent
  signal: AbortSignal
  /** Who the child is and the rules it follows. Keep it the same from run to run: it is the start of every request, so the provider's cache holds. */
  persona: string
  /** What is asked this time. Only what differs from run to run belongs here. */
  prompt: string
  /**
   * Tools only this child has. They are registered on the child's own scope, so a tool
   * built around one character's memory gives another child, running at the same time,
   * nothing of it. DSH's own global tools are hidden from the child.
   */
  tools?: readonly ToolDefinition[]
  /** The shape of the result; the child ends by calling `submit_result` with it. */
  result: ObjectJsonSchema
  /** Refuses the result with a reason when the child may not finish yet; the child then carries on. */
  beforeSubmit?: (result: unknown) => string | undefined
  maxCalls?: number
  /** How hard the child thinks, as a level the model offers (for example `off` or `low`); the game master's own level when absent. */
  reasoningEffort?: string
}

/**
 * Run a child agent to its result. Unlike a sub-agent started through `ctx.subagents`, it can
 * have tools of its own, so several can run side by side with different tools and different
 * results from the same tool.
 *
 * This is the one place the bundle builds an agent below DSH's sub-agent API: it uses the
 * composition helpers DSH exports for sub-agent providers (`applyChildComposition`,
 * `childSessionMeta`, ...). They are not a stable interface; `docs/dsh-api-usage.md` says why
 * this is accepted, which DSH version it is built against, and what to do when DSH changes.
 * @throws {Error} when the child is cancelled, stops without a result, or exceeds its calls.
 */
export async function runChild<T>(task: ChildTask): Promise<T> {
  const { parent, signal } = task
  let submitted: { value: unknown } | undefined
  let calls = 0
  let reminders = 0
  let stopped: (() => void) | undefined
  let overran = false
  let previous: { name: string; args: string; failed: boolean; repeats: number } | undefined
  const budget = task.maxCalls ?? DEFAULT_MAX_CALLS
  const counted = (tool: ToolDefinition): ToolDefinition => ({
    ...tool,
    execute: async (args, exec) => {
      calls += 1
      if (calls > budget + OVERRUN) {
        overran = true
        stopped?.()
      }
      if (calls > budget) throw new Error(`you have made ${budget} calls: submit your result now and say what is still missing`)
      const signature = JSON.stringify(args)
      const repeats = previous?.name === tool.name && previous.args === signature && previous.failed ? previous.repeats + 1 : 0
      if (repeats >= REPEATS_STOPPED) {
        overran = true
        stopped?.()
      }
      if (repeats >= REPEATS_TOLD) {
        previous = { name: tool.name, args: signature, failed: true, repeats }
        throw new Error('this is exactly the call that just failed, with the same arguments, so it fails for the same reasons: read the reasons the last result gave and change the arguments to fix every one of them')
      }
      previous = { name: tool.name, args: signature, failed: false, repeats }
      try {
        return await tool.execute(args, exec)
      } catch (error) {
        if (previous !== undefined) previous.failed = true
        throw error
      }
    },
  })
  const submit: ToolDefinition = {
    name: SUBMIT_TOOL,
    description: 'Submit your final result. Call it exactly once, when you are done; the arguments are the result.',
    parameters: task.result as unknown as Record<string, unknown>,
    output: { schema: { type: 'object', properties: { recorded: { type: 'boolean', const: true } }, required: ['recorded'], additionalProperties: false }, render: () => [{ type: 'text', text: 'Result recorded.' }] },
    execute(args, exec) {
      const violations = validateJsonSchemaValue(task.result, args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      const refusal = task.beforeSubmit?.(args)
      if (refusal !== undefined) throw new Error(refusal)
      submitted = { value: args }
      exec.concludeTurn()
      return Promise.resolve({ recorded: true })
    },
  }

  const depth = resolveChildDepth(parent, undefined)
  const inherited = captureDelegatedPolicyOverrides(parent)
  const handle = await parent.ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    parentAgent: parent,
    meta: childSessionMeta(parent, depth, false),
    agentOptions: resolveChildAgentOptions(parent, task.reasoningEffort === undefined || task.reasoningEffort === '' ? undefined : { reasoningEffort: ReasoningEffortId(task.reasoningEffort) }, depth),
    signal,
    setup: (childCtx, child) => {
      appendDelegatedPolicyOverrides(child.session, inherited)
      applyChildComposition(childCtx, parent, { persona: `${task.persona}\n\n${SUBMIT_RULE}`, toolFilter: { allow: [] } })
      for (const tool of task.tools ?? []) childCtx.tools.register(counted(tool))
      childCtx.tools.register(submit)
      childCtx.on('agent/turn-stopping', () => {
        if (submitted !== undefined || reminders >= MAX_REMINDERS) return
        reminders += 1
        child.steer(createUserMessage({ content: [{ type: 'text', text: `You have not finished: call ${SUBMIT_TOOL} with your result, as the tool lists it.` }], source: { kind: 'roleplay' } }))
      })
      childCtx.tools.guard(exec => (submitted === undefined ? undefined : `the result is already submitted, so \`${exec.name}\` is not run`))
    },
  })
  stopped = () => { handle.agent.cancel({ kind: 'parent' }) }
  const onAbort = (): void => { handle.agent.cancel({ kind: 'parent' }) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task.prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
  } finally {
    signal.removeEventListener('abort', onAbort)
    await handle.dispose()
  }
  if (signal.aborted) throw new Error('cancelled')
  if (overran && submitted === undefined) throw new Error(`the agent went on past its ${budget} calls, or kept repeating a call that failed, without submitting a result and was stopped`)
  if (submitted === undefined) throw new Error(`the agent stopped without submitting a result (${calls} call(s))`)
  return submitted.value as T
}
