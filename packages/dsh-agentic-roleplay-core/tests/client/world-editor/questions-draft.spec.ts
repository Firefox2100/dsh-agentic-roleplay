import { describe, expect, it } from 'vitest'
import { draftOfQuestions, newOption, newQuestion, questionsOfDraft } from '../../../src/client/world-editor/questions-draft.ts'
import type { StartQuestion } from '../../../src/shared/start-questions.ts'

const saved: StartQuestion[] = [{ id: 'tone', text: 'How grim?', options: [
  { id: 'soft', label: 'Gentle', effect: { rules: ['No cruelty.'] } },
  { id: 'hard', label: 'Grim', description: 'Harsh', effect: { opening: 1, startingTime: '1887-10-05T07:00:00', clockMode: 'real', tools: { gameMaster: { roll_dice: true } }, plots: { feud: 'available' } } },
] }]

describe('start question drafts', () => {
  it('give back exactly what they were made from, including what the editor has no field for', () => {
    expect(questionsOfDraft(draftOfQuestions(saved))).toEqual(saved)
  })

  it('drop blank questions and answers, and read the rules one to a line', () => {
    const drafts = draftOfQuestions(saved)
    drafts[0]!.options[0]!.rules = ' No cruelty.\n\n Be kind. '
    drafts[0]!.options.push(newOption())
    drafts.push(newQuestion())
    expect(questionsOfDraft(drafts)[0]!.options[0]!.effect.rules).toEqual(['No cruelty.', 'Be kind.'])
    expect(questionsOfDraft(drafts)).toHaveLength(1)
    expect(questionsOfDraft(drafts)[0]!.options).toHaveLength(2)
  })
})
