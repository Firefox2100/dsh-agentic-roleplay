import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The trace of one live run: everything the run asked of a model and was answered, in order, with the state the run was in, written as it happens (one JSON object a line) so that a failure
 * that cannot be repeated is still on disk, and so that a score can be worked out again later from what was recorded instead of from a model.
 *
 * Kinds of event: `request` (the body sent to a model, whole), `response` (what came back, whole, and how long it took), `error` (a request that failed), `refusal` (an answer the job's own
 * check sent back, with the reason), `result` (the answer a job accepted), `state` (a named snapshot of the run: the world a row made, the classification, a story's records), `expect`
 * (one expectation, with whether it held and what was found) and `note`. Keys and headers are never written.
 */
export interface TraceHeader {
  /** What ran: the benchmark, the case or row, the language, the repeat. */
  id: string
  label: string
  language?: string
  run?: number
  /** The models and sampling the run used. */
  options?: unknown
  /** A hash of the data the row was made from, so a rerun after an edit is not mistaken for the same run. */
  data?: string
}

export class Trace {
  readonly file: string | undefined
  private readonly began = Date.now()

  private constructor(file: string | undefined, header?: TraceHeader) {
    this.file = file
    if (file !== undefined && header !== undefined) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${JSON.stringify({ t: 0, kind: 'header', at: new Date(this.began).toISOString(), ...header })}\n`)
    }
  }

  /** A trace that writes nothing: what a run has when tracing is off. */
  static readonly off: Trace = new Trace(undefined)

  /** Opens `<dir>/<name>.jsonl`, replacing one that is there. */
  static open(dir: string, name: string, header: TraceHeader): Trace {
    return new Trace(join(dir, `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}.jsonl`), header)
  }

  event(kind: string, data: Record<string, unknown> = {}): void {
    if (this.file === undefined) return
    appendFileSync(this.file, `${JSON.stringify({ t: Date.now() - this.began, kind, ...data })}\n`)
  }

  /** A named snapshot of what the run is in at this point; the value is written as it is. */
  state(name: string, value: unknown): void { this.event('state', { name, value }) }

  /** One expectation: whether it held, and what was found where it did not. */
  expect(name: string, held: boolean, found?: unknown): void { this.event('expect', { name, held, ...found === undefined ? {} : { found } }) }

  note(text: string): void { this.event('note', { text }) }
}

/** Where traces go: the folder named by `BENCH_TRACE_DIR`, else `<out>/traces/<label>`; none when `BENCH_TRACE=0`. A live run is traced unless that is said. */
export function traceFolder(out: string, label: string): string | undefined {
  if (process.env['BENCH_TRACE'] === '0') return undefined
  return process.env['BENCH_TRACE_DIR'] ?? join(out, 'traces', label)
}

/** The trace of one run, or the one that writes nothing. */
export function openTrace(folder: string | undefined, name: string, header: TraceHeader): Trace {
  return folder === undefined ? Trace.off : Trace.open(folder, name, header)
}

export interface TraceLine {
  t: number
  kind: string
  [key: string]: unknown
}

/** The events of a trace file, in order. */
export function readTrace(text: string): TraceLine[] {
  return text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as TraceLine)
}

/** What identifies a job whatever run asks it: who the model was told to be, what it was asked, and the shape of the answer. */
export const jobKey = (persona: string, prompt: string, schema: unknown): string => createHash('sha256').update(JSON.stringify([persona, prompt, schema])).digest('hex').slice(0, 16)

/** The answers a trace recorded, by job, in the order they were given (a job asked twice gets two). A job that failed is recorded as its error. */
export function recordedAnswers(events: readonly TraceLine[]): Map<string, ({ value: unknown } | { error: string })[]> {
  const answers = new Map<string, ({ value: unknown } | { error: string })[]>()
  let open: string | undefined
  for (const event of events) {
    if (event.kind === 'job') { open = String(event['key']); continue }
    if (open === undefined) continue
    if (event.kind === 'result') { answers.set(open, [...answers.get(open) ?? [], { value: event['value'] }]); open = undefined }
    else if (event.kind === 'error' && event['service'] === 'job') { answers.set(open, [...answers.get(open) ?? [], { error: String(event['message']) }]); open = undefined }
  }
  return answers
}

/** A model that answers from a trace: the same job gets the answer it got when it was recorded, so a run can be scored again, or the code under test changed, without a model. */
export function replayer(events: readonly TraceLine[]): (persona: string, prompt: string, schema: unknown) => unknown {
  const answers = recordedAnswers(events)
  const used = new Map<string, number>()
  return (persona, prompt, schema) => {
    const key = jobKey(persona, prompt, schema)
    const index = used.get(key) ?? 0
    used.set(key, index + 1)
    const answer = answers.get(key)?.[index] ?? answers.get(key)?.at(-1)
    if (answer === undefined) throw new Error(`the trace has no answer for the job ${key}: ${prompt.slice(0, 80)}`)
    if ('error' in answer) throw new Error(`the recorded job failed: ${answer.error}`)
    return answer.value
  }
}

/** What is wrong with a trace as a record: no header, a request nobody answered, a job with no outcome. A trace with none can be trusted to show what happened. */
export function auditTrace(events: readonly TraceLine[]): string[] {
  const problems: string[] = []
  if (events[0]?.kind !== 'header') problems.push('the trace does not begin with its header')
  let requests = 0
  let answered = 0
  let jobs = 0
  let outcomes = 0
  for (const event of events) {
    if (event.kind === 'request') requests += 1
    if (event.kind === 'response' || (event.kind === 'error' && event['service'] !== 'job')) answered += 1
    if (event.kind === 'job') jobs += 1
    if (event.kind === 'result' || (event.kind === 'error' && event['service'] === 'job')) outcomes += 1
  }
  if (requests !== answered) problems.push(`${requests} requests but ${answered} answers or errors`)
  if (jobs !== outcomes) problems.push(`${jobs} jobs but ${outcomes} results or failures`)
  return problems
}
