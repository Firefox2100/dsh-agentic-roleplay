import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { outputBudget } from './budget.ts'
import { randomUUID } from 'node:crypto'
import { MAX_RUN_CALLS, MAX_RUN_PROMPT, MAX_RUN_TEXT, type ActivityEntry, type RunCall, type RunDetail } from '../../shared/activity.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId, type ImageBlock } from '@deepseek-ai/dsh-llm'
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
/** Steps a child gets to submit once its other tools are withdrawn: a model that keeps calling tools that are gone is stopped. */
const STEPS_AFTER_RETIRE = 3

/** The same call, with the same arguments, that failed before is refused after this many repeats, and the child is stopped at twice that: the model is not reading the reasons it was given. */
const REPEATS_TOLD = 1
const REPEATS_STOPPED = 4
/** A result that is refused this many times is not going to be fixed by asking again: the child is stopped and the caller decides what to do without it. */
const MAX_REFUSALS = 5

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
  /** Tools other plugins registered for everyone (a file or shell tool, an MCP server's) that this child may use, by name; the child has none of them otherwise. Names not registered now are left out. */
  external?: readonly string[]
  /** Images the child is shown with the prompt, saved through the attachment service. The model must be able to read images. */
  images?: readonly ImageBlock['attachment'][]
  /** The shape of the result; the child ends by calling `submit_result` with it. */
  result: ObjectJsonSchema
  /** Fields the model is asked for as required (so an engine that writes required fields first, in order, writes them first) but whose absence is not refused. */
  unenforced?: readonly string[]
  /** Refuses the result with a reason when the child may not finish yet; the child then carries on. */
  beforeSubmit?: (result: unknown) => string | undefined
  maxCalls?: number
  /** The model the child runs on, when it is not the parent's. */
  model?: { provider: string; model: string }
  /** How hard the child thinks, as a level the model offers (for example `off` or `low`); the game master's own level when absent. */
  reasoningEffort?: string
  /** The most tokens one model request of the child may produce; the model's own limit when absent. A child that rambles instead of answering is cut off, not waited for. */
  maxTokens?: number
  /** How the model is asked: how freely it writes, and whether it must answer with a tool call. Applied by the language model service that serves the child. */
  sampling?: ChildSampling
  /** Told how the run went when it ends, however it ends. */
  trace?: (run: ChildRun) => void
}

/** How one run of a child went, for the record of what the helpers did. */
export interface ChildRun {
  /** Wall-clock milliseconds the run took. */
  ms: number
  /** Tool calls the child made, `submit_result` included. */
  calls: number
  /** The error message when the run did not end with a result. */
  error?: string
  /** What the child was told and did. */
  detail: RunDetail
}

/** The controls of a child's model requests that the plugin decides; the service that serves the route applies them. */
export interface ChildSampling {
  temperature?: number
  toolChoice?: 'auto' | 'required'
  /** The most tokens one request may produce; used when the task sets none of its own. */
  maxTokens?: number
  /** Where the request stands when the model is busy: what the player waits for in the turn (the characters, a thing made up on the spot) goes first, the records and the suggestions after. */
  priority?: 'foreground' | 'background'
}

export type ChildKind = 'characters' | 'suggestions' | 'authoring' | 'records'

/**
 * What the settings of a chat say about how a kind of helper is asked: prose is free, the keepers of records exact. A helper whose answer has a declared size (its `estimate`, in tokens)
 * is let produce that with room to spare, no more than the chat's ceiling for its kind.
 */
export function childSampling(settings: { sampling: Record<ChildKind, number> & { tools: 'auto' | 'required'; maxTokens: number; shortMaxTokens: number; headroom: number } }, kind: ChildKind, estimate?: number): ChildSampling {
  const ceiling = kind === 'characters' || kind === 'suggestions' ? settings.sampling.shortMaxTokens : settings.sampling.maxTokens
  return { temperature: settings.sampling[kind], toolChoice: settings.sampling.tools, maxTokens: estimate === undefined ? ceiling : Math.min(ceiling, outputBudget(estimate, settings.sampling.headroom)), priority: kind === 'characters' || kind === 'authoring' ? 'foreground' : 'background' }
}

/** What a caller passes as `trace`: files each run of a kind of helper under a label in the store's record of activity, with its detail when the chat keeps it. */
export function childTrace(store: { settings(): { models: Record<ChildKind, string>; diagnostics: { keepRuns: boolean } }; recordActivity(entry: ActivityEntry, detail?: RunDetail): void }, kind: ChildKind, label: string, extra: Pick<RunDetail, 'recalled'> = {}, named?: string): NonNullable<ChildTask['trace']> {
  const model = (named ?? store.settings().models[kind]).trim()
  return (run) => {
    const keep = store.settings().diagnostics.keepRuns
    const id = keep ? randomUUID() : undefined
    store.recordActivity({ at: Date.now(), label, model, ms: run.ms, calls: run.calls, ...(run.error === undefined ? {} : { error: run.error.slice(0, 300) }), ...(id === undefined ? {} : { run: id }) }, keep ? { ...run.detail, ...extra } : undefined)
  }
}

