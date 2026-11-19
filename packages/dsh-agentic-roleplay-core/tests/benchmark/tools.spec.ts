import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { authoringChatSessionId } from '../../src/shared/authoring-chat.ts'
import { askAuthor } from './authoring-run.ts'
import { findSessionLog, readLog } from './helper-logs.ts'
import { LANGUAGES, type Language } from './language.ts'
import { StoryRig } from './rows-run.ts'
import { TOOL_CASES, toolCases, toolSeed, toolWorldProblems, type ToolCaseId } from './tool-cases.ts'
import { toolCallsOf, toolMetrics, toolProblems, type ToolMetrics } from './tool-trace.ts'
import { openTrace, traceFolder } from './trace.ts'
import { writeFiles } from './write.ts'

/**
 * The tools and skills benchmark, live: each request of `tool-cases.ts` is said to the authoring assistant of a seed world in a running DSH, and both what it leaves behind (the files, held to a small
 * change that left everything else alone) and how it got there (its calls, read from its own session log: the guide loaded before the write, no deleting and making again, few failed calls) are judged.
 * The rig is the one of the authoring benchmark (`authoringApproval: auto`), and the log is read from DSH's sessions folder (BENCH_DSH_SESSIONS, default ~/.dsh/sessions). Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_URL=<dsh url with token> BENCH_ROOT=<the rig's roleplay root> BENCH_LABEL=tools npx vitest run tests/benchmark/tools.spec.ts
 *
 * Choices (environment): BENCH_ONLY (kinds), BENCH_LANGS, BENCH_REPEAT, BENCH_AUTHOR_MINUTES, BENCH_OUT. The results file adds up the metrics per language, so a change to a tool, a guide or a message can be compared with the run before it.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'tools')
const only = process.env['BENCH_ONLY']?.split(',') as ToolCaseId[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const limit = Number(env('BENCH_AUTHOR_MINUTES', '20')) * 60_000
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const sessions = env('BENCH_DSH_SESSIONS', join(homedir(), '.dsh', 'sessions'))

interface Result { trace?: string | undefined; kind: ToolCaseId; language: Language; run: number; world: string[]; tools: string[]; metrics?: ToolMetrics | undefined; turns: number; ms: number }
const results: Result[] = []

const sum = (list: readonly ToolMetrics[], pick: (metrics: ToolMetrics) => number): number => list.reduce((count, metrics) => count + pick(metrics), 0)

afterAll(() => {
  if (!live || results.length === 0) return
  const perLanguage = Object.fromEntries(languages.map((language) => {
    const mine = results.filter(result => result.language === language)
    const metrics = mine.flatMap(result => (result.metrics === undefined ? [] : [result.metrics]))
    return [language, { runs: mine.length, held: mine.filter(result => result.world.length === 0 && result.tools.length === 0).length, worldMissed: mine.filter(result => result.world.length > 0).length, toolsMissed: mine.filter(result => result.tools.length > 0).length, calls: sum(metrics, m => m.calls), failed: sum(metrics, m => m.failed), whole: sum(metrics, m => m.whole), partial: sum(metrics, m => m.partial), churn: sum(metrics, m => m.churn), guidesSkipped: sum(metrics, m => m.guidesSkipped.length) }]
  }))
  const summary = { label, runs: results.length, perLanguage, missed: results.filter(result => result.world.length + result.tools.length > 0).map(result => `${result.language} ${result.kind} #${result.run}: ${[...result.world, ...result.tools].join('; ')}`) }
  const file = join(out, `tools-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe.skipIf(!live)(`the tools and skills benchmark, live (${label})`, () => {
  const url = env('BENCH_URL', '')
  const root = env('BENCH_ROOT', '')
  const rig = new StoryRig(url, root)
  for (const language of languages) {
    for (const kind of TOOL_CASES.filter(candidate => only === undefined || only.includes(candidate))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${kind}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          if (url === '' || root === '') throw new Error('set BENCH_URL (the DSH url with its token) and BENCH_ROOT (the rig\'s roleplay root)')
          await rig.login()
          const made = toolCases(language).find(entry => entry.kind === kind)!
          const trace = openTrace(traceFolder(out, label), `${language}-${kind}-${run}`, { id: made.id, label, language, run, options: { models: 'the rig\'s' } })
          const worldId = `bench-tools-${made.id}-${run}-${Date.now().toString(36)}`
          const folder = join(root, 'worlds', worldId)
          const files = toolSeed(language)
          files.set('world.json', { ...(files.get('world.json') as Record<string, unknown>), id: worldId })
          await rm(folder, { recursive: true, force: true })
          await mkdir(folder, { recursive: true })
          await writeFiles(folder, files)
          trace.state('seed', { files: [...files.keys()], message: made.message })
          try {
            await rig.api('/worlds/refresh', { method: 'POST' })
            const id = encodeURIComponent(worldId)
            const done = await askAuthor({
              say: async (text) => { await rig.api(`/worlds/authoring/message?id=${id}`, { method: 'POST', body: JSON.stringify({ text, language }) }) },
              status: async () => await rig.api<{ turns: number; running: boolean }>(`/worlds/authoring/status?id=${id}`),
            }, made.message, { limitMs: limit, pollMs: 3000 })
            const world = await toolWorldProblems(made.world, folder, files)
            const log = findSessionLog(sessions, authoringChatSessionId(worldId))
            const calls = log === undefined ? undefined : toolCallsOf(readLog(log))
            const tools = calls === undefined ? ['the assistant\'s session log was not found (set BENCH_DSH_SESSIONS)'] : toolProblems(made.tools, calls)
            const metrics = calls === undefined ? undefined : toolMetrics(calls)
            trace.state('calls', { calls: calls?.map(call => ({ name: call.name, error: call.error, args: call.args })), metrics })
            trace.expect('the world holds what the request asked, and what it left alone', world.length === 0, { problems: world })
            trace.expect('the assistant used its tools and guides as it should', tools.length === 0, { problems: tools })
            results.push({ trace: trace.file, kind, language, run, world, tools, metrics, turns: done.turns, ms: done.ms })
            expect([...world, ...tools]).toEqual([])
          } finally {
            if (process.env['BENCH_KEEP'] === undefined) {
              await rig.api(`/worlds/authoring/chat?id=${encodeURIComponent(worldId)}`, { method: 'DELETE' }).catch(() => undefined)
              await rm(folder, { recursive: true, force: true })
            }
            await rig.api('/worlds/refresh', { method: 'POST' }).catch(() => undefined)
          }
        }, limit + 120_000)
      }
    }
  }
})
