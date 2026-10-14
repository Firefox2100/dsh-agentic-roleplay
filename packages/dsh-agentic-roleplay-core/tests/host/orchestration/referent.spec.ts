import { describe, expect, it } from 'vitest'
import { castSummary, sharedContext } from '../../../src/host/orchestration/defaults.ts'
import { referent } from '../../../src/host/orchestration/referent.ts'
import type { CastMember, CharacterRequest } from '../../../src/host/orchestration/boundaries.ts'
import { shippedText } from '../../../src/host/prompts/library.ts'
import { alice, arthur, bob } from './fixtures.ts'

const withMark = (member: CastMember, mark: { pronouns?: string; gender?: string }): CastMember => ({ ...member, character: { ...member.character, ...mark } })

describe('how a person is named in text that may say what they do', () => {
  it('carries the pronouns, or the gender when only that is given, and nothing made up otherwise', () => {
    expect(referent({ name: 'Clara', pronouns: 'she/her', gender: 'female' })).toBe('Clara (she/her)')
    expect(referent({ name: 'Clara', gender: 'female' })).toBe('Clara (female)')
    expect(referent({ name: 'Clara', pronouns: '  ' })).toBe('Clara')
    expect(referent({ name: 'Clara' })).toBe('Clara')
  })

  it('is in what a character is told of the others present, but not of itself', () => {
    const cast = [withMark(arthur, { pronouns: 'he/him' }), withMark(alice, { pronouns: 'she/her' }), bob]
    const request: CharacterRequest = { member: cast[1]!, cast, situation: 'Arthur orders a drink.', attempt: 1, turn: 2, lookup: false, text: (id, variables) => shippedText(id, 'en', variables) }
    const { prompt } = sharedContext.brief(request)
    expect(prompt).toContain('- Arthur (he/him)')
    expect(prompt).toContain('- Alice (you)')
    expect(prompt).not.toContain('Alice (she/her)')
    expect(prompt).toMatch(/- Bob\b/)
  })

  it('is in what the game master is told of the cast', () => {
    const cast = [withMark(arthur, { pronouns: 'he/him' }), bob]
    const notice = castSummary.scene({ cast, turn: 1, input: 'I look around.', story: { relationships: { get: () => undefined }, intents: { list: () => [] }, factionMemberships: { ofCharacter: () => [] }, factionIntents: { list: () => [] }, threads: { list: () => [] }, summaries: { list: () => [] } } as never })
    expect(String(notice)).toContain('Arthur (he/him)')
  })
})
