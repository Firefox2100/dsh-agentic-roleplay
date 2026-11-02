import { describe, expect, it } from 'vitest'
import { runChecks } from '../../src/host/checks/run.ts'
import { loadCardEvidence } from '../../src/host/checks/card-evidence.ts'
import { BASELINE, CODE_CASES, FIDELITY_CODE_CASES, UPDATE_CASES, matches } from './cases.ts'
import { LANGUAGES } from './language.ts'
import { SALT_HARBOR_ID } from './salt-harbor.ts'
import { tempWorld } from './write.ts'

/** Each case of the benchmark that the program alone decides: the checks find what the case plants, in both languages, and nothing else. */
describe.each(LANGUAGES)('the defects of the benchmark world that code finds (%s)', (language) => {
  for (const benchmark of [...CODE_CASES, ...FIDELITY_CODE_CASES, ...UPDATE_CASES]) {
    it(`${benchmark.id}: ${benchmark.title}`, async () => {
      const world = await tempWorld(benchmark.build(language), { id: SALT_HARBOR_ID[language], name: benchmark.id })
      try {
        const card = benchmark.card === undefined ? undefined : await loadCardEvidence(world.directory, benchmark.card)
        const report = await runChecks({ world: world.world, ...(card === undefined ? {} : { card }) }, { ids: benchmark.checks })
        const allowed = [...benchmark.card === undefined ? BASELINE : [], ...benchmark.allowed ?? []]
        const found = report.findings
        const missing = benchmark.expect.filter(want => !found.some(finding => matches(finding, want)))
        const extra = found.filter(finding => !benchmark.expect.some(want => matches(finding, want)) && !allowed.some(ok => matches(finding, ok)))
        expect({ missing, extra: extra.map(finding => `${finding.check} ${finding.code} ${finding.where}: ${finding.message}`) }).toEqual({ missing: [], extra: [] })
      } finally { await world.remove() }
    })
  }
})
