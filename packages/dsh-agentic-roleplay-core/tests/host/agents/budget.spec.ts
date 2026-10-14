import { describe, expect, it } from 'vitest'
import { estimateAnswer, outputBudget, tokensOf } from '../../../src/host/agents/budget.ts'
import { answerEstimate, answerLimits } from '../../../src/host/orchestration/protocol.ts'

describe('how much an answer may produce', () => {
  it('counts a character of a script written without spaces as about one and a half tokens, of the others about a third', () => {
    expect(tokensOf(300, 'en')).toBe(100)
    expect(tokensOf(300, 'zh')).toBe(450)
    expect(tokensOf(300, 'zh-Hans')).toBe(450)
  })

  it('is the estimate with room to spare, rounded up to ten', () => {
    expect(outputBudget(404, 2)).toBe(810)
    expect(outputBudget(100, 1)).toBe(100)
  })

  it('adds up the declared limits of the texts of an answer and the shape that holds them', () => {
    expect(estimateAnswer([30, 60], 'en')).toBe(10 + 8 + 20 + 8)
  })

  it('says what a character answer comes to from the limits the instructions state, more with an account of what happened out of sight', () => {
    expect(answerEstimate('en', false)).toBe(404)
    expect(answerEstimate('en', true)).toBe(512)
    expect(answerEstimate('zh', false)).toBe(714)
    expect(answerLimits('zh-CN').utterance).toBeLessThan(answerLimits('en').utterance)
  })
})
