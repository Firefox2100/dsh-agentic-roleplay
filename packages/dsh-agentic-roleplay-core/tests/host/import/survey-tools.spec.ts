import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { ImportState } from '../../../src/host/import/begin.ts'
import { importStatus, markReady, runStage, showStaged, survey } from '../../../src/host/import/run-import.ts'
import { editSurvey } from '../../../src/host/import/survey-edit.ts'
import { hasStages, readStage } from '../../../src/host/import/stages.ts'
import { IMPORT_FOLDER, ImportStore } from '../../../src/host/import/store.ts'
import { importHooks, importTools } from '../../../src/host/import/tools.ts'
import { authoringChatSessionId } from '../../../src/shared/authoring-chat.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { v3Card } from '../../support/cards.ts'
import { answers, book } from '../../support/import-harbour.ts'
import { fakeContext } from '../../support/jobs.ts'

let root: string
let world: string
const chat = authoringChatSessionId('w1')
const settings = () => ({ maxUploadBytes: 1, concurrency: 1, reasoning: '', model: '', maxTokens: 16000, variablesPerRequest: 25, structured: 'tool' as const, temperature: 0.2, timeoutMinutes: 0, decisions: 'llm' as const, confidence: 0.7 })
const prompting = { prompts: () => ({ text: (id: string, language: string | undefined, variables?: Record<string, string | number>) => shippedText(id, language ?? 'en', variables) }), languages: () => ({ get: () => 'en' }) } as never
const worlds = () => ({ find: (id: string) => Promise.resolve(id === 'w1' ? { summary: { id: 'w1', name: 'W' }, directory: world } : undefined) }) as never

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'survey-tools-'))
  world = join(root, 'worlds', 'harbour')
  await mkdir(world, { recursive: true })
  await writeFile(join(world, 'world.json'), JSON.stringify({ id: 'w1', name: 'Test Harbour', description: '', metadata: { tags: [] } }))
  const card = readCard(Buffer.from(JSON.stringify(v3Card({ character_book: book }))), 'x.json')
  const store = new ImportStore(() => root)
  const made = await store.create(card, Buffer.from('png'))
  await store.choose(made.id, { name: 'Test Harbour', disabledEntries: ['entry:4'], opening: { kind: 'first' } })
  await store.adopt(made.id, world)
  await markReady(world)
  await writeFile(join(world, IMPORT_FOLDER, 'choices.json'), JSON.stringify({ ...JSON.parse(await readFile(join(world, IMPORT_FOLDER, 'choices.json'), 'utf8')) as Record<string, unknown>, pause: 'stages' }))
  await survey(fakeContext(answers), world)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const exec = () => ({ agent: { session: { id: chat, snapshotEvents: () => [] }, ctx: { get: () => undefined } }, signal: new AbortController().signal }) as never
const card = { card: '.import/card.json' }

function tool(name: string) {
  const found = importTools(worlds(), settings, prompting).find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`missing tool ${name}`)
  return found
}

