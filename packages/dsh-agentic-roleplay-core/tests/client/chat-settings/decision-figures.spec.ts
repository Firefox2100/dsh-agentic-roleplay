import { describe, expect, it } from 'vitest'
import { agreement, perRun } from '../../../src/client/chat-settings/decision-figures.ts'

describe('the figures of the decisions section', () => {
  it('shows the average time of a run, or a dash before the site has run', () => {
    expect(perRun(1250, 5)).toBe('250 ms')
    expect(perRun(10, 3)).toBe('3 ms')
    expect(perRun(0, 0)).toBe('–')
  })

  it('shows the share of compared judgements the two models made alike, or a dash when none were compared', () => {
    expect(agreement({ agreed: 9, disagreed: 1 })).toBe('90%')
    expect(agreement({ agreed: 1, disagreed: 2 })).toBe('33%')
    expect(agreement({ agreed: 0, disagreed: 0 })).toBe('–')
  })
})
