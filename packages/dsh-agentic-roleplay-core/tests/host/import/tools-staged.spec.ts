import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { importTools } from '../../../src/host/import/tools.ts'
import { IMPORT_COMMAND } from '../../../src/shared/import-card.ts'

// The stage itself is a model job; what is checked here is the tool around it, so the run is stubbed and the tool's
// own bookkeeping (the per-turn limit, the pause it reports, the next step it names) is what the test drives.
vi.mock('../../../src/host/import/run-import.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/host/import/run-import.ts')>(),
  runStage: async (_ctx: unknown, _directory: string, stage: string) => ({ stage, left: [], stale: [], complete: false, counts: { places: 1 }, written: ['Pier'], notes: 0 }),
}))

const ENVIRONMENT = { maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 16000, variablesPerRequest: 25, structured: 'tool' as const, temperature: 0.2, timeoutMinutes: 0, decisions: 'llm' as const, confidence: 0.7 }

let root = ''
let world = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'roleplay-tool-staged-'))
  world = join(root, 'the-harbour')
  await mkdir(join(world, '.import'), { recursive: true })
  await writeFile(join(world, '.import', 'card.json'), JSON.stringify({ kind: 'card', name: 'The Harbour', book: { entries: [] } }))
  await writeFile(join(world, '.import', 'state.json'), JSON.stringify({ phase: 'surveyed' }))
  await mkdir(join(world, '.import', 'stages'), { recursive: true })
  await writeFile(join(world, '.import', 'classification.json'), JSON.stringify({ 'entry:0': { roles: ['character'], targets: [{ name: 'Tam', kind: 'character' }] } }))
  await writeFile(join(world, '.import', 'roster.json'), JSON.stringify([{ name: 'Tam', kind: 'character', pieces: ['entry:0'] }]))
  await writeFile(join(world, '.import', 'survey.json'), JSON.stringify([{ name: 'Tam', kind: 'character', pieces: ['entry:0'] }]))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

const chat = () => authoringChatSessionId('the-harbour')
const prompting = () => ({
  prompts: () => ({ text: (id: string, language: string | undefined, variables?: Record<string, string | number>) => shippedText(id, language ?? 'en', variables) }),
  languages: () => ({ get: () => 'en' }),
}) as never
const worlds = () => ({ find: (id: string) => Promise.resolve(id === 'the-harbour' ? { summary: { id, name: 'The Harbour' }, directory: world } : undefined) }) as never
const exec = () => ({ agent: { session: { id: chat(), snapshotEvents: () => [], header: {}, requestHeader: () => undefined }, ctx: { get: () => undefined } }, signal: new AbortController().signal }) as never
const tool = (name: string) => importTools(worlds(), () => ENVIRONMENT as never, prompting()).find(candidate => candidate.name === name)!

describe('the staged import tools', () => {
  it('renders their results as text and says which may run at the same time', () => {
    // A tool answers about concurrency only for arguments the runtime would have accepted, so each is given its own.
    const argsOf = (name: string): Record<string, unknown> =>
      name === 'import_stage' || name === 'import_show' || name === 'import_audit' ? { card: '.import/card.json', stage: 'places' }
        : name === 'import_survey_edit' ? { card: '.import/card.json', edits: [{ op: 'rename', entity: 'tam', name: 'Tam' }] }
          : { card: '.import/card.json' }
    for (const candidate of importTools(worlds(), () => ENVIRONMENT as never, prompting())) {
      const rendered = candidate.output?.render(argsOf(candidate.name) as never, { stage: 'places' } as never)
      expect(rendered?.[0]?.type, `${candidate.name} renders its result as text`).toBe('text')
      expect(candidate.isConcurrencySafe?.(argsOf(candidate.name) as never), `${candidate.name} runs beside the others or not`).toBeTypeOf('boolean')
    }
  })

  it('runs a stage twice in a turn and refuses the third time, saying what is wrong', async () => {
    const stage = tool('import_stage')
    const first = await stage.execute({ card: '.import/card.json', stage: 'places' } as never, exec()) as { stage: string; next: string }
    expect(first.stage).toBe('places')
    expect(typeof first.next, 'the tool names the step after the stage').toBe('string')
    await stage.execute({ card: '.import/card.json', stage: 'places' } as never, exec())
    await expect(stage.execute({ card: '.import/card.json', stage: 'places' } as never, exec())).rejects.toThrow(/has already run 2 times in this turn/)
  })

  it('reports a stage that was not run yet, and audits the one that was', async () => {
    const show = tool('import_show')
    await expect(show.execute({ card: '.import/card.json', stage: 'places' } as never, exec())).rejects.toThrow(/has not run yet/)
    await writeFile(join(world, '.import', 'stages', 'places.json'), JSON.stringify({ stage: 'places', at: new Date().toISOString(), revision: 1, extracted: { locations: [{ name: 'Pier' }] } }))
    const listed = await show.execute({ card: '.import/card.json', stage: 'places' } as never, exec()) as { documents: { name: string }[] }
    expect(listed.documents.map(entry => entry.name)).toEqual(['Pier'])
    const audit = await tool('import_audit').execute({ card: '.import/card.json', stage: 'places' } as never, exec()) as { stage: string }
    expect(audit.stage).toBe('places')
  })

  it('passes on a failure that is not about the survey itself', async () => {
    await rm(join(world, '.import', 'survey.json'), { force: true })
    await mkdir(join(world, '.import', 'survey.json'), { recursive: true })
    const edit = tool('import_survey_edit')
    await expect(edit.execute({ card: '.import/card.json', edits: [{ op: 'rename', entity: 'tam', name: 'Tam' }] } as never, exec())).rejects.toThrow()
  })

  it('ends the review of the card when the turn that imported it is over', async () => {
    const ctx = { on: (name: string, listener: unknown) => listeners.set(name, listener), inject: (_names: string[], run: (scope: unknown) => unknown) => { run({ commands: { register: () => () => undefined }, effect: (job: () => unknown) => { job() } }) }, effect: () => undefined, commands: { register: () => () => undefined } } as never
    const listeners = new Map<string, unknown>()
    const { importHooks } = await import('../../../src/host/import/tools.ts')
    importHooks(ctx, worlds(), prompting(), { importing: new Map(), objections: new Map(), repairs: new Map() } as never)
    const ended = listeners.get('session/event') as (session: unknown, event: unknown) => Promise<void>
    await ended({ id: chat(), header: { origin: 'user' } }, { type: 'turn/end' })
    const stopped = listeners.get('agent/turn-stopping') as (payload: unknown) => Promise<void>
    await stopped({ agent: { session: { id: chat(), header: {} }, steer: vi.fn(), followup: vi.fn() } })
    expect(IMPORT_COMMAND).toBe('/import-st')
  })

  it('keeps the card it was given, so a later turn still knows which one to import', async () => {
    const status = await tool('import_status').execute({ card: '.import/card.json' } as never, exec()) as { phase: string }
    expect(status, 'the status of an import says where it stands').toHaveProperty('pause')
    expect(JSON.parse(await readFile(join(world, '.import', 'card.json'), 'utf8')).name).toBe('The Harbour')
  })
})
