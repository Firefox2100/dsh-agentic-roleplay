import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionStore, type SessionStore } from 'dsh-roleplay-state'
import type { PlotDefinition } from 'dsh-roleplay-model'
import type { TurnStore } from '../../../src/host/orchestration/boundaries.ts'
import { describePacingAdvice, pacingAdvice, populatePlots, updatePlotProgress } from '../../../src/host/pacing/director.ts'
import { parsePlotsFile } from '../../../src/host/plots/load.ts'

const plot: PlotDefinition = {
  id: 'keeper', name: 'The Missing Keeper', premise: 'The lighthouse keeper vanished.', themes: ['secrecy'],
  hooks: [{ id: 'lamp', text: 'The lamp fails.', mode: 'opportunity', prerequisites: [], guidance: 'Let the failed lamp become noticeable.', avoid: ['Do not reveal why it failed'] }],
  developments: [{ id: 'signal', text: 'A coded signal appears.', mode: 'reminder', prerequisites: ['lamp'], guidance: 'A repeating light can be noticed.', avoid: [] }],
  stakes: ['Ships may founder'], resolutions: ['Find the keeper'], participants: ['lighthouse'], start: 'available',
  pacing: { quietTurns: 3, cooldownTurns: 4, cooldownDays: 0 },
}

describe('plot files', () => {
  it('reads branching opportunities and pacing policy', () => {
    const parsed = parsePlotsFile(JSON.stringify([plot]))
    expect(parsed).toMatchObject({ ok: true, value: [{ id: 'keeper', hooks: [{ id: 'lamp' }], pacing: { quietTurns: 3 } }] })
  })

  it('rejects prerequisites that name no development', () => {
    const parsed = parsePlotsFile(JSON.stringify([{ ...plot, developments: [{ ...plot.developments[0], prerequisites: ['missing'] }] }]))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues.some(issue => issue.message.includes('unknown development'))).toBe(true)
  })
})

describe('the pacing director', () => {
  let session: SessionStore
  let store: TurnStore
  beforeEach(() => {
    session = createSessionStore(':memory:', { id: 's', name: 'S', world: { id: 'w', name: 'W' } })
    store = { story: session } as unknown as TurnStore
    populatePlots(session.metadata, [plot])
  })
  afterEach(() => session.close())

  it('stays quiet until the configured quiet window and then offers advice without completing it', () => {
    expect(pacingAdvice(store, 3)).toBeUndefined()
    const advice = pacingAdvice(store, 4)
    expect(advice).toMatchObject({ plot: 'keeper', development: 'lamp', mode: 'opportunity' })
    expect(describePacingAdvice(advice!)).toContain('advice only, not an event')
    expect(pacingAdvice(store, 5)).toBeUndefined()
  })

  it('unlocks a dependent possibility only after actual progress is recorded', () => {
    expect(pacingAdvice(store, 4)?.development).toBe('lamp')
    updatePlotProgress(store, 'keeper', 'lamp', 'introduced')
    expect(pacingAdvice(store, 8)?.development).toBe('signal')
  })

  it('does not immediately rephrase a rejected hook', () => {
    updatePlotProgress(store, 'keeper', 'lamp', 'rejected')
    expect(pacingAdvice(store, 4)).toBeUndefined()
  })
})
