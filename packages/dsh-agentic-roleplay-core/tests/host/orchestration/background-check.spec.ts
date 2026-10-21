import { describe, expect, it } from 'vitest'
import { BACKGROUND_CHECK, submitGate } from '../../../src/host/orchestration/character-runner.ts'

const answer = { thought: 'Hm.', intent: 'I nod.', utterance: 'Yes.' }

describe('the check before a character answers', () => {
  it('refuses the first answer of a character with background to read, once, and then lets it through', () => {
    const gate = submitGate('en', true)
    expect(gate(answer)).toBe(BACKGROUND_CHECK)
    expect(gate(answer)).toBeUndefined()
    expect(gate(answer)).toBeUndefined()
  })

  it('does not ask a character that has no background to read', () => {
    expect(submitGate('en', false)(answer)).toBeUndefined()
  })

  it('keeps the other checks after the question: the answer is still refused in the wrong language', () => {
    const gate = submitGate('zh', true)
    gate(answer)
    expect(gate({ thought: 'He is testing me, I will answer plainly.', intent: 'I look at him calmly and answer.', utterance: 'I am good at first aid and other practical things.' })).toContain('Chinese')
  })
})
