import type { StartEffect, StartQuestion } from '../../shared/start-questions.ts'

/** An answer as the editor holds it: its effect as the texts of the fields, and what the editor has no field for kept as it was. */
export interface OptionDraft {
  id: string
  label: string
  description: string
  rules: string
  /** The position of an alternate opening, or empty. */
  opening: string
  startingTime: string
  clockMode: '' | 'simulated' | 'real'
  kept: Pick<StartEffect, 'tools' | 'plots'>
}

export interface QuestionDraft { id: string; text: string; options: OptionDraft[] }

export const draftOfQuestions = (questions: readonly StartQuestion[]): QuestionDraft[] => questions.map(question => ({
  id: question.id,
  text: question.text,
  options: question.options.map(option => ({
    id: option.id, label: option.label, description: option.description ?? '', rules: (option.effect.rules ?? []).join('\n'),
    opening: option.effect.opening === undefined ? '' : String(option.effect.opening), startingTime: option.effect.startingTime ?? '', clockMode: option.effect.clockMode ?? '',
    kept: { ...option.effect.tools === undefined ? {} : { tools: option.effect.tools }, ...option.effect.plots === undefined ? {} : { plots: option.effect.plots } },
  })),
}))

/** The questions the drafts stand for; an answer with no id or label is left out, as is a question with no text. */
export const questionsOfDraft = (drafts: readonly QuestionDraft[]): StartQuestion[] => drafts
  .filter(question => question.id.trim() !== '' && question.text.trim() !== '')
  .map(question => ({
    id: question.id.trim(),
    text: question.text.trim(),
    options: question.options.filter(option => option.id.trim() !== '' && option.label.trim() !== '').map(option => {
      const rules = option.rules.split('\n').map(rule => rule.trim()).filter(rule => rule !== '')
      const effect: StartEffect = {
        ...rules.length === 0 ? {} : { rules },
        ...option.opening === '' ? {} : { opening: Number(option.opening) },
        ...option.startingTime.trim() === '' ? {} : { startingTime: option.startingTime.trim() },
        ...option.clockMode === '' ? {} : { clockMode: option.clockMode },
        ...option.kept,
      }
      return { id: option.id.trim(), label: option.label.trim(), ...option.description.trim() === '' ? {} : { description: option.description.trim() }, effect }
    }),
  }))

export const newQuestion = (): QuestionDraft => ({ id: '', text: '', options: [newOption(), newOption()] })
export const newOption = (): OptionDraft => ({ id: '', label: '', description: '', rules: '', opening: '', startingTime: '', clockMode: '', kept: {} })