describe('looking at an import of a card that pauses at the stages', () => {
  it('says where the import is and that it pauses at the stages', async () => {
    const status = await tool('import_status').execute({ ...card } as never, exec())
    expect(status).toMatchObject({ phase: 'surveyed', complete: false, pause: 'stages' })
    expect(await importStatus(world)).toMatchObject({ phase: 'surveyed' })
  })

  it('says so when the card it is paused for cannot be read, instead of calling it a card that never ended', async () => {
    await rm(join(world, IMPORT_FOLDER, 'card.json'))
    await mkdir(join(world, IMPORT_FOLDER, 'card.json'), { recursive: true })
    await expect(tool('import_status').execute({ ...card } as never, exec())).rejects.toThrow()
  })

  it('shows the survey in pages, and takes a page past the end as the first one', async () => {
    const first = await tool('import_survey_show').execute({ ...card, what: 'entities' } as never, exec()) as { entities: unknown[] }
    expect(first.entities.length).toBeGreaterThan(0)
    const later = await tool('import_survey_show').execute({ ...card, what: 'entities', offset: 1 } as never, exec()) as { entities: unknown[] }
    expect(later.entities).not.toEqual(first.entities)
    const past = await tool('import_survey_show').execute({ ...card, what: 'entities', offset: 10_000 } as never, exec()) as { entities: unknown[] }
    expect(past.entities).toEqual([])
    const pieces = await tool('import_survey_show').execute({ ...card, what: 'pieces' } as never, exec()) as { pieces: unknown[] }
    expect(pieces.pieces.length).toBeGreaterThan(0)
  })

  it('refuses an edit it cannot make, saying what it did not understand', async () => {
    await expect(tool('import_survey_edit').execute({ ...card, edits: [] } as never, exec())).rejects.toThrow(/give at least one change/)
    await expect(tool('import_survey_edit').execute({ ...card, edits: [{ op: 'rename' }] } as never, exec())).rejects.toThrow(/nothing was changed:/)
  })

  it('takes a change to the survey and says what it did', async () => {
    const done = await tool('import_survey_edit').execute({ ...card, edits: [{ op: 'rename', entity: 'old-tam', name: 'Old Tam' }] } as never, exec()) as { done: string[] }
    expect(done.done).toEqual(['renamed Old Tam to Old Tam'])
  })

  it('shows and audits what a stage staged, and says when it has not run yet', async () => {
    await expect(tool('import_show').execute({ ...card, stage: 'places' } as never, exec())).rejects.toThrow(/has not run yet/)
    await runStage(fakeContext(answers), world, 'places')
    const listed = await tool('import_show').execute({ ...card, stage: 'places' } as never, exec()) as { documents: { name: string }[] }
    expect(listed.documents.length).toBeGreaterThan(0)
    const one = await tool('import_show').execute({ ...card, stage: 'places', name: listed.documents[0]!.name } as never, exec())
    expect(one).toMatchObject({ stage: 'places' })
    await expect(tool('import_show').execute({ ...card, stage: 'places', name: 'nothing' } as never, exec())).rejects.toThrow(/staged nothing called/)
    const audit = await tool('import_audit').execute({ ...card, stage: 'places' } as never, exec()) as { stage: string }
    expect(audit).toMatchObject({ stage: 'places' })
  })
})
describe('the turn of an import that pauses', () => {
  function hooked() {
    const listeners: Record<string, (...args: never[]) => unknown> = {}
    const commands = new Map<string, (call: unknown) => Promise<{ kind: string; text?: string }>>()
    const scope = { commands: { register: (definition: { name: string; handler: never }) => { commands.set(definition.name, definition.handler); return () => undefined } }, effect: (run: () => unknown) => { run() } }
    importHooks({ on: (name: string, listener: (...args: never[]) => unknown) => { listeners[name] = listener }, inject: (_names: string[], run: (scope: unknown) => void) => { run(scope) } } as never, worlds(), prompting, new ImportState())
    const agent = (id: string) => ({ session: { id, header: {} }, steer: vi.fn(), followup: vi.fn() })
    const step = async (who: ReturnType<typeof agent>) => await commands.get('import-st')!({ agent: who, rawInput: ' .import/card.json Import this card.', signal: new AbortController().signal })
    const stopping = (who: unknown) => (listeners['agent/turn-stopping'] as (payload: unknown) => Promise<void>)({ agent: who, turn: 1 })
    return { agent, step, stopping }
  }

  it('lets the turn end once the survey exists, since the next stage waits for the person', async () => {
    const { agent, step, stopping } = hooked()
    const chatAgent = agent(chat)
    await step(chatAgent)
    await stopping(chatAgent)
    expect(chatAgent.steer).not.toHaveBeenCalled()
  })
})

describe('the survey as it is changed and shown', () => {
  const surveyOf = async () => ({
    classified: JSON.parse(await readFile(join(world, IMPORT_FOLDER, 'classification.json'), 'utf8')) as Record<string, { roles: string[]; targets: { name: string; kind: string }[] }>,
    roster: JSON.parse(await readFile(join(world, IMPORT_FOLDER, 'roster.json'), 'utf8')) as never,
  })

  it('refuses a piece that names too many targets, or one whose kind is not a thing of a world', async () => {
    const before = await surveyOf()
    const pieces = new Set(Object.keys(before.classified))
    const many = Array.from({ length: 11 }, (_, index) => ({ name: `target ${index}`, kind: 'character' }))
    expect(() => editSurvey(before as never, [{ op: 'piece', piece: [...pieces][0]!, targets: many }] as never, pieces)).toThrow(/at most 10 targets/)
    expect(() => editSurvey(before as never, [{ op: 'piece', piece: [...pieces][0]!, targets: [{ name: 'Tam', kind: 'dragon' }] }] as never, pieces)).toThrow(/kind is one of/)
  })

  it('refuses a change it does not know', async () => {
    const before = await surveyOf()
    expect(() => editSurvey(before as never, [{ op: 'polish' }] as never, new Set(Object.keys(before.classified)))).toThrow(/unknown change/)
  })

  it('sees the folders of the stages, and says so when one cannot be read', async () => {
    expect(await hasStages(world)).toBe(false)
    await mkdir(join(world, IMPORT_FOLDER, 'stages', 'places.json'), { recursive: true })
    expect(await hasStages(world)).toBe(true)
    await expect(readStage(world, 'places')).rejects.toThrow()
  })

  it('lists every group a stage staged, in the order they are written', async () => {
    await mkdir(join(world, IMPORT_FOLDER, 'stages'), { recursive: true })
    const extracted = {
      locations: [{ name: 'Pier' }], characters: [{ name: 'Tam' }], factions: [{ name: 'Watch' }], items: [{ name: 'Key' }],
      lore: [{ title: 'Founding' }], variables: [{ name: 'Weather' }], commands: [{ word: 'pray' }], triggers: [{ key: 'knock' }],
      prompts: [{ id: 'tone', text: 'Write plainly.' }], rules: ['No magic.'],
    }
    await writeFile(join(world, IMPORT_FOLDER, 'stages', 'casting.json'), JSON.stringify({ stage: 'casting', at: new Date().toISOString(), revision: 1, extracted }))
    const shown = await showStaged(world, 'casting') as { documents: { kind: string; name: string }[] }
    expect(shown.documents.map(entry => entry.kind)).toEqual(['place', 'character', 'faction', 'thing', 'lore', 'variable', 'command', 'trigger', 'prompt', 'rule'])
    expect(shown.documents.map(entry => entry.name)).toContain('rule-1')
  })
})