/** The `model` the settings give a kind of helper, to spread into its task; nothing when it runs on the chat's own model. */
export function childModel(settings: { models: Record<ChildKind, string> }, kind: ChildKind, override?: string): Pick<ChildTask, 'model'> {
  const named = (override ?? settings.models[kind]).trim()
  if (named === '') return {}
  const slash = named.indexOf('/')
  return { model: { provider: named.slice(0, slash), model: named.slice(slash + 1) } }
}

const samplings = new Map<string, ChildSampling>()

/** The controls set for a running child, by its session id. */
export const childSamplingOf = (sessionId: string): ChildSampling | undefined => samplings.get(sessionId)

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
function childOptions(task: Pick<ChildTask, 'reasoningEffort' | 'maxTokens' | 'sampling' | 'model'>): AgentOptions | undefined {
  const maxTokens = task.maxTokens ?? task.sampling?.maxTokens
  const options = {
    ...(task.reasoningEffort === undefined || task.reasoningEffort === '' ? {} : { reasoningEffort: ReasoningEffortId(task.reasoningEffort) }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(task.model === undefined ? {} : { provider: task.model.provider, model: task.model.model }),
  }
  return Object.keys(options).length === 0 ? undefined : options
}

/** The schema an answer is checked against: the one the model was given, without requiring what it was only asked for ({@link ChildTask.unenforced}). */
export function enforcedSchema(task: Pick<ChildTask, 'result' | 'unenforced'>): ObjectJsonSchema {
  const skipped = task.unenforced ?? []
  return skipped.length === 0 || task.result.required === undefined ? task.result : { ...task.result, required: task.result.required.filter(name => !skipped.includes(name)) }
}

/** A model that is cut off in the middle of its tool call leaves an unfinished argument no one can read; asking again usually gives a whole one. */
export const isUnfinishedCall = (error: unknown): boolean => error instanceof Error && /parse tool call arguments|unfinished tool call/i.test(error.message)

export async function runChild<T>(task: ChildTask): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const began = Date.now()
    const stats: RunStats = { calls: 0, record: [] }
    const detail = (): RunDetail => ({ persona: task.persona.slice(0, MAX_RUN_PROMPT), prompt: task.prompt.slice(0, MAX_RUN_PROMPT), calls: stats.record, ...(stats.result === undefined ? {} : { result: stats.result }) })
    try {
      const result = await execute<T>(task, stats)
      task.trace?.({ ms: Date.now() - began, calls: stats.calls, detail: detail() })
      return result
    } catch (error) {
      task.trace?.({ ms: Date.now() - began, calls: stats.calls, error: error instanceof Error ? error.message : String(error), detail: detail() })
      if (attempt >= 2 || task.signal.aborted || !isUnfinishedCall(error)) throw error
    }
  }
}

/**
 * The thinking level a child may be given on its model: the one asked for when the model offers it, none when it does not (a model chosen for a
 * helper has its own levels, and one that lacks the level the chat asks for would refuse the request).
 */
export async function supportedEffort(task: Pick<ChildTask, 'parent' | 'signal' | 'model' | 'reasoningEffort'>): Promise<string | undefined> {
  const level = task.reasoningEffort
  if (level === undefined || level === '' || task.model === undefined) return level
  try {
    const info = await task.parent.ctx.llm.resolveModelInfo(task.model.provider, task.model.model, task.signal)
    return info.reasoning?.efforts.some(effort => effort.id === level) === true ? level : undefined
  } catch { return level }
}

/** What one run counts and keeps for its trace. */
interface RunStats { calls: number; record: RunCall[]; result?: string }

const cut = (value: unknown, limit = MAX_RUN_TEXT): string => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  return text.length > limit ? `${text.slice(0, limit)} ... (${text.length - limit} more characters)` : text
}

