import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LANGUAGES, type Language } from './language.ts'
import { LIBRARY, libraryCases, libraryProblems, type LibraryId, type LibraryOutcome } from './library-cases.ts'
import { StoryRig } from './rows-run.ts'
import { openTrace, traceFolder } from './trace.ts'

/**
 * The library-import benchmark through the assistants, live: the same invented preset and lorebook files of `library-cases.ts` are uploaded to a running DSH (`POST /presets/import`,
 * `POST /lorebooks/import`), whose preset and lorebook authoring assistants make the library entry, and what the library holds afterwards is held to what the file asks. The rig is the one
 * of the authoring benchmark (a DSH on a throwaway root, plugin setting `authoringApproval: auto`, which the preset and lorebook assistants follow except for prompts that hold rules of the game).
 * A lorebook's instructions are counted wherever they ended: waiting in the import's steering file, or in a preset the assistant made of them. Runs only when asked:
 *
 *   BENCH_LIVE=1 BENCH_URL=<dsh url with token> BENCH_ROOT=<the rig's roleplay root> BENCH_LABEL=library-assistant npx vitest run tests/benchmark/library-assistant.spec.ts
 *
 * Choices (environment): BENCH_ONLY (kinds), BENCH_LANGS, BENCH_REPEAT, BENCH_AUTHOR_MINUTES, BENCH_KEEP, BENCH_OUT.
 */
const live = process.env['BENCH_LIVE'] !== undefined
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const label = env('BENCH_LABEL', 'library-assistant')
const only = process.env['BENCH_ONLY']?.split(',') as LibraryId[] | undefined
const languages = env('BENCH_LANGS', LANGUAGES.join(',')).split(',') as Language[]
const repeat = Number(env('BENCH_REPEAT', '1'))
const limit = Number(env('BENCH_AUTHOR_MINUTES', '20')) * 60_000
const out = env('BENCH_OUT', join(import.meta.dirname, '..', '..', '..', '..', 'eval', 'results'))

interface Result { trace?: string | undefined; kind: LibraryId; language: Language; run: number; problems: string[]; turns: number; ms: number }
const results: Result[] = []

afterAll(() => {
  if (!live || results.length === 0) return
  const summary = { label, runs: results.length, held: results.filter(result => result.problems.length === 0).length, missed: results.filter(result => result.problems.length > 0).map(result => `${result.language} ${result.kind} #${result.run}: ${result.problems.join('; ')}`), seconds: Math.round(results.reduce((count, result) => count + result.ms, 0) / 1000) }
  const file = join(out, `library-assistant-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 1)}\n`)
  console.log(`benchmark results: ${file}\n${JSON.stringify(summary, null, 1)}`)
})

const folders = async (directory: string): Promise<string[]> => await readdir(directory).catch(() => [])
const json = async (file: string): Promise<Record<string, unknown> | undefined> => { try { return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown> } catch { return undefined } }

async function promptsOf(directory: string): Promise<{ id: string; text: string }[]> {
  const found: { id: string; text: string }[] = []
  for (const language of await folders(join(directory, 'prompts'))) {
    for (const file of await folders(join(directory, 'prompts', language, 'roleplay'))) found.push({ id: `roleplay/${file.replace(/\.md$/, '')}`, text: await readFile(join(directory, 'prompts', language, 'roleplay', file), 'utf8') })
  }
  return found
}

async function waitIdle(rig: StoryRig, chat: string): Promise<number> {
  const began = Date.now()
  let quiet = 0
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    const status = await rig.api<{ turns: number; running: boolean }>(`/authoring/status?chat=${encodeURIComponent(chat)}`)
    quiet = status.turns > 0 && !status.running ? quiet + 1 : 0
    if (quiet >= 2) return status.turns
    if (Date.now() - began > limit) throw new Error(`the assistant had not finished after ${Math.round(limit / 60_000)} minutes (${status.turns} turns ended): is the rig's authoringApproval set to auto?`)
  }
}

