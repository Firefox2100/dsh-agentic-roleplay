import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/host/checks/run.ts'
import { LARGE_CASES, PLANTED, fixture, type Kind } from './large-cases.ts'
import { LANGUAGES } from './language.ts'
import { tempWorld } from './write.ts'

const KINDS: readonly Kind[] = ['lore', 'variables', 'things', 'places', 'people']
const nameOf = (entry: { name?: string; title?: string }): string => (entry.name ?? entry.title ?? '').trim().toLowerCase()

describe.each(LANGUAGES)('the grown world (%s)', (language) => {
  const data = fixture(language)

  it('plants where the cases expect and nowhere else', () => {
    for (const kind of KINDS) {
      const found: Record<string, number[]> = {}
      for (const planted of data.planted[kind]) (found[planted.mode] ??= []).push(planted.index)
      expect(found).toEqual(PLANTED[kind])
    }
  })

  it('gives every entry a name of its own within its kind, so a planted pair is never hidden behind an equal name', () => {
    for (const kind of KINDS) {
      const names = [...data[kind], ...data.planted[kind].filter(planted => planted.mode !== 'conflict').map(planted => planted.item)].map(nameOf)
      expect(names.filter(name => name === ''), kind).toEqual([])
      expect(names.filter((name, at) => names.indexOf(name) !== at), kind).toEqual([])
    }
  })

  it('is a sound world to the checks that need no model', async () => {
    for (const benchmark of LARGE_CASES) {
      const world = await tempWorld(benchmark.build(language), { id: 'salt-harbor', name: benchmark.id })
      try {
        const report = await runChecks({ world: world.world }, {})
        expect(report.findings.filter(finding => finding.severity === 'error'), benchmark.id).toEqual([])
      } finally { await world.remove() }
    }
  })
})
