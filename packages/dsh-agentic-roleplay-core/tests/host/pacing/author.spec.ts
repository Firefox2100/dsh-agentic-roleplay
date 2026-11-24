import { describe, expect, it } from 'vitest'
import { mendPlot } from '../../../src/host/pacing/author.ts'

const plot = (hook: string, developments: [string, string][], resolutions: string[]) => ({
  id: 'p', name: 'n', builds_on: [], themes: [], stakes: [], participants: [],
  hook: { id: 'h', text: hook, guidance: '', avoid: [] },
  developments: developments.map(([id, text], index) => ({ id, text, mode: 'opportunity' as const, prerequisites: index > 0 ? [developments[0]![0]] : [], guidance: '', avoid: [] })),
  resolutions,
})

describe('what a plot may say of the player\'s character', () => {
  it('cuts the sentence that names the character from a hook, and leaves the rest', () => {
    const mended = mendPlot(plot('Pavel waits at the door. Mara arrives and he turns to her.', [], []), ['Mara'])
    expect(mended).toMatchObject({ plot: { hook: { text: 'Pavel waits at the door.' } }, cut: ['the hook'] })
  })

  it('drops a development that is only about the character, and the prerequisites that pointed at it', () => {
    const mended = mendPlot(plot('Pavel waits.', [['d1', 'Mara reads the letter aloud.'], ['d2', 'Odile lends a lamp.']], []), ['Mara'])
    expect(mended).toMatchObject({ plot: { developments: [{ id: 'd2', prerequisites: [] }] }, cut: ['development d1 (dropped)'] })
  })

  it('treats the generic term like a name in a hook or development, and lets a resolution use it as a condition', () => {
    const mended = mendPlot(plot('Pavel waits.', [['d1', 'Odile offers the Player\'s character a lamp.']], ['If the player\'s character pays, Pavel leaves.', 'Lin walks away.']), ['Lin'], ['player'])
    expect(mended).toMatchObject({ plot: { developments: [], resolutions: ['If the player\'s character pays, Pavel leaves.'] }, cut: ['development d1 (dropped)', 'resolution 2 (dropped)'] })
  })

  it('refuses a plot with nothing left of its hook, and changes nothing when the character is not named', () => {
    expect(mendPlot(plot('Mara waits.', [], []), ['Mara'])).toHaveProperty('refusal')
    expect(mendPlot(plot('Pavel waits.', [['d1', 'Odile lends a lamp.']], ['Pavel leaves.']), ['Mara'])).toMatchObject({ cut: [] })
    expect(mendPlot(plot('Mara waits.', [], []), [])).toMatchObject({ cut: [] })
  })
})
