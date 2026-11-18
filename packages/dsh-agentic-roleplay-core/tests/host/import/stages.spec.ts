import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCard } from '../../../src/host/import/card.ts'
import { ImportStateError, auditStage, build, changeSurvey, finish, importPhase, importStatus, markReady, runStage, showStaged, showSurvey, survey } from '../../../src/host/import/run-import.ts'
import { ImportStore } from '../../../src/host/import/store.ts'
import { SurveyEditError } from '../../../src/host/import/survey-edit.ts'
import { STAGES } from '../../../src/host/import/stages.ts'
import { importNotice, nextAfterStage, pausesAfterStep } from '../../../src/host/import/tools.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { v3Card } from '../../support/cards.ts'
import { answers, book } from '../../support/import-harbour.ts'
import { fakeContext } from '../../support/jobs.ts'

let root: string
let world: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stages-'))
  world = join(root, 'worlds', 'harbour')
  await mkdir(world, { recursive: true })
  await writeFile(join(world, 'world.json'), JSON.stringify({ id: 'w1', name: 'Test Harbour', description: '', metadata: { tags: [] } }))
  const card = readCard(Buffer.from(JSON.stringify(v3Card({ character_book: book }))), 'x.json')
  const store = new ImportStore(() => root)
  const made = await store.create(card, Buffer.from('png'))
  await store.choose(made.id, { name: 'Test Harbour', disabledEntries: ['entry:4'], opening: { kind: 'first' } })
  await store.adopt(made.id, world)
  await markReady(world)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const stateOf = async (stage: string): Promise<string | undefined> => (await importStatus(world)).stages.find(entry => entry.stage === stage)?.state

