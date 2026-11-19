import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LANGUAGES, pick, type Files } from './language.ts'
import { TOOL_CASES, toolCases, toolSeed, toolWorldProblems } from './tool-cases.ts'
import { writeFiles } from './write.ts'

/** The offline half of the tools benchmark: the seed is a world a story could start from, each case's oracle sees what is wrong with it, and holds on a world the request was carried out in the right way (and not on one carried out the wrong way). The live half is `tools.spec.ts`. */
const made: string[] = []
afterEach(async () => { for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function worldOf(files: Files, extra: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tools-bench-'))
  made.push(directory)
  await writeFiles(directory, files)
  for (const [path, value] of Object.entries(extra)) { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), JSON.stringify(value)) }
  return directory
}

const changed = (files: Files, path: string, change: (value: any) => unknown): Files => { const copy = new Map(files); copy.set(path, change(structuredClone(copy.get(path)))); return copy }

/** A world in which the request was carried out as a small change. */
function carriedOut(kind: (typeof TOOL_CASES)[number], language: (typeof LANGUAGES)[number]): [Files, Record<string, unknown>] {
  const p = pick(language)
  const seed = toolSeed(language)
  switch (kind) {
    case 'edit-background': return [changed(seed, 'characters/miller/character.json', value => ({ ...value, background: `${value.background} ${p('His brother drowned at the weir.', '他的兄弟淹死在堰边。')}` })), {}]
    case 'relabel': return [changed(seed, 'characters/miller/character.json', value => ({ ...value, relationships: [{ ...value.relationships[0], label: p('old friend', '老朋友') }] })), {}]
    case 'one-plot': return [changed(seed, 'plots.json', value => [value[0], { ...value[1], premise: p('Someone cut the weir.', '有人弄断了堰坝。') }]), {}]
    case 'one-variable': return [changed(seed, 'variables.json', value => [value[0], { ...value[1], update: p('Falls as the mill grinds and when the weir is broken; rises at harvest.', '磨坊开工和堰坝损坏时下降，收获时上升。') }]), {}]
    case 'faction': return [seed, { 'factions/guild/faction.json': { name: p('Millers\' Guild', '磨坊行会'), summary: p('The mill-owners of the valley.', '山谷里的磨坊主们。') } }]
    case 'trigger': return [seed, { 'triggers.json': [{ key: 'bell', name: 'Bell', when: { type: 'place', character: 'visitor', location: 'mill' }, effects: [{ type: 'beat', text: p('The mill bell rings once.', '磨坊的钟响了一声。') }] }] }]
  }
}

describe.each(LANGUAGES)('tool-use requests (%s)', (language) => {
  const cases = toolCases(language)

  it('has a case of every kind, each with a request, the world check and a guide or a limit on failures', () => {
    expect(cases.map(entry => entry.kind)).toEqual([...TOOL_CASES])
    for (const entry of cases) { expect(entry.message.length).toBeGreaterThan(10); expect(entry.world.at(-1)).toEqual({ type: 'valid' }); expect(entry.tools.length).toBeGreaterThan(0) }
  })

  it('starts from a world a story could start from', async () => {
    expect(await toolWorldProblems([{ type: 'valid' }], await worldOf(toolSeed(language)), toolSeed(language))).toEqual([])
  })

  it.each(TOOL_CASES)('%s: the oracle sees the seed unchanged as not done, and holds once the request is carried out as a small change', async (kind) => {
    const entry = cases.find(candidate => candidate.kind === kind)!
    const seed = toolSeed(language)
    const untouched = await toolWorldProblems(entry.world, await worldOf(seed), seed)
    expect(untouched.length, 'the oracle sees nothing missing in the seed').toBeGreaterThan(0)
    const [files, extra] = carriedOut(kind, language)
    expect(await toolWorldProblems(entry.world, await worldOf(files, extra), seed)).toEqual([])
  })

  it('sees a small change made by rewriting what it should have left alone', async () => {
    const entry = cases.find(candidate => candidate.kind === 'edit-background')!
    const seed = toolSeed(language)
    const wrecked = changed(seed, 'characters/miller/character.json', value => ({ name: value.name, role: 'npc', summary: pick(language)('Runs the mill.', '经营磨坊。'), background: pick(language)('His brother died at the weir.', '他的兄弟死在堰边。'), start: value.start }))
    const problems = await toolWorldProblems(entry.world, await worldOf(wrecked), seed)
    expect(problems.some(problem => problem.includes('personality changed'))).toBe(true)
    expect(problems.some(problem => problem.includes('relationships changed'))).toBe(true)
  })

  it('sees a relationship changed by adding another beside it, and a plot list that lost a plot', async () => {
    const seed = toolSeed(language)
    const relabel = cases.find(candidate => candidate.kind === 'relabel')!
    const doubled = changed(seed, 'characters/miller/character.json', value => ({ ...value, relationships: [...value.relationships, { ...value.relationships[0], label: pick(language)('old friend', '老朋友') }] }))
    expect((await toolWorldProblems(relabel.world, await worldOf(doubled), seed)).some(problem => problem.includes('has 2 entries, not 1'))).toBe(true)
    const plot = cases.find(candidate => candidate.kind === 'one-plot')!
    const lost = changed(seed, 'plots.json', value => [{ ...value[1], premise: pick(language)('Someone cut the weir.', '有人弄断了堰坝。') }])
    expect((await toolWorldProblems(plot.world, await worldOf(lost), seed)).length).toBeGreaterThan(0)
  })
})
