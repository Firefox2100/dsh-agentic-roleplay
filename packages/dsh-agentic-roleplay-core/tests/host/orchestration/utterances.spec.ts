import { describe, expect, it } from 'vitest'
import { exactUtterances, sameWords } from '../../../src/host/orchestration/defaults.ts'
import type { NarrationSegment, Utterance } from '../../../src/host/orchestration/protocol.ts'
import { parseCharacterAction } from '../../../src/host/orchestration/protocol.ts'

const required: Utterance[] = [
  { character: 'alice', name: 'Alice', text: 'That is not something I expected.', round: 1 },
  { character: 'bob', name: 'Bob', text: 'Easy now.', round: 1 },
]
const say = (character: string, text: string): NarrationSegment => ({ type: 'utterance', character, name: character, text })
const narrate = (text: string): NarrationSegment => ({ type: 'narration', text })

describe('sameWords', () => {
  it('ignores quotation marks around the words and how whitespace is laid out, nothing else', () => {
    expect(sameWords('“That is   not something I expected.”', 'That is not something I expected.')).toBe(true)
    expect(sameWords('"Easy now."', ' Easy now. ')).toBe(true)
    expect(sameWords('Easy now', 'Easy now.')).toBe(false)
    expect(sameWords('Easy, now.', 'Easy now.')).toBe(false)
  })
})

describe('exactUtterances', () => {
  it('accepts every utterance once, exactly, with narration anywhere', () => {
    expect(exactUtterances.check([narrate('Dusk.'), say('alice', 'That is not something I expected.'), narrate('Pause.'), say('bob', 'Easy now.')], required)).toEqual([])
    expect(exactUtterances.check([narrate('Quiet.')], [])).toEqual([])
  })

  it('names each way an utterance can go wrong', () => {
    const problems = exactUtterances.check([say('alice', 'Not what I expected.'), say('carol', 'Hello'), say('alice', 'again'), narrate('  ')], required)
    expect(problems).toEqual([
      'segment 1: the utterance of Alice was changed; it must be exactly "That is not something I expected."',
      'segment 2: carol has nothing to say this turn, so this utterance is invented; remove it',
      'segment 3: Alice has no more utterances to say; this one is repeated or invented, remove it',
      'segment 4: the narration is empty',
      'the utterance of Bob is missing; it must appear exactly as "Easy now."',
    ])
  })

  describe('with several rounds', () => {
    const rounds: Utterance[] = [
      { character: 'alice', name: 'Alice', text: 'Welcome back.', round: 1 },
      { character: 'bob', name: 'Bob', text: 'Why is he here?', round: 2 },
      { character: 'alice', name: 'Alice', text: 'Not now, Bob.', round: 3 },
    ]

    it('lets a character speak more than once and wants every line, in the order spoken', () => {
      expect(exactUtterances.check([say('alice', 'Welcome back.'), narrate('x'), say('bob', 'Why is he here?'), say('alice', 'Not now, Bob.')], rounds)).toEqual([])
    })

    it('refuses lines from a later round before an earlier one', () => {
      expect(exactUtterances.check([say('bob', 'Why is he here?'), say('alice', 'Welcome back.'), say('alice', 'Not now, Bob.')], rounds)).toEqual([
        'segment 2: the utterance of Alice from round 1 comes after one from a later round; utterances keep the order they were spoken in',
      ])
    })

    it('takes a changed line for the next one the character still owes, and a missing one by its round', () => {
      expect(exactUtterances.check([say('alice', 'Welcome back.'), say('bob', 'Why is he here?'), say('alice', 'Go away.')], rounds)).toEqual([
        'segment 3: the utterance of Alice was changed; it must be exactly "Not now, Bob."',
      ])
      expect(exactUtterances.check([say('alice', 'Welcome back.'), say('alice', 'Not now, Bob.')], rounds)).toEqual([
        'the utterance of Bob (round 2) is missing; it must appear exactly as "Why is he here?"',
      ])
    })

    it('repairs by putting a missing line where its round belongs', () => {
      const repaired = exactUtterances.repair([say('alice', 'Welcome back.'), narrate('Time passes.'), say('alice', 'Not now, Bob.')], rounds)
      expect(repaired.map(segment => (segment.type === 'utterance' ? segment.text : segment.text))).toEqual([
        'Welcome back.', 'Time passes.', 'Why is he here?', 'Not now, Bob.',
      ])
      expect(exactUtterances.check(repaired, rounds)).toEqual([])
    })
  })

  it('repairs by restoring the words, dropping invented and repeated utterances and adding missing ones', () => {
    const repaired = exactUtterances.repair([narrate('Dusk.'), say('alice', '"That is not something I expected"'), say('carol', 'Hello'), say('alice', 'again'), narrate('')], required)
    expect(repaired).toEqual([
      narrate('Dusk.'),
      { type: 'utterance', character: 'alice', name: 'Alice', text: 'That is not something I expected.' },
      { type: 'utterance', character: 'bob', name: 'Bob', text: 'Easy now.' },
    ])
    expect(exactUtterances.check(repaired, required)).toEqual([])
  })
})

describe('parseCharacterAction', () => {
  it('keeps what the character says and drops an empty utterance', () => {
    expect(parseCharacterAction({ intent: ' stands ', utterance: ' Hello. ', commitment: 'low' })).toEqual({ intent: 'stands', utterance: 'Hello.', commitment: 'low' })
    expect(parseCharacterAction({ intent: 'stands', utterance: '  ', commitment: 'high' })).toEqual({ intent: 'stands', commitment: 'high' })
    expect(() => parseCharacterAction({ intent: 'x', utterance: 3, commitment: 'low' })).toThrow(/not text/)
    expect(() => parseCharacterAction({ intent: 'x', commitment: 'sure' })).toThrow(/unknown commitment/)
  })
})
