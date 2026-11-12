import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AUTHORING, authoringCases, authoringProblems, seedWorld, type AuthoringId } from './authoring-cases.ts'
import { askAuthor } from './authoring-run.ts'
import { LANGUAGES, type Language } from './language.ts'
import { StoryRig } from './rows-run.ts'
import { openTrace, traceFolder } from './trace.ts'
import { writeFiles } from './write.ts'

/**
 * The world-authoring benchmark, live: each request of `authoring-cases.ts` is said to the authoring assistant of a seed world in a running DSH, and the files it leaves are held to what the
 * request asked. The rig is the one of the row benchmark (a DSH on a throwaway root) with the plugin setting `authoringApproval: auto`, so that the changes are made without a person to approve them. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_URL=<dsh url with token> BENCH_ROOT=<the rig's roleplay root> BENCH_LABEL=authoring npx vitest run tests/benchmark/authoring.spec.ts
 *
 * Choices (environment): BENCH_ONLY (kinds), BENCH_LANGS, BENCH_REPEAT, BENCH_AUTHOR_MINUTES (how long one request may take, default 20), BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'authoring')
const only = process.env['BENCH_ONLY']?.split(',') as AuthoringId[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const limit = Number(env('BENCH_AUTHOR_MINUTES', '20')) * 60_000
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

interface Result { trace?: string | undefined; kind: AuthoringId; language: Language; run: number; problems: string[]; turns: number; ms: number }
const results: Result[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const summary = { label, runs: results.length, held: results.filter(result => result.problems.length === 0).length, missed: results.filter(result => result.problems.length > 0).map(result => `${result.language} ${result.kind} #${result.run}: ${result.problems.join('; ')}`), seconds: Math.round(results.reduce((count, result) => count + result.ms, 0) / 1000) }
  const file = join(out, `authoring-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

describe.skipIf(!live)(`the world-authoring benchmark, live (${label})`, () => {
  const url = env('BENCH_URL', '')
  const root = env('BENCH_ROOT', '')
  const rig = new StoryRig(url, root)
  for (const language of languages) {
    for (const kind of AUTHORING.filter(candidate => only === undefined || only.includes(candidate))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${kind}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          if (url === '' || root === '') throw new Error('set BENCH_URL (the DSH url with its token) and BENCH_ROOT (the rig\'s roleplay root)')
          await rig.login()
          const made = authoringCases(language).find(entry => entry.kind === kind)!
          const trace = openTrace(traceFolder(out, label), `${language}-${kind}-${run}`, { id: made.id, label, language, run, options: { models: 'the rig\'s' } })
          const worldId = `bench-author-${made.id}-${run}-${Date.now().toString(36)}`
          const folder = join(root, 'worlds', worldId)
          const files = seedWorld(language)
          made.seed?.(files)
          files.set('world.json', { ...(files.get('world.json') as Record<string, unknown>), id: worldId })
          await rm(folder, { recursive: true, force: true })
          await mkdir(folder, { recursive: true })
          await writeFiles(folder, files)
          const seedInfo = files.get('world.json') as Record<string, unknown>
          trace.state('seed', { files: [...files.keys()], message: made.message })
          try {
            await rig.api('/worlds/refresh', { method: 'POST' })
            const id = encodeURIComponent(worldId)
            const done = await askAuthor({
              say: async (text) => { await rig.api(`/worlds/authoring/message?id=${id}`, { method: 'POST', body: JSON.stringify({ text, language }) }) },
              status: async () => await rig.api<{ turns: number; running: boolean }>(`/worlds/authoring/status?id=${id}`),
            }, made.message, { limitMs: limit, pollMs: 3000 })
            const problems = await authoringProblems(made.expect, { directory: folder, seedCharacters: ['visitor', 'miller'], seedTools: seedInfo['tools'] })
            trace.state('world', { files: Object.fromEntries(await Promise.all((await readdir(folder, { recursive: true })).filter(name => name.endsWith('.json')).map(async name => [name, await readFile(join(folder, name), 'utf8').catch(() => '')]))) })
            trace.expect('the world holds what the request asked', problems.length === 0, { problems })
            results.push({ trace: trace.file, kind, language, run, problems, turns: done.turns, ms: done.ms })
            expect(problems).toEqual([])
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
