import { describe, expect, it } from 'vitest'
import { parseSampling, sharedSamplingOf } from '../../src/shared/sampling.ts'

describe('sampling a preset or a world asks for', () => {
  it('reads the controls it knows, in range', () => {
    const problems: string[] = []
    expect(parseSampling({ master: 0.7, topP: 0.9, topK: 40, minP: 0.05, frequencyPenalty: -0.5, presencePenalty: 1, repetitionPenalty: 1.1 }, 'sampling', problems)).toEqual({ master: 0.7, topP: 0.9, topK: 40, minP: 0.05, frequencyPenalty: -0.5, presencePenalty: 1, repetitionPenalty: 1.1 })
    expect(problems).toEqual([])
  })

  it('names every unknown control, out-of-range value and wrong shape', () => {
    const problems: string[] = []
    expect(parseSampling({ master: 5, topP: 'x', records: 0.1, topK: -1 }, 'sampling', problems)).toEqual({})
    expect(problems).toEqual(['sampling.records is not something that can be set (master, characters, topP, topK, minP, frequencyPenalty, presencePenalty, repetitionPenalty)', 'sampling.master must be a number from 0 to 2', 'sampling.topP must be a number from 0 to 1', 'sampling.topK must be a number from 0 to 1000'])
    const shape: string[] = []
    parseSampling([1], 'sampling', shape)
    expect(shape).toEqual(['sampling must be an object'])
    expect(parseSampling(undefined, 'sampling', [])).toEqual({})
  })

  it('sends a request only the controls that are not neutral, so the server\'s own choice stands', () => {
    expect(sharedSamplingOf({ topP: 1, topK: 0, minP: 0, frequencyPenalty: 0, presencePenalty: 0, repetitionPenalty: 1 })).toEqual({})
    expect(sharedSamplingOf({ topP: 0.9, topK: 0, minP: 0.1, frequencyPenalty: 0, presencePenalty: 0.5, repetitionPenalty: 1 })).toEqual({ topP: 0.9, minP: 0.1, presencePenalty: 0.5 })
  })
})
