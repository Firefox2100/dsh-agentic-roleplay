import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** One row of a DSH session log. */
export interface LogRow {
  type: string
  time?: number
  data?: Record<string, unknown>
}

/** What one helper (a character, the record keeper, the world author, a suggester ...) did, from its own session log: the whole story of one run, for finding why it failed. */
export interface HelperRun {
  id: string
  model?: string
  effort?: string
  maxTokens?: number
  tools: string[]
  /** The first words of its instructions: what kind of helper it was. */
  role: string
  persona: string
  brief: string
  /** Everything it said, in order: text, thinking and the calls it made with their results. */
  steps: { kind: 'text' | 'thinking' | 'call' | 'result'; text: string; name?: string; error?: boolean }[]
  /** How its last turn ended: `completed`, `never finished` (still running when the story was removed) or the reason it did not complete. */
  ended: string
  /** Whether it handed back a result (`submit_result` was called and accepted). */
  submitted: boolean
  refusals: number
  ms: number
  /** A sentence on what went wrong, when something did. */
  problem?: string
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {})
const textOf = (content: unknown): string => (Array.isArray(content) ? content.map(part => String(record(part)['text'] ?? '')).join('') : '')

/** The log of a session file, decoded; `zstd` reads the frames that Node does not. */
export function readLog(file: string): LogRow[] {
  return execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as LogRow)
}

/** The ids of the helpers a session started, in order. */
export const childIds = (rows: readonly LogRow[]): string[] => rows.flatMap(row => (row.type === 'subagent/catalog' && typeof row.data?.['childId'] === 'string' ? [row.data['childId']] : []))

/** One helper run, from its log. */
export function summariseHelper(id: string, rows: readonly LogRow[]): HelperRun {
  const header = record(record(rows.find(row => row.type === 'request/header')?.data)['header'])
  const config = record(header['config'])
  const descriptor = record(rows.find(row => row.type === 'subagent/descriptor')?.data)
  const system = textOf(record(record(rows.find(row => row.type === 'system/message')?.data)['message'])['content'])
  const brief = textOf(rows.find(row => row.type === 'user/message')?.data?.['content'])
  const steps: HelperRun['steps'] = []
  let refusals = 0
  let submitted = false
  const pending = new Map<string, string>()
  for (const row of rows) {
    const data = record(row.data)
    if (row.type === 'assistant/message') {
      for (const part of Array.isArray(record(data['message'])['content']) ? record(data['message'])['content'] as unknown[] : []) {
        const entry = record(part)
        if (entry['type'] === 'reasoning') steps.push({ kind: 'thinking', text: String(entry['text'] ?? '') })
        else if (entry['type'] === 'text') steps.push({ kind: 'text', text: String(entry['text'] ?? '') })
      }
    } else if (row.type === 'tool/call') {
      const name = String(data['name'] ?? '')
      pending.set(String(data['callId']), name)
      steps.push({ kind: 'call', name, text: typeof data['arguments'] === 'string' ? data['arguments'] : JSON.stringify(data['arguments']) })
    } else if (row.type === 'tool/result') {
      const message = record(data['message'])
      const name = pending.get(String(message['toolCallId']))
      const error = message['isError'] === true
      if (error) refusals += 1
      else if (name === 'submit_result') submitted = true
      steps.push({ kind: 'result', ...name === undefined ? {} : { name }, error, text: textOf(message['content']) })
    }
  }
  const last = [...rows].reverse().find(row => row.type === 'turn/end')
  const reason = record(record(last?.data)['reason'])
  const ended = last === undefined ? 'never finished' : String(reason['kind'] ?? 'unknown')
  const times = rows.flatMap(row => (typeof row.time === 'number' && row.time > 0 ? [row.time] : []))
  const tools = (Array.isArray(header['tools']) ? header['tools'] as unknown[] : []).map(tool => String(record(tool)['name'] ?? ''))
  // a helper whose tools have no `submit_result` answers with a constrained reply: its last text is the result
  const structured = !tools.includes('submit_result')
  const problem = ended === 'never finished' ? undefined : ended !== 'completed' ? `ended: ${ended}` : !submitted && !structured ? 'finished without handing back a result' : undefined
  return {
    id, ...typeof config['model'] === 'string' ? { model: config['model'] } : typeof descriptor['agentModel'] === 'string' ? { model: descriptor['agentModel'] } : {},
    ...typeof config['reasoningEffort'] === 'string' ? { effort: config['reasoningEffort'] } : {},
    ...typeof config['maxTokens'] === 'number' ? { maxTokens: config['maxTokens'] } : {},
    tools, role: system.replace(/^You are an AI agent powered by DeepSeek Harness\.\s*/, '').split(/\n/)[0]!.slice(0, 120), persona: system, brief, steps, ended, submitted, refusals,
    ms: times.length < 2 ? 0 : Math.max(...times) - Math.min(...times), ...problem === undefined ? {} : { problem },
  }
}

/** Where a session's folder is, whichever project it is filed under. */
export function findSessionLog(sessionsBase: string, id: string): string | undefined {
  if (!existsSync(sessionsBase)) return undefined
  for (const folder of readdirSync(sessionsBase)) {
    const file = join(sessionsBase, folder, id, 'session.v4.jsonl.zstd')
    if (existsSync(file)) return file
  }
  return undefined
}

/** Every helper the chat started: summarised, and each raw log copied to `keepTo` when given. */
export function collectHelpers(chatRows: readonly LogRow[], sessionsBase: string, keepTo?: string): HelperRun[] {
  const runs: HelperRun[] = []
  for (const id of childIds(chatRows)) {
    const file = findSessionLog(sessionsBase, id)
    if (file === undefined) continue
    runs.push(summariseHelper(id, readLog(file)))
    if (keepTo !== undefined) { mkdirSync(keepTo, { recursive: true }); copyFileSync(file, join(keepTo, `${id}.jsonl.zstd`)) }
  }
  return runs
}

/** What the helpers of a run add up to, for the results file. */
export function helperTotals(runs: readonly HelperRun[]): { count: number; failed: number; refusals: number; byRole: Record<string, { count: number; failed: number }> } {
  const byRole: Record<string, { count: number; failed: number }> = {}
  for (const run of runs) {
    const entry = byRole[run.role] ??= { count: 0, failed: 0 }
    entry.count += 1
    if (run.problem !== undefined) entry.failed += 1
  }
  return { count: runs.length, failed: runs.filter(run => run.problem !== undefined).length, refusals: runs.reduce((sum, run) => sum + run.refusals, 0), byRole }
}