describe('the stages of the build', () => {
  it('each write their own part, and the import is built when every stage has run on the survey as it is', async () => {
    await survey(fakeContext(answers), world)
    const places = await runStage(fakeContext(answers), world, 'places')
    expect(places).toMatchObject({ stage: 'places', counts: { places: 1 }, staged: ['The Lighthouse'], complete: false })
    expect(places.left).toEqual(['characters', 'factions', 'things', 'background', 'style', 'variables', 'casting'])
    expect(await importPhase(world)).toBe('surveyed')
    for (const stage of STAGES.filter(each => each !== 'places')) await runStage(fakeContext(answers), world, stage)
    expect(await importPhase(world)).toBe('built')
    expect((await importStatus(world)).complete).toBe(true)
    const done = await finish(fakeContext(answers), world)
    expect(done).toMatchObject({ ok: true, report: { counts: { characters: 1, places: 1, lore: 1 } } })
    expect(JSON.parse(await readFile(join(world, 'characters', 'old-tam', 'character.json'), 'utf8'))).toMatchObject({ start: { location: 'the-lighthouse' } })
  })

  it('make what the whole build makes', async () => {
    await survey(fakeContext(answers), world)
    const staged = await (async () => { for (const stage of STAGES) await runStage(fakeContext(answers), world, stage); return JSON.parse(await readFile(join(world, '.import', 'extracted.json'), 'utf8')) as Record<string, unknown[]> })()
    await survey(fakeContext(answers), world)
    await build(fakeContext(answers), world)
    const whole = JSON.parse(await readFile(join(world, '.import', 'extracted.json'), 'utf8')) as Record<string, unknown[]>
    expect(whole).toEqual(staged)
  })

  it('refuse to run before there is a survey, and the casting before the background', async () => {
    await expect(runStage(fakeContext(answers), world, 'places')).rejects.toThrow(/cannot run now: the import is at "ready"/)
    await survey(fakeContext(answers), world)
    await expect(runStage(fakeContext(answers), world, 'casting')).rejects.toThrow(/needs the stage "background" first/)
  })

  it('makes a dependent stage stale whenever its prerequisite is run again', async () => {
    await survey(fakeContext(answers), world)
    await runStage(fakeContext(answers), world, 'background')
    await runStage(fakeContext(answers), world, 'casting')
    expect(await stateOf('casting')).toBe('done')
    await runStage(fakeContext(answers), world, 'background')
    expect(await stateOf('casting')).toBe('stale')
    await runStage(fakeContext(answers), world, 'casting')
    expect(await stateOf('casting')).toBe('done')
  })

  it('carry the person\'s note in every job of the stage, and keep it with the stage', async () => {
    await survey(fakeContext(answers), world)
    const ctx = fakeContext(answers)
    const report = await runStage(ctx, world, 'characters', 'Keep Tam gruff, never cheerful.')
    expect(report.guidance).toBe('Keep Tam gruff, never cheerful.')
    expect(ctx.asked.length).toBeGreaterThan(0)
    for (const asked of ctx.asked) expect(asked.prompt).toContain('Keep Tam gruff, never cheerful.')
    expect((await importStatus(world)).stages.find(entry => entry.stage === 'characters')?.guidance).toBe('Keep Tam gruff, never cheerful.')
    const without = fakeContext(answers)
    await runStage(without, world, 'places')
    expect(without.asked.some(asked => asked.prompt.includes('Keep Tam gruff'))).toBe(false)
  })

  it('report what failed instead of failing, and run again for what did not finish', async () => {
    await survey(fakeContext(answers), world)
    const broken = await runStage(fakeContext((job) => { if (job.prompt.includes('Make the character')) throw new Error('the model gave nothing'); return answers(job as never) }), world, 'characters')
    expect(broken.counts).toEqual({})
    expect(broken.notes.join(' ')).toContain('Old Tam')
    expect(broken.notesTotal).toBeGreaterThan(0)
    expect((await auditStage(world, 'characters')).missing).toEqual(['Old Tam'])
    const again = await runStage(fakeContext(answers), world, 'characters')
    expect(again.counts).toEqual({ characters: 1 })
    expect((await auditStage(world, 'characters')).missing).toEqual([])
  })

  it('show what a stage staged: its documents, or one in full', async () => {
    await survey(fakeContext(answers), world)
    await runStage(fakeContext(answers), world, 'characters')
    expect(await showStaged(world, 'characters')).toMatchObject({ documents: [{ kind: 'character', name: 'Old Tam' }] })
    expect(await showStaged(world, 'characters', 'old tam')).toMatchObject({ kind: 'character', document: { id: 'old-tam', name: 'Old Tam' } })
    await expect(showStaged(world, 'characters', 'Nobody')).rejects.toThrow(/staged nothing called/)
    await expect(showStaged(world, 'things')).rejects.toThrow(/has not run yet/)
  })
})

