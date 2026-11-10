import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/host/checks/run.ts'
import { coverage, describeCoverage, loadData, validateData, worldOfRow } from './framework/index.ts'
import { tempWorld } from './write.ts'

/**
 * The data of the benchmark framework (`data/`): every world, layer and row is sound, every row's composed world passes the program's own validity checks, and the coverage report
 * says what is still seen once. Adding data adds rows here without touching this file.
 */
const data = loadData()
/** Every check the program alone decides: a composed world has none of their findings, but the one way in the base world that goes one direction on purpose. */
const CODE_CHECKS = ['world-valid', 'world-graph', 'duplicate-values', 'name-clashes', 'name-confusable', 'world-prompts', 'unread-fields', 'quality-cast', 'quality-places', 'quality-world', 'quality-panels', 'first-scene']

describe('the benchmark data', () => {
  it('is sound: no unknown layer, missing requirement, conflict, wrong claim, wrong cast size or missing script', () => {
    expect(validateData(data)).toEqual([])
  })

  it('has rows to run', () => {
    expect(data.rows.length).toBeGreaterThan(0)
  })

  it.each(data.rows.map(row => [row.id, row] as const))('composes %s into a world the program finds nothing wrong with', async (_id, row) => {
    const composed = worldOfRow(data, row)
    expect(composed.problems).toEqual([])
    const world = await tempWorld(composed.files, { id: `${row.world}-${row.language}`, name: row.id })
    try {
      const report = await runChecks({ world: world.world }, { ids: CODE_CHECKS })
      // a night start puts the player alone with a sleeper on purpose: nothing answers until the player acts or wakes someone
      const alone = row.layers.includes('night-start') || row.layers.includes('late-start')
      const found = report.findings.filter(finding => finding.code !== 'exit-no-way-back' && !(alone && finding.code === 'start-alone'))
      const flagged = row.plant?.finds
      expect(found.filter(finding => finding.check !== flagged).map(finding => `${finding.check} ${finding.code} ${finding.where}: ${finding.message}`)).toEqual([])
      if (flagged !== undefined) expect(found.some(finding => finding.check === flagged), `the program's check ${flagged} should flag the planted fault`).toBe(true)
    } finally { await world.remove() }
  })

  it('reports what the rows cover and what they do not', () => {
    const report = coverage(data)
    expect(report.features.map(entry => entry.feature)).toContain('variables')
    console.log(describeCoverage(report))
  })
})
