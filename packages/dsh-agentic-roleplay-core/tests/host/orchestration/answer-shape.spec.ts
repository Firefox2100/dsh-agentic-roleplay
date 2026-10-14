import { describe, expect, it } from 'vitest'
import { sharedContext } from '../../../src/host/orchestration/defaults.ts'
import { AWAY_ACTION_SCHEMA, CHARACTER_ACTION_SCHEMA, parseCharacterAction } from '../../../src/host/orchestration/protocol.ts'
import type { CharacterRequest } from '../../../src/host/orchestration/boundaries.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { alice, arthur } from './fixtures.ts'
import { renderAttempt } from '../../../src/host/orchestration/tools.ts'
import type { AttemptReport } from '../../../src/host/orchestration/turn-engine.ts'

const request = (language: string): CharacterRequest => ({ member: alice, cast: [arthur, alice], situation: 'Arthur orders a drink.', attempt: 1, turn: 1, lookup: false, language, text: (id, variables) => shippedText(id, language, variables) })

describe('what a character is asked to answer', () => {
  it('is a thought first, then the choice, with the limits of each text stated in the language of the story', () => {
    expect(Object.keys(CHARACTER_ACTION_SCHEMA.properties!)).toEqual(['thought', 'intent', 'utterance', 'commitment'])
    expect(Object.keys(AWAY_ACTION_SCHEMA.properties!).slice(0, 2)).toEqual(['thought', 'intent'])
    expect(sharedContext.brief(request('en')).persona).toMatch(/thought \(first.*at most 240 characters.*intent \(.*at most 300 characters.*utterance \(.*at most 600 characters/s)
    expect(sharedContext.brief(request('zh')).persona).toMatch(/thought.*最多100个字.*intent.*最多120个字.*utterance.*最多240个字/s)
  })

  it('does not depend on the thought: an engine that does not write fields in order, or leaves it out, gives the same answer, and it is kept out of the result', () => {
    expect(CHARACTER_ACTION_SCHEMA.required).toEqual(['thought', 'intent', 'commitment'])
    const plain = parseCharacterAction({ intent: 'Alice pours a drink.', commitment: 'low' })
    expect(parseCharacterAction({ thought: 'He looks tired.', intent: 'Alice pours a drink.', commitment: 'low' })).toEqual(plain)
    expect(JSON.stringify(plain)).not.toContain('tired')
  })
})

describe('what the game master is told when a character could not act', () => {
  const attempt = (failures: AttemptReport['failures']): AttemptReport => ({ attempt: 1, reports: [{ character: 'alice', name: 'Alice', intent: 'pours a drink', commitment: 'low' }], failures })

  it('does not hear the reason of a fault of the system, so that it cannot be written into the story, but does hear one it can act on', () => {
    const told = renderAttempt(attempt([
      { character: 'bob', name: 'Bob', reason: 'the agent went on past its 5 calls without submitting a result and was stopped', technical: true },
      { character: 'carol', name: 'Carol', reason: 'cannot speak: gagged' },
    ]))
    expect(told).toContain('Bob): no decision came back. That is a fault of the system, not something that happened in the story')
    expect(told).toContain('write nothing for them')
    expect(told).not.toContain('past its 5 calls')
    expect(told).toContain('- carol (Carol): cannot speak: gagged')
  })
})
