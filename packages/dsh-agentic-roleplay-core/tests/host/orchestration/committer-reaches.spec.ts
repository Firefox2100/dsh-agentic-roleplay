import { describe, expect, it } from 'vitest'
import { describePrompt } from '../../../src/host/orchestration/committer.ts'
import { ATTRIBUTION_CASES } from '../../benchmark/attribution-cases.ts'
import { jobOf } from '../../benchmark/attribution.ts'
import { DEFAULT_SETTINGS } from '../../../src/shared/settings.ts'

describe('the keeper\'s brief for a character asked from elsewhere', () => {
  it('says how the moment reached it and what it perceived over that, and says nothing of it otherwise', () => {
    const { job } = jobOf(ATTRIBUTION_CASES[0]!, 'en')
    expect(describePrompt(job, DEFAULT_SETTINGS.memory)).not.toContain('Asked from elsewhere')
    const reached = { ...job, rounds: [{ ...job.rounds[0]!, reaches: [{ character: 'odile', how: 'a phone call' }] }] }
    expect(describePrompt(reached, DEFAULT_SETTINGS.memory)).toMatch(/Asked from elsewhere, reached by what is given: .*\(odile\) by a phone call\. Such a character perceived the player's words/)
  })
})
