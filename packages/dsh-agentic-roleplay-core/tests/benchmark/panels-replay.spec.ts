import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { replayContext } from './replay.ts'
import { DIRECTIVE, importCard } from './panels-run.ts'
import { leaks, panelCards, type PanelStyle } from './panel-cards.ts'
import type { Language } from './language.ts'
import { Trace, auditTrace, readTrace } from './trace.ts'

/**
 * Replays recorded runs of the status-panel benchmark: every import in a folder of traces (`BENCH_REPLAY_DIR`) is run again with the model answering from its recording, and the
 * verdicts on the world that comes out must be those the live run reached. It is how a failure seen once in a live run is looked at again without the model, and how a change to the
 * importer or the oracle is tried against what the model really said:
 *
 *   BENCH_REPLAY_DIR=eval/results/traces/panels npx vitest run tests/benchmark/panels-replay.spec.ts
 */
const folder = process.env['BENCH_REPLAY_DIR']
const files = folder === undefined ? [] : readdirSync(folder).filter(name => name.endsWith('.jsonl')).sort()

describe.skipIf(folder === undefined)('replaying recorded panel imports', () => {
  it.each(files.map(name => [name] as const))('%s', async (name) => {
    const events = readTrace(readFileSync(join(folder!, name), 'utf8'))
    expect(auditTrace(events)).toEqual([])
    const header = events[0] as unknown as { id: string; language: Language }
    const style = (/-(fence|html|tags|state)-\d+\.jsonl$/.exec(name)?.[1] ?? header.id) as PanelStyle
    const made = panelCards(header.language).find(card => card.style === style)!
    const world = await importCard(made, replayContext(events, header.language), Trace.off)
    const leaked = world.texts.filter(entry => leaks(entry.text.replace(/\$\{[^}]*\}/g, ''))).map(entry => entry.where)
    const directives = world.texts.filter(entry => DIRECTIVE[header.language].test(entry.text)).map(entry => entry.where)
    const recorded = Object.fromEntries(events.filter(event => event.kind === 'expect').map(event => [String(event['name']), event['held']]))
    expect(leaked.length === 0, 'the verdict on panels in the world').toBe(recorded['no panel, tag block, placeholder or update call in the world'])
    expect(directives.length === 0, 'the verdict on print-this sentences').toBe(recorded['nothing tells the game master to print a panel'])
  }, 300_000)
})