describe.skipIf(!live)(`the library-import benchmark through the assistants, live (${label})`, () => {
  const url = env('BENCH_URL', '')
  const root = env('BENCH_ROOT', '')
  const rig = new StoryRig(url, root)
  for (const language of languages) {
    for (const kind of LIBRARY.filter(candidate => only === undefined || only.includes(candidate))) {
      for (let run = 1; run <= repeat; run += 1) {
        it(`${language} ${kind}${repeat > 1 ? ` #${run}` : ''}`, async () => {
          if (url === '' || root === '') throw new Error('set BENCH_URL (the DSH url with its token) and BENCH_ROOT (the rig\'s roleplay root)')
          await rig.login()
          const made = libraryCases(language).find(entry => entry.kind === kind)!
          const trace = openTrace(traceFolder(out, label), `${language}-${kind}-${run}`, { id: made.id, label, language, run, options: { models: 'the rig\'s' } })
          const name = `bench-${kind}-${language}-${run}-${Date.now().toString(36)}`
          const isPreset = kind.startsWith('preset')
          const presetsBefore = new Set(await folders(join(root, 'presets')))
          const began = Date.now()
          let made2: string[] = []
          try {
            const opened = await fetch(`${new URL(url).origin}/roleplay-api/${isPreset ? 'presets' : 'lorebooks'}/import?name=${encodeURIComponent(name)}&language=${language}`, { method: 'POST', headers: { cookie: (rig as unknown as { cookie: string }).cookie }, body: new Uint8Array(made.file) })
            if (!opened.ok) throw new Error(`the upload answered ${opened.status}: ${(await opened.text()).slice(0, 300)}`)
            const chat = (await opened.json() as { chatSessionId: string }).chatSessionId
            const turns = await waitIdle(rig, chat)
            made2 = (await folders(join(root, 'presets'))).filter(entry => !presetsBefore.has(entry) && entry !== name)
            const outcome: LibraryOutcome = { prompts: [], rules: [], entries: [], steering: [] }
            if (isPreset) outcome.prompts = await promptsOf(join(root, 'presets', name))
            else {
              const book = join(root, 'lorebooks', name)
              for (const id of await folders(join(book, 'lore'))) {
                const entry = await json(join(book, 'lore', id, 'lore.json'))
                if (entry !== undefined) outcome.entries.push({ title: String(entry['title'] ?? ''), body: String(entry['body'] ?? ''), summary: String(entry['summary'] ?? ''), scope: entry['scope'] === 'listed' ? 'listed' : 'everyone', knownBy: Array.isArray(entry['known_by']) ? entry['known_by'].map(String) : [] })
              }
              const pending = await json(join(book, '.import', 'steering.json'))
              const guidance = pending?.['guidance'] as Record<string, string[]> | undefined
              outcome.steering = [...Object.values(guidance ?? {}).flat(), ...(await Promise.all(made2.map(async preset => await promptsOf(join(root, 'presets', preset))))).flat().map(entry => entry.text)]
            }
            // the world rule of a preset has no place in the library, so it is not asked of the assistant
            const { rule: _rule, ...asked } = made.expect
            const problems = libraryProblems(asked, outcome)
            trace.state('outcome', { chat, ...outcome, madePresets: made2 })
            trace.expect('the library holds what the file asks', problems.length === 0, { problems })
            results.push({ trace: trace.file, kind, language, run, problems, turns, ms: Date.now() - began })
            expect(problems.filter(problem => /demanded|told to everyone|obeyed/.test(problem))).toEqual([])
          } finally {
            if (process.env['BENCH_KEEP'] === undefined) {
              await rig.api(`/${isPreset ? 'presets' : 'lorebooks'}/item?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => undefined)
              for (const preset of made2) await rig.api(`/presets/item?name=${encodeURIComponent(preset)}`, { method: 'DELETE' }).catch(() => undefined)
            }
          }
        }, limit + 120_000)
      }
    }
  }
})
