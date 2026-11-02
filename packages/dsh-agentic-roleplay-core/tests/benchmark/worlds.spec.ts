import { cp, mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/host/checks/run.ts'
import type { CheckedWorld } from '../../src/host/worlds/validated-world.ts'
import { liveContext, newCounters, type DecisionMode, type LiveOptions } from './live.ts'
import type { Language } from './language.ts'

/**
 * The judged checks on worlds that exist on this machine, to read what they find by hand: `BENCH_WORLDS` is a comma-separated list of `folder` or `folder=zh`. Each world is
 * checked on a copy and its findings are written to `BENCH_OUT`, never into the repository. Same service choices as live.spec.ts.
 *
 *   BENCH_LIVE=1 BENCH_WORLDS="/path/world=zh" BENCH_OUT=/tmp/out npx vitest run tests/benchmark/worlds.spec.ts
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const mode = env('BENCH_MODE', 'llm') as DecisionMode
const out = env('BENCH_OUT', join(tmpdir(), 'benchmark-worlds'))
const worlds = (process.env['BENCH_WORLDS'] ?? '').split(',').filter(entry => entry !== '').map((entry) => { const [folder = '', language = 'en'] = entry.split('='); return { folder, language: language as Language } })

const options: LiveOptions = {
  llm: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_LLM_MODEL', 'qwen3.6-35b-a3b-uncensored-1m'), temperature: 0.2, reasoning: env('BENCH_REASONING', 'none') },
  embed: { url: env('BENCH_LLM_URL', 'http://localhost:8081/v1'), model: env('BENCH_EMBED_MODEL', 'bge-m3') },
  ...mode === 'llm' ? {} : { decision: { url: env('BENCH_DECISION_URL', 'http://localhost:8083/v1'), model: env('BENCH_DECISION_MODEL', 'kev-9b'), mode, confidence: Number(env('BENCH_CONFIDENCE', '0.7')) } },
  concurrency: Number(env('BENCH_CONCURRENCY', '2')),
}

describe.skipIf(!live || worlds.length === 0)('the judged checks on worlds of this machine', () => {
  for (const { folder, language } of worlds) {
    it(`${basename(folder)} (${language})`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'world-copy-'))
      try {
        await cp(folder, directory, { recursive: true })
        const counters = newCounters()
        const began = Date.now()
        const world = { directory, summary: { id: basename(folder), name: basename(folder), description: '', tags: [] } } as unknown as CheckedWorld
        const report = await runChecks({ world, model: liveContext(options, language, counters) }, { deep: true })
        expect(report).toMatchObject({ findings: expect.any(Array), skipped: expect.any(Array) })
        mkdirSync(out, { recursive: true })
        writeFileSync(join(out, `${env('BENCH_LABEL', 'world')}-${basename(folder)}.json`), `${JSON.stringify({ seconds: Math.round((Date.now() - began) / 1000), counters: { ...counters, jobs: [] }, skipped: report.skipped, findings: report.findings }, null, 1)}\n`)
      } finally { await rm(directory, { recursive: true, force: true }) }
    }, 7_200_000)
  }
})
