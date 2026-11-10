import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { loadData } from './framework/index.ts'
import { playRow, StoryRig, type RowRun } from './rows-run.ts'
import { byKind, describeKinds, flaky } from './report.ts'
import { openTrace, traceFolder } from './trace.ts'

/**
 * The rows played as stories against a running DSH on a throwaway root, with the script's turns and expectations.
 *   BENCH_LIVE=1 BENCH_URL=<dsh url with token> BENCH_ROOT=<the rig's roleplay root> BENCH_LABEL=rows npx vitest run tests/benchmark/rows-live.spec.ts
 * Choices (environment): BENCH_ROWS (row ids, comma separated; default every row that has a script), BENCH_REPEAT, BENCH_OUT, BENCH_TRACE, BENCH_TRACE_DIR, BENCH_DSH_SESSIONS.
 * The models are the rig's: their requests and answers are in the game master's log, kept beside each trace.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'rows')
const repeat = Number(env('BENCH_REPEAT', '1'))
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))
const data = loadData()
const chosen = process.env['BENCH_ROWS']?.split(',')
const rows = data.rows.filter(row => row.script !== undefined && (chosen === undefined || chosen.includes(row.id)))
const results: RowRun[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const normal = results.filter(result => result.planted === undefined)
  const judged = normal.filter(result => result.score !== undefined)
  const summary = {
    label, runs: results.length, planted: results.filter(result => result.planted !== undefined).map(result => `${result.row} #${result.run}: ${result.planted!.what}: ${result.planted!.outcome}`), failed: results.filter(result => result.failure !== undefined).map(result => `${result.row} #${result.run}: ${result.failure}`),
    score: judged.length === 0 ? 'n/a' : Number((judged.reduce((sum, result) => sum + result.score!, 0) / judged.length).toFixed(3)),
    missed: normal.flatMap(result => result.verdicts.filter(verdict => verdict.held === false).map(verdict => `${result.row} #${result.run} ${verdict.where} ${verdict.expectation.type}${verdict.found === undefined ? '' : `: ${verdict.found}`}`)),
    byRow: Object.fromEntries(rows.map(row => [row.id, results.filter(result => result.row === row.id).map(result => result.score ?? 'n/a')])),
    byKind: describeKinds(byKind(results, row => data.worlds[data.rows.find(entry => entry.id === row)?.world ?? '']?.meta.theme ?? '')),
    flaky: flaky(results),
    byLanguage: Object.fromEntries(['en', 'zh'].map(language => { const scored = judged.filter(result => result.language === language); return [language, scored.length === 0 ? 'n/a' : Number((scored.reduce((sum, result) => sum + result.score!, 0) / scored.length).toFixed(3))] })),
    helpers: { count: results.reduce((sum, result) => sum + (result.helpers?.count ?? 0), 0), failed: results.reduce((sum, result) => sum + (result.helpers?.failed ?? 0), 0), refusals: results.reduce((sum, result) => sum + (result.helpers?.refusals ?? 0), 0) },
    seconds: results.reduce((sum, result) => sum + result.seconds, 0),
  }
  const file = join(out, `rows-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe.skipIf(!live)(`the rows played as stories (${label})`, () => {
  const url = env('BENCH_URL', '')
  const root = env('BENCH_ROOT', '')
  const rig = new StoryRig(url, root)
  for (const row of rows) {
    for (let run = 1; run <= repeat; run += 1) {
      it(`${row.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
        if (url === '' || root === '') throw new Error('set BENCH_URL (the DSH url with its token) and BENCH_ROOT (the rig\'s roleplay root)')
        await rig.login()
        const script = data.scripts.find(entry => entry.id === row.script)!
        const folder = traceFolder(out, label)
        const trace = openTrace(folder, `${row.id}-${run}`, { id: row.id, label, language: row.language, run, options: { models: 'the rig\'s' } })
        const result = await playRow(rig, data, row, script, trace, folder === undefined ? undefined : join(folder, `${row.id}-${run}.chat.jsonl.zstd`))
        results.push({ ...result, run })
      }, 60 * 60_000)
    }
  }
})
