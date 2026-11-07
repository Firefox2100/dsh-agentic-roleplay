import type { ImportContext, RunJob } from '../../src/host/import/run.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import type { Language } from './language.ts'

export type DecisionMode = 'llm' | 'decision' | 'hybrid'

export interface LiveOptions {
  /** The language model that judges, as an OpenAI-compatible endpoint. */
  llm: { url: string; model: string; temperature: number; reasoning: string; apiKey?: string }
  /** The embedding model that picks the pairs worth asking about. */
  embed?: { url: string; model: string }
  /** The decision model that answers yes-or-no questions first. */
  decision?: { url: string; model: string; mode: Exclude<DecisionMode, 'llm'>; confidence: number }
  concurrency: number
}

/** What a run asked of the services, for the cost side of the results. */
export interface Counters {
  llmCalls: number
  llmRetries: number
  llmMs: number
  inputTokens: number
  outputTokens: number
  /** Calls whose result is a yes or no: the ones a decision model may answer first. */
  yesNoCalls: number
  decisionCalls: number
  decisionMs: number
  embedCalls: number
  embedTexts: number
  /** Jobs that could not be answered at all. */
  failures: string[]
  /** What each job was asked and answered, when asked for (BENCH_TRACE), to find out why a case came out as it did. */
  jobs: { persona: string; prompt: string; result: unknown }[]
}

export const newCounters = (): Counters => ({ llmCalls: 0, llmRetries: 0, llmMs: 0, inputTokens: 0, outputTokens: 0, yesNoCalls: 0, decisionCalls: 0, decisionMs: 0, embedCalls: 0, embedTexts: 0, failures: [], jobs: [] })

const YES_NO_KEYS = ['same', 'conflict', 'playable', 'covered']
const ATTEMPTS = 3

