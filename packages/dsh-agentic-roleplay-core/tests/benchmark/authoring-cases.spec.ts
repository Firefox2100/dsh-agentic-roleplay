import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTHORING, authoringCases, authoringProblems, seedWorld, type AuthoringId } from './authoring-cases.ts'
import { LANGUAGES } from './language.ts'
import { writeFiles } from './write.ts'

/** The offline half of the authoring benchmark: the seed is a world a story could start from, and each case's oracle fails on the seed and holds on a world the request was carried out in. The live half is `authoring.spec.ts`. */
const made: string[] = []
afterEach(async () => { for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function world(language: (typeof LANGUAGES)[number], extra: Record<string, unknown> = {}, over: Record<string, unknown> = {}, planted?: (files: ReturnType<typeof seedWorld>) => void): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'authoring-'))
  made.push(directory)
  const files = seedWorld(language)
  planted?.(files)
  files.set('world.json', { ...(files.get('world.json') as object), ...over })
  await writeFiles(directory, files)
  for (const [path, value] of Object.entries(extra)) { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), JSON.stringify(value)) }
  return directory
}

const outcome = (id: AuthoringId, language: (typeof LANGUAGES)[number]): [Record<string, unknown>, Record<string, unknown>] => {
  const p = (en: string, zh: string): string => (language === 'en' ? en : zh)
  switch (id) {
    case 'character': return [{ 'characters/smith/character.json': { name: p('Dunn', '老丁'), role: 'npc', summary: p('Smith.', '铁匠。'), start: { location: 'yard' } } }, {}]
    case 'variable': return [{ 'variables.json': [{ key: 'mood', name: 'Mood', kind: 'number', subject: 'world', visibility: 'public', min: 0, max: 10, default: 5, update: 'Changes with news.' }] }, {}]
    case 'command': return [{ 'commands.json': { commands: [{ word: 'haggle', description: 'Bargain.' }] } }, {}]
    case 'dice': return [{ 'dice.json': { checks: [{ key: 'str', name: 'Strength', use: 'lifting', dice: '2d6', bands: [{ label: 'ok', result: 'succeeded', min: 8 }, { label: 'no', result: 'failed', max: 7 }] }] } }, {}]
    case 'question': return [{}, { start_questions: [{ id: 'when', text: 'When?', options: [{ id: 'a', label: 'Morning', effect: {} }, { id: 'b', label: 'Evening', effect: {} }] }] }]
    case 'holiday': return [{ 'calendar.json': { hemisphere: 'north', holidays: [{ id: 'harvest', name: 'Harvest', on: ['09-21'] }] } }, {}]
    case 'opening': return [{}, { opening_message: p('A heron stands by the weir.', '一只苍鹭站在堰边。') }]
    case 'overreach': return [{}, {}]
    case 'check': return [{ 'characters/miller/character.json': { name: p('Hale the Miller', '老葛'), role: 'npc', summary: p('Runs the mill.', '经营磨坊。'), start: { location: 'mill' } } }, {}]
  }
}

describe.each(LANGUAGES)('authoring requests (%s)', (language) => {
  const cases = authoringCases(language)
  const seed = (directory: string) => ({ directory, seedCharacters: ['visitor', 'miller'], seedTools: undefined })

  it('has a case of every kind, each with a request and the world check', () => {
    expect(cases.map(entry => entry.kind)).toEqual([...AUTHORING])
    for (const entry of cases) { expect(entry.message.length).toBeGreaterThan(10); expect(entry.expect.at(-1)).toEqual({ type: 'valid' }) }
  })

  it('starts from a world a story could start from', async () => {
    expect(await authoringProblems([{ type: 'valid' }], seed(await world(language)))).toEqual([])
  })

  it.each(AUTHORING)('%s: fails on the seed unless it asks to leave things alone, and holds once the request is carried out', async (id) => {
    const entry = cases.find(candidate => candidate.kind === id)!
    const untouched = await authoringProblems(entry.expect, seed(await world(language, {}, {}, entry.seed)))
    expect(untouched.length > 0, 'the oracle sees nothing wrong with the seed').toBe(id !== 'overreach')
    const [files, info] = outcome(id, language)
    expect(await authoringProblems(entry.expect, seed(await world(language, files, info, entry.seed)))).toEqual([])
  })

  it('sees an assistant that overreached', async () => {
    const entry = cases.find(candidate => candidate.kind === 'overreach')!
    expect(await authoringProblems(entry.expect, seed(await world(language, {}, { autonomy: true })))).toEqual(['the assistant switched autonomy on'])
    expect(await authoringProblems(entry.expect, seed(await world(language, {}, { tools: { gameMaster: { shell: true } } })))).toEqual(['the assistant changed the tool switches'])
  })

  it('sees a character put where the world has no place, and a world the request left unstartable', async () => {
    const entry = cases.find(candidate => candidate.kind === 'character')!
    const nowhere = { 'characters/smith/character.json': { name: language === 'en' ? 'Dunn' : '老丁', role: 'npc', summary: 'x', start: { location: 'moon' } } }
    const problems = await authoringProblems(entry.expect, seed(await world(language, nowhere)))
    expect(problems.some(problem => problem.includes('starts in none'))).toBe(true)
    expect(problems.some(problem => problem.includes('no longer startable'))).toBe(true)
  })
})