describe('correcting the survey', () => {
  it('shows the entities with their pieces and the pieces with their roles, a page at a time', async () => {
    await survey(fakeContext(answers), world)
    const entities = await showSurvey(world, 'entities')
    expect(entities).toMatchObject({ edited: false, entities: [{ key: 'old-tam', name: 'Old Tam', kind: 'character' }, { name: 'The Lighthouse', kind: 'place' }] })
    expect(entities.unsure).toEqual([expect.stringContaining('no character is marked as the one the player plays')])
    await changeSurvey(world, [{ op: 'player', entity: 'old-tam' }])
    expect((await showSurvey(world, 'entities')).unsure).toEqual([])
    const pieces = await showSurvey(world, 'pieces')
    expect(pieces.pieces).toHaveLength(7)
    expect(pieces.pieces?.[0]).toMatchObject({ piece: expect.any(String), roles: expect.any(Array) })
  })

  it('changes it, keeps the change, and makes the stages that read the old survey stale', async () => {
    await survey(fakeContext(answers), world)
    for (const stage of STAGES) await runStage(fakeContext(answers), world, stage)
    expect(await importPhase(world)).toBe('built')
    const changed = await changeSurvey(world, [{ op: 'rename', entity: 'old-tam', name: 'Tam the Keeper' }, { op: 'alias', entity: 'old-tam', add: ['Keeper'] }, { op: 'player', entity: 'old-tam' }])
    expect(changed.done).toHaveLength(3)
    expect(changed.stale).toEqual([...STAGES])
    expect(await importPhase(world)).toBe('surveyed')
    expect(await stateOf('places')).toBe('stale')
    const shown = await showSurvey(world, 'entities')
    expect(shown.edited).toBe(true)
    expect(shown.entities?.[0]).toMatchObject({ key: 'old-tam', name: 'Tam the Keeper', playedByThePlayer: true })
    expect((shown.entities?.[0] as { aliases: string[] }).aliases).toEqual(expect.arrayContaining(['Tam', 'Old Tam', 'Keeper']))
    await runStage(fakeContext(answers), world, 'places')
    expect(await stateOf('places')).toBe('done')
    expect((await importStatus(world)).complete).toBe(false)
  })

  it('merges, changes a kind, adds, removes and sets what a piece is, with the pieces following', async () => {
    await survey(fakeContext(answers), world)
    await changeSurvey(world, [{ op: 'add', name: 'Gull Rock', kind: 'place' }])
    let shown = await showSurvey(world, 'entities')
    expect(shown.entities).toHaveLength(3)
    await changeSurvey(world, [{ op: 'merge', entity: 'Gull Rock', into: 'The Lighthouse' }])
    shown = await showSurvey(world, 'entities')
    expect(shown.entities).toHaveLength(2)
    expect(shown.entities?.[1]).toMatchObject({ name: 'The Lighthouse', aliases: ['Gull Rock'] })
    await changeSurvey(world, [{ op: 'kind', entity: 'The Lighthouse', kind: 'thing' }])
    expect((await showSurvey(world, 'entities')).entities?.[1]).toMatchObject({ kind: 'thing' })
    await changeSurvey(world, [{ op: 'remove', entity: 'The Lighthouse' }])
    expect((await showSurvey(world, 'entities')).entities).toHaveLength(1)
    const piece = ((await showSurvey(world, 'pieces')).pieces as { piece: string; roles: string[] }[]).find(entry => entry.roles[0] === 'world')!
    await changeSurvey(world, [{ op: 'piece', piece: piece.piece, roles: ['instruction'] }])
    expect(((await showSurvey(world, 'pieces')).pieces as { piece: string; roles: string[] }[]).find(entry => entry.piece === piece.piece)?.roles).toEqual(['instruction'])
  })

  it('makes all of the changes or none, and says every reason', async () => {
    await survey(fakeContext(answers), world)
    const error = await changeSurvey(world, [
      { op: 'rename', entity: 'old-tam', name: 'Quiet Tam' },
      { op: 'rename', entity: 'nobody', name: 'x' },
      { op: 'merge', entity: 'old-tam', into: 'The Lighthouse' },
      { op: 'kind', entity: 'old-tam', kind: 'animal' as never },
      { op: 'player', entity: 'The Lighthouse' },
      { op: 'piece', piece: 'entry:99', roles: ['character'] },
      { op: 'add', name: 'the player', kind: 'character' },
    ]).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(SurveyEditError)
    expect((error as SurveyEditError).problems).toHaveLength(6)
    expect((await showSurvey(world, 'entities')).entities?.[0]).toMatchObject({ name: 'Old Tam' })
    expect((await showSurvey(world, 'entities')).edited).toBe(false)
  })

  it('is refused before there is a survey, and a new survey starts over', async () => {
    await expect(changeSurvey(world, [{ op: 'remove', entity: 'x' }])).rejects.toThrow(ImportStateError)
    await survey(fakeContext(answers), world)
    await changeSurvey(world, [{ op: 'rename', entity: 'old-tam', name: 'Quiet Tam' }])
    await survey(fakeContext(answers), world)
    expect((await showSurvey(world, 'entities')).edited).toBe(false)
    expect((await importStatus(world)).stages.every(entry => entry.state === 'todo')).toBe(true)
  })
})

