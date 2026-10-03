import { describe, expect, it } from 'vitest'
import { decodeOutput, encodeOutput, type TurnOutput } from '../../src/shared/narration.ts'

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

  it('is nothing when the text carries none or carries something broken', () => {
    expect(decodeOutput('saved to database')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{not json}</roleplay-output>')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{"segments":[{"type":"utterance","text":"x"}],"repaired":false}</roleplay-output>')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{"segments":[],"repaired":"no"}</roleplay-output>')).toBeUndefined()
    expect(decodeOutput('<roleplay-output>{"segments":[]}')).toBeUndefined()
  })
})
