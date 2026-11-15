import { describe, expect, it } from 'vitest'
import { decodeOutput, decodePreview, encodeOutput, encodePreview, wordsOf, type TurnOutput } from '../../src/shared/narration.ts'

const output: TurnOutput = {
  repaired: true,
  segments: [
    { type: 'narration', text: 'Dusk <settles> over "the" inn & more.' },
    { type: 'utterance', character: 'alice', name: 'Alice', text: 'That is not something I expected.' },
  ],
}

describe('the output carried in a tool result', () => {
  it('is read back exactly, wherever it sits in the text', () => {
    expect(decodeOutput(encodeOutput(output))).toEqual(output)
    expect(decodeOutput(`Delivered.\n${encodeOutput(output)}\nThe turn ends here.`)).toEqual(output)
  })

  it('carries a picture between the paragraphs, which a reader without pictures skips', () => {
    const shown: TurnOutput = { repaired: false, segments: [{ type: 'narration', text: 'Dusk.' }, { type: 'image', path: 'library/dock.png' }, { type: 'utterance', character: 'alice', name: 'Alice', text: 'Hello.' }] }
    expect(decodeOutput(encodeOutput(shown))).toEqual(shown)
    expect(wordsOf(shown.segments, segment => `${segment.name}: ${segment.text}`)).toEqual(['Dusk.', 'Alice: Hello.'])
    expect(decodeOutput('<roleplay-output>{"segments":[{"type":"image","path":""}],"repaired":false}</roleplay-output>')).toBeUndefined()
  })

  it('is nothing when the text carries none or carries something broken', () => {
    expect(decodeOutput('saved to database')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{not json}</roleplay-output>')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{"segments":[{"type":"utterance","text":"x"}],"repaired":false}</roleplay-output>')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{"segments":[],"repaired":"no"}</roleplay-output>')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{"segments":[]}')).toBeUndefined()
  })
})

describe('the preview carried in a tool result', () => {
  it('is read back exactly, wherever it sits in the text, and never mistaken for an output', () => {
    const text = 'Air goes still <for a second> & "Clara" looks up.\n\nHow will she answer?'
    expect(decodePreview(encodePreview(text))).toBe(text)
    expect(decodePreview(`Shown.\n${encodePreview(text)}\nNow go on.`)).toBe(text)
    expect(decodeOutput(encodePreview(text))).toBeUndefined()
    expect(decodePreview(encodeOutput(output))).toBeUndefined()
  })

  it('is nothing when the text carries none or carries something broken', () => {
    expect(decodePreview('saved')).toBeUndefined()
    expect(decodePreview('<roleplay-preview>{not json}</roleplay-preview>')).toBeUndefined()
    expect(decodePreview('<roleplay-preview>{"text":3}</roleplay-preview>')).toBeUndefined()
    expect(decodePreview('<roleplay-preview>{"text":"x"}')).toBeUndefined()
  })
})
