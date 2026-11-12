import { describe, expect, it } from 'vitest'
import { LANGUAGES } from './language.ts'
import { OPENING_KINDS, openingCases, openingProblems, type OpeningCase } from './opening-cases.ts'
import type { ShapedOpening } from '../../src/host/import/opening-parts.ts'

/** The offline half of the opening benchmark: the cases are balanced and the oracle sees what a right and a wrong shaping look like. The live half is `openings.spec.ts`. */
describe.each(LANGUAGES)('opening cases (%s)', (language) => {
  const cases = openingCases(language)

  it('cover every kind, with unique ids, and every labelled word is in its passage', () => {
    expect(new Set(cases.map(entry => entry.id)).size).toBe(cases.length)
    for (const kind of OPENING_KINDS) expect(cases.filter(entry => entry.kind === kind).length, kind).toBeGreaterThan(0)
    for (const entry of cases) {
      for (const line of entry.expect.lines ?? []) expect(entry.passage, entry.id).toContain(line.contains)
      for (const text of entry.expect.narrated ?? []) expect(entry.passage, entry.id).toContain(text)
    }
  })

  const answer = (entry: OpeningCase): ShapedOpening => {
    if (!entry.expect.speech) return { text: entry.passage }
    const parts = entry.passage.split('\n').map(line => {
      const found = entry.expect.lines?.find(candidate => line.includes(candidate.contains))
      return found === undefined ? { type: 'narration' as const, text: line } : { type: 'utterance' as const, character: found.character, text: line }
    })
    return { text: entry.passage, parts }
  }

  it('holds a right shaping of every case, with the lines kept apart in the one-line cases split on their own lines', () => {
    for (const entry of cases.filter(candidate => candidate.passage.includes('\n') || !candidate.expect.speech)) expect(openingProblems(entry, answer(entry)), entry.id).toEqual([])
  })

  it('sees a speech case left plain, a narration given lines, speech given to someone, a changed word, and the player made to speak', () => {
    const speech = cases.find(entry => entry.id.startsWith('unmarked'))!
    expect(openingProblems(speech, { text: speech.passage })).toEqual(['no one speaks in the result, but someone should', expect.stringContaining('is not spoken by alice')])
    const narration = cases.find(entry => entry.id.startsWith('scenery'))!
    expect(openingProblems(narration, { text: narration.passage, parts: [{ type: 'utterance', character: 'bram', text: narration.passage }] })).toEqual(['lines were given to characters in a pure narration'])
    const stranger = cases.find(entry => entry.id.startsWith('stranger'))!
    expect(openingProblems(stranger, { text: stranger.passage, parts: [{ type: 'utterance', character: 'bram', text: stranger.passage }] }).join(' ')).toMatch(/nobody can be named/)
    expect(openingProblems(narration, { text: 'something else' })).toEqual(['the words changed'])
    expect(openingProblems(speech, { text: speech.passage, parts: [{ type: 'utterance', character: 'you', text: speech.passage }] }).join(' ')).toMatch(/player/)
  })
})