async function post<T>(url: string, body: unknown, apiKey: string | undefined, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` } }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
  return await response.json() as T
}

interface Completion {
  choices: { message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * The model a judged check asks, built on the endpoints directly so that a benchmark needs no running DSH: a job is one request with a required `submit_result` call, and an
 * answer the job's own check refuses is sent back with the reason, as the product's runner does, up to three times.
 */
export function liveContext(options: LiveOptions, language: Language, counters: Counters): ImportContext {
  const run: RunJob = (async (job: { persona: string; prompt: string; result: unknown; maxTokens?: number; check?: (value: unknown) => string | undefined }) => {
    const properties = (job.result as { properties?: Record<string, unknown> }).properties ?? {}
    if (YES_NO_KEYS.some(key => key in properties)) counters.yesNoCalls += 1
    const messages: unknown[] = [{ role: 'system', content: job.persona }, { role: 'user', content: job.prompt }]
    let last = ''
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const began = Date.now()
      counters.llmCalls += 1
      if (attempt > 1) counters.llmRetries += 1
      const answer = await post<Completion>(`${options.llm.url}/chat/completions`, {
        model: options.llm.model, messages, temperature: options.llm.temperature, max_tokens: Math.max(job.maxTokens ?? 1000, 300),
        tools: [{ type: 'function', function: { name: 'submit_result', description: 'Submit the result.', parameters: job.result } }], tool_choice: 'required',
        ...options.llm.reasoning === '' ? {} : { reasoning_effort: options.llm.reasoning },
      }, options.llm.apiKey, 600_000)
      counters.llmMs += Date.now() - began
      counters.inputTokens += answer.usage?.prompt_tokens ?? 0
      counters.outputTokens += answer.usage?.completion_tokens ?? 0
      const call = answer.choices[0]?.message.tool_calls?.[0]
      let problem: string | undefined
      let value: unknown
      if (call === undefined) problem = 'call submit_result with your result'
      else {
        try { value = JSON.parse(call.function.arguments) } catch { problem = 'the arguments were not valid JSON' }
        if (problem === undefined) problem = job.check?.(value)
      }
      if (problem === undefined) { if (process.env['BENCH_TRACE'] !== undefined) counters.jobs.push({ persona: job.persona.slice(0, 300), prompt: job.prompt.slice(0, 2500), result: value }); return value }
      last = problem
      messages.push(call === undefined ? { role: 'assistant', content: answer.choices[0]?.message.content ?? '' } : { role: 'assistant', content: null, tool_calls: [call] })
      messages.push(call === undefined ? { role: 'user', content: problem } : { role: 'tool', tool_call_id: call.id, content: `Refused: ${problem}` })
    }
    counters.failures.push(last)
    throw new Error(`the result was refused ${ATTEMPTS} times; the last reason: ${last}`)
  }) as never

  const embed: ImportContext['embed'] = options.embed === undefined ? undefined : async (texts) => {
    counters.embedCalls += 1
    counters.embedTexts += texts.length
    const answer = await post<{ data: { embedding: number[]; index: number }[]; model: string }>(`${options.embed!.url}/embeddings`, { model: options.embed!.model, input: texts }, undefined, 300_000)
    return { vectors: [...answer.data].sort((a, b) => a.index - b.index).map(entry => entry.embedding), model: answer.model }
  }

  const decide: ImportContext['decide'] = options.decision === undefined ? undefined : async (state, asks) => {
    const began = Date.now()
    counters.decisionCalls += 1
    const answer = await post<{ answers: Record<string, { noul?: number; noul_raw?: number }> }>(`${options.decision!.url}/systemone`, { model: options.decision!.model, state, questions: Object.fromEntries(asks.map(({ key, instructions }) => [key, { type: 'noul', instructions }])) }, undefined, 120_000)
    counters.decisionMs += Date.now() - began
    return new Map(asks.map(({ key }) => [key, answer.answers[key]!.noul_raw ?? answer.answers[key]!.noul!]))
  }

  return {
    run, concurrency: options.concurrency, text: (id, variables) => shippedText(id, language, variables), language, say: () => undefined,
    ...embed === undefined ? {} : { embed },
    ...decide === undefined || options.decision === undefined ? {} : { decide, confidence: options.decision.confidence },
  }
}

/**
 * A request answered as a constrained reply (`response_format` json_schema), the way the product asks for a list of answers, with a refused or unreadable answer sent back up to three
 * times. For the sites whose answer is a set of keyed verdicts rather than a tool call.
 */
export function liveStructured(options: LiveOptions, counters: Counters): (request: { persona: string; prompt: string; result: unknown }) => Promise<unknown> {
  return async ({ persona, prompt, result }) => {
    const messages: unknown[] = [{ role: 'system', content: persona }, { role: 'user', content: prompt }]
    let last = ''
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const began = Date.now()
      counters.llmCalls += 1
      if (attempt > 1) counters.llmRetries += 1
      const answer = await post<Completion>(`${options.llm.url}/chat/completions`, {
        model: options.llm.model, messages, temperature: options.llm.temperature, max_tokens: 1500,
        response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: result } },
        ...options.llm.reasoning === '' ? {} : { reasoning_effort: options.llm.reasoning },
      }, options.llm.apiKey, 600_000)
      counters.llmMs += Date.now() - began
      counters.inputTokens += answer.usage?.prompt_tokens ?? 0
      counters.outputTokens += answer.usage?.completion_tokens ?? 0
      const content = answer.choices[0]?.message.content ?? ''
      if (process.env['BENCH_TRACE'] !== undefined) counters.jobs.push({ persona: persona.slice(0, 300), prompt: prompt.slice(0, 2500), result: content })
      try { return JSON.parse(content) as unknown } catch { last = `not valid JSON: ${content.slice(0, 120)}` }
      messages.push({ role: 'assistant', content }, { role: 'user', content: 'Answer again with valid JSON only.' })
    }
    counters.failures.push(last)
    throw new Error(`the answer was refused ${ATTEMPTS} times; the last reason: ${last}`)
  }
}

/** The decision model as the product's `DecisionService` presents it, over the endpoint directly. */
export function liveDecisionService(decision: NonNullable<LiveOptions['decision']>, counters: Counters): { decide: (state: Record<string, unknown>, questions: Record<string, { type: 'noul'; instructions: string }>) => Promise<{ answers: Record<string, { type: 'noul'; probability: number }>; model: string }> } {
  return {
    async decide(state, questions) {
      const began = Date.now()
      counters.decisionCalls += 1
      const answer = await post<{ answers: Record<string, { noul?: number; noul_raw?: number }> }>(`${decision.url}/systemone`, { model: decision.model, state, questions }, undefined, 120_000)
      counters.decisionMs += Date.now() - began
      if (process.env['BENCH_TRACE'] !== undefined) counters.jobs.push({ persona: 'decision', prompt: JSON.stringify({ state, questions }).slice(0, 2500), result: Object.fromEntries(Object.keys(questions).map(key => [key, answer.answers[key]!.noul_raw ?? answer.answers[key]!.noul])) })
      return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul' as const, probability: answer.answers[key]!.noul_raw ?? answer.answers[key]!.noul! }])), model: decision.model }
    },
  }
}