describe('what the assistant is told', () => {
  const text = (id: string, variables?: Record<string, string | number>): string => shippedText(id, 'en', { survey: 'import_survey', build: 'import_build', finish: 'import_finish', status: 'import_status', stage: 'import_stage', show: 'import_show', audit: 'import_audit', surveyShow: 'import_survey_show', surveyEdit: 'import_survey_edit', stages: STAGES.join(', '), ...variables })

  it('is the whole import in one turn when nothing pauses, and a conversation with the person when something does', () => {
    expect(importNotice('ready', text, 'never')).toContain('then import_build')
    const survey = importNotice('ready', text, 'survey')
    expect(survey).toContain('import_status')
    expect(survey).toContain('stop after the survey and report')
    expect(survey).not.toContain('then import_build')
    expect(importNotice('surveyed', text, 'stages')).toContain('after every stage')
    expect(importNotice('done', text, 'stages')).toContain('then import_build')
  })

  it('goes on to the next stage unless the import pauses at every stage', () => {
    const report = { stage: 'places', counts: { places: 2 }, staged: [], notes: [], notesTotal: 0, left: ['characters', 'things'], stale: ['factions'], complete: false } as never
    expect(nextAfterStage(text, { ...(report as object), pause: 'survey' } as never)).toContain('import_stage with stage "characters"')
    expect(nextAfterStage(text, { ...(report as object), pause: 'stages' } as never)).toContain('characters, factions, things')
    expect(nextAfterStage(text, { ...(report as object), left: [], stale: [], complete: true, pause: 'survey' } as never)).toContain('import_finish')
    expect(nextAfterStage(text, { ...(report as object), left: [], stale: [], complete: true, pause: 'stages' } as never)).toContain('nothing: the next step is import_finish')
  })

  it('does not stop at a stage that staged nothing and went wrong nowhere, while stages are still to run', () => {
    const quiet = { stage: 'factions', counts: {}, staged: [], notes: [], notesTotal: 0, left: ['things'], stale: [], complete: false, pause: 'stages' } as never
    const quietText = nextAfterStage(text, quiet)
    expect(quietText).toContain('do not stop')
    expect(quietText).toContain('import_stage with stage "things"')
    expect(nextAfterStage(text, { ...(quiet as object), notesTotal: 1 } as never)).toContain('Do not run the next stage')
    expect(nextAfterStage(text, { ...(quiet as object), counts: { factions: 2 } } as never)).toContain('Do not run the next stage')
    expect(nextAfterStage(text, { ...(quiet as object), left: [], complete: true } as never)).toContain('Do not run the next stage')
    const done = (at: string, counts: Record<string, number>, notes = 0) => ({ state: 'done', at, counts, notes })
    expect(pausesAfterStep('stages', [done('1', { places: 2 }), done('2', {}), { state: 'todo' }])).toBe(false)
    expect(pausesAfterStep('stages', [done('1', { places: 2 }), done('2', {}, 1), { state: 'todo' }])).toBe(true)
    expect(pausesAfterStep('stages', [done('1', { places: 2 }), done('2', {})])).toBe(true)
    expect(pausesAfterStep('stages', [done('1', {}), done('2', { places: 2 }), { state: 'todo' }])).toBe(true)
  })

  it('uses the survey-only pause once, before any stage has started', () => {
    expect(pausesAfterStep('never', [])).toBe(false)
    expect(pausesAfterStep('survey', STAGES.map(() => ({ state: 'todo' })))).toBe(true)
    expect(pausesAfterStep('survey', [{ state: 'done' }, { state: 'todo' }])).toBe(false)
    expect(pausesAfterStep('stages', [{ state: 'done' }])).toBe(true)
  })
})
