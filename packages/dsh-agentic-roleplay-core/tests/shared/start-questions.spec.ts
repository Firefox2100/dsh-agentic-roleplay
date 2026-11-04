import { describe, expect, it } from 'vitest'
import { combineAnswers, type StartQuestion } from '../../src/shared/start-questions.ts'

const questions: StartQuestion[] = [
  { id: 'tone', text: 'Tone?', options: [{ id: 'grim', label: 'Grim', effect: { rules: ['No mercy'], tools: { gameMaster: { roll_dice: true } }, plots: { heist: 'available' } } }, { id: 'light', label: 'Light', effect: {} }] },
  { id: 'rolls', text: 'Dice?', options: [{ id: 'off', label: 'None', effect: { tools: { gameMaster: { roll_dice: false } } } }, { id: 'on', label: 'Some', effect: { rules: ['Roll when unsure'], tools: { characters: { x: true } } } }] },
]

describe('combineAnswers', () => {
  it('adds rules, merges tools and plots, and treats an unanswered question as no change', () => {
    expect(combineAnswers(questions, { tone: 'grim', rolls: 'on' })).toEqual({ effect: { rules: ['No mercy', 'Roll when unsure'], tools: { gameMaster: { roll_dice: true }, characters: { x: true } }, plots: { heist: 'available' } }, problems: [] })
    expect(combineAnswers(questions, {})).toEqual({ effect: {}, problems: [] })
  })

  it('reports answers that disagree, unknown questions and unknown answers', () => {
    expect(combineAnswers(questions, { tone: 'grim', rolls: 'off' }).problems).toEqual([expect.stringMatching(/disagree about the tool "roll_dice"/)])
    expect(combineAnswers(questions, { nobody: 'x', tone: 'zzz' }).problems).toEqual([expect.stringMatching(/asks no question "nobody"/), expect.stringMatching(/"zzz" is not an answer to "tone"/)])
  })
})