async function execute<T>(task: ChildTask, stats: RunStats): Promise<T> {
  const { parent, signal } = task
  const reasoningEffort = await supportedEffort(task)
  let submitted: { value: unknown } | undefined
  let reminders = 0
  let stopped: (() => void) | undefined
  let retire: (() => void) | undefined
  let stepsAfterRetire = -1
  let overran = false
  let refusals = 0
  let lastRefusal = ''
  let previous: { name: string; args: string; failed: boolean; repeats: number } | undefined
  const budget = task.maxCalls ?? DEFAULT_MAX_CALLS
  const counted = (tool: ToolDefinition): ToolDefinition => ({
    ...tool,
    execute: async (args, exec) => {
      stats.calls += 1
      const note = (outcome: unknown, failed: boolean): void => { if (stats.record.length < MAX_RUN_CALLS) stats.record.push({ tool: tool.name, args: cut(args), outcome: cut(outcome), failed }) }
      if (stats.calls > budget + OVERRUN) {
        overran = true
        stopped?.()
      }
      if (stats.calls > budget) { const message = `you have made ${budget} calls: submit your result now and say what is still missing`; note(message, true); throw new Error(message) }
      const signature = JSON.stringify(args)
      const repeats = previous?.name === tool.name && previous.args === signature && previous.failed ? previous.repeats + 1 : 0
      if (repeats >= REPEATS_STOPPED) {
        overran = true
        stopped?.()
      }
      if (repeats >= REPEATS_TOLD) {
        previous = { name: tool.name, args: signature, failed: true, repeats }
        const message = 'this is exactly the call that just failed, with the same arguments, so it fails for the same reasons: read the reasons the last result gave and change the arguments to fix every one of them'
        note(message, true)
        throw new Error(message)
      }
      previous = { name: tool.name, args: signature, failed: false, repeats }
      try {
        const outcome = await tool.execute(args, exec)
        note(outcome, false)
        return outcome
      } catch (error) {
        if (previous !== undefined) previous.failed = true
        note(error instanceof Error ? error.message : String(error), true)
        throw error
      } finally {
        // with a call required at every step, a model that is out of calls but still has tools picks one again; with only the submit tool left it can only submit
        if (stats.calls >= budget) retire?.()
      }
    },
  })
  const submit: ToolDefinition = {
    name: SUBMIT_TOOL,
    description: 'Submit your final result. Call it exactly once, when you are done; the arguments are the result.',
    parameters: task.result as unknown as Record<string, unknown>,
    output: { schema: { type: 'object', properties: { recorded: { type: 'boolean', const: true } }, required: ['recorded'], additionalProperties: false }, render: () => [{ type: 'text', text: 'Result recorded.' }] },
    execute(args, exec) {
      const violations = validateJsonSchemaValue(enforcedSchema(task), args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      const refusal = task.beforeSubmit?.(args)
      if (refusal !== undefined) {
        if (stats.record.length < MAX_RUN_CALLS) stats.record.push({ tool: SUBMIT_TOOL, args: cut(args), outcome: cut(refusal), failed: true })
        refusals += 1
        lastRefusal = refusal
        if (refusals >= MAX_REFUSALS) { overran = true; stopped?.() }
        throw new Error(refusal)
      }
      submitted = { value: args }
      stats.result = cut(args, MAX_RUN_PROMPT)
      if (stats.record.length < MAX_RUN_CALLS) stats.record.push({ tool: SUBMIT_TOOL, args: cut(args), outcome: 'Result recorded.', failed: false })
      exec.concludeTurn()
      return Promise.resolve({ recorded: true })
    },
  }

  const depth = resolveChildDepth(parent, undefined)
  const inherited = captureDelegatedPolicyOverrides(parent)
  const sessionId = SessionId(randomUUID())
  if (task.sampling !== undefined) samplings.set(sessionId, task.sampling)
  const handle = await parent.ctx.agents.create({
    sessionId,
    parentAgent: parent,
    meta: childSessionMeta(parent, depth, false),
    agentOptions: resolveChildAgentOptions(parent, childOptions({ ...task, ...(reasoningEffort === undefined ? { reasoningEffort: '' } : { reasoningEffort }) }), depth),
    signal,
    setup: (childCtx, child) => {
      appendDelegatedPolicyOverrides(child.session, inherited)
      applyChildComposition(childCtx, parent, { persona: `${task.persona}\n\n${SUBMIT_RULE}`, toolFilter: { allow: [...(task.external ?? [])] } })
      const registered = (task.tools ?? []).map(tool => childCtx.tools.register(counted(tool)))
      retire = () => {
        for (const dispose of registered) dispose()
        if (stepsAfterRetire < 0) stepsAfterRetire = 0
      }
      childCtx.on('agent/pre-step', async (_payload, next) => {
        const decision = await next()
        if (stepsAfterRetire < 0) return decision
        stepsAfterRetire += 1
        if (stepsAfterRetire > STEPS_AFTER_RETIRE && submitted === undefined) { overran = true; stopped?.() }
        return decision
      })
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
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task.prompt }, ...(task.images ?? []).map((attachment): ImageBlock => ({ type: 'image', attachment }))], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
  } finally {
    signal.removeEventListener('abort', onAbort)
    samplings.delete(sessionId)
    await handle.dispose()
  }
  if (signal.aborted) throw new Error('cancelled')
  if (overran && submitted === undefined) throw new Error(refusals >= MAX_REFUSALS ? `the result was refused ${refusals} times and the agent was stopped; the last reason: ${lastRefusal}` : `the agent went on past its ${budget} calls, or kept repeating a call that failed, without submitting a result and was stopped`)
  if (submitted === undefined) {
    const ended = handle.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    const reason = ended?.type === 'turn/end' ? ended.data.reason : undefined
    if (reason?.kind === 'error') throw new Error(`the agent failed: ${reason.error.message}`)
    throw new Error(`the agent stopped without submitting a result (${stats.calls} call(s))`)
  }
  return submitted.value as T
}
