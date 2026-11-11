import type { Switchboard } from './settings.ts'

export const MAX_START_QUESTIONS = 8
export const MAX_QUESTION_OPTIONS = 8
export const MAX_QUESTION_TEXT = 200
export const START_PLOT_STATUSES = ['dormant', 'available'] as const

/** What an answer may change about how a story starts. Nothing else a world declares can reach the start settings. */
export interface StartEffect {
  /** Rules added to the story's own, in the author's words. */
  rules?: string[]
  /** The alternate opening to start with, by its position. */
  opening?: number
  /** Local story time to start at. */
  startingTime?: string
  /** Whether the story's time is simulated or follows the wall clock. */
  clockMode?: 'simulated' | 'real'
  /** Optional tools switched on or off, by kind of agent. */
  tools?: Switchboard
  /** Whether a plot waits (`dormant`) or may be taken up from the start (`available`), by plot id. */
  plots?: Record<string, (typeof START_PLOT_STATUSES)[number]>
}

export interface StartOption {
  id: string
  label: string
  description?: string
  effect: StartEffect
}

/** A question the world asks before a story starts: the player picks one option, and its effect is applied. */
export interface StartQuestion {
  id: string
  text: string
  options: StartOption[]
}

/** What the start dialog shows of a question. */
export interface StartQuestionView {
  id: string
  text: string
  options: { id: string; label: string; description?: string }[]
}

export const questionView = (question: StartQuestion): StartQuestionView => ({
  id: question.id,
  text: question.text,
  options: question.options.map(({ id, label, description }) => ({ id, label, ...(description === undefined ? {} : { description }) })),
})

/** What the answers add up to, or why they cannot be combined. A question left unanswered changes nothing. */
export function combineAnswers(questions: readonly StartQuestion[], answers: Readonly<Record<string, string>>): { effect: StartEffect; problems: string[] } {
  const problems: string[] = []
  const effect: StartEffect = {}
  for (const id of Object.keys(answers)) if (!questions.some(question => question.id === id)) problems.push(`the world asks no question "${id}"`)
  const set = <K extends 'opening' | 'startingTime' | 'clockMode'>(key: K, value: StartEffect[K], question: string): void => {
    if (value === undefined) return
    if (effect[key] !== undefined && effect[key] !== value) problems.push(`the answers disagree about the ${key === 'startingTime' ? 'starting time' : key === 'clockMode' ? 'clock' : key}; "${question}" changes it again`)
    else effect[key] = value
  }
  for (const question of questions) {
    const answer = answers[question.id]
    if (answer === undefined) continue
    const option = question.options.find(entry => entry.id === answer)
    if (option === undefined) { problems.push(`"${answer}" is not an answer to "${question.id}"`); continue }
    const found = option.effect
    if (found.rules !== undefined) effect.rules = [...effect.rules ?? [], ...found.rules]
    set('opening', found.opening, question.id)
    set('startingTime', found.startingTime, question.id)
    set('clockMode', found.clockMode, question.id)
    for (const [agent, switches] of Object.entries(found.tools ?? {})) {
      const merged = { ...effect.tools?.[agent] }
      for (const [tool, value] of Object.entries(switches)) {
        if (merged[tool] !== undefined && merged[tool] !== value) problems.push(`the answers disagree about the tool "${tool}"; "${question.id}" changes it again`)
        merged[tool] = value
      }
      effect.tools = { ...effect.tools, [agent]: merged }
    }
    for (const [plot, status] of Object.entries(found.plots ?? {})) {
      if (effect.plots?.[plot] !== undefined && effect.plots[plot] !== status) problems.push(`the answers disagree about the plot "${plot}"; "${question.id}" changes it again`)
      effect.plots = { ...effect.plots, [plot]: status }
    }
  }
  return { effect, problems }
}

/** The questions as `world.json` writes them: snake_case keys, and only what an answer sets. */
export function startQuestionsToFile(questions: readonly StartQuestion[]): unknown[] {
  return questions.map(question => ({
    id: question.id,
    text: question.text,
    options: question.options.map(option => ({
      id: option.id,
      label: option.label,
      ...(option.description === undefined || option.description === '' ? {} : { description: option.description }),
      effect: {
        ...(option.effect.rules === undefined || option.effect.rules.length === 0 ? {} : { rules: option.effect.rules }),
        ...(option.effect.opening === undefined ? {} : { opening: option.effect.opening }),
        ...(option.effect.startingTime === undefined || option.effect.startingTime === '' ? {} : { starting_time: option.effect.startingTime }),
        ...(option.effect.clockMode === undefined ? {} : { clock_mode: option.effect.clockMode }),
        ...(option.effect.tools === undefined ? {} : { tools: option.effect.tools }),
        ...(option.effect.plots === undefined ? {} : { plots: option.effect.plots }),
      },
    })),
  }))
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads questions sent by the editor: the shape only, since the world file's own reader judges every value when the change is written. */
export function parseStartQuestionsEdit(value: unknown, problems: string[]): StartQuestion[] | undefined {
  if (!Array.isArray(value)) { problems.push('startQuestions must be a list'); return undefined }
  const questions: StartQuestion[] = []
  for (const entry of value) {
    if (!isObject(entry) || typeof entry['id'] !== 'string' || typeof entry['text'] !== 'string' || !Array.isArray(entry['options'])) { problems.push('a start question needs an id, a text and a list of options'); return undefined }
    const options: StartOption[] = []
    for (const option of entry['options']) {
      if (!isObject(option) || typeof option['id'] !== 'string' || typeof option['label'] !== 'string' || !isObject(option['effect']) || (option['description'] !== undefined && typeof option['description'] !== 'string')) { problems.push('an answer needs an id, a label and an effect object, such as {"id": "morning", "label": "Morning", "effect": {"startingTime": "07:00"}} (the effect may hold rules, opening, startingTime, clockMode, tools, plots; {} changes nothing)'); return undefined }
      const effect = option['effect']
      const known: StartEffect = {}
      if (Array.isArray(effect['rules'])) known.rules = effect['rules'].filter((rule): rule is string => typeof rule === 'string')
      if (typeof effect['opening'] === 'number') known.opening = effect['opening']
      if (typeof effect['startingTime'] === 'string') known.startingTime = effect['startingTime']
      if (effect['clockMode'] === 'simulated' || effect['clockMode'] === 'real') known.clockMode = effect['clockMode']
      if (isObject(effect['tools'])) known.tools = effect['tools'] as Switchboard
      if (isObject(effect['plots'])) known.plots = effect['plots'] as NonNullable<StartEffect['plots']>
      options.push({ id: option['id'].trim(), label: option['label'].trim(), ...(typeof option['description'] === 'string' && option['description'].trim() !== '' ? { description: option['description'].trim() } : {}), effect: known })
    }
    questions.push({ id: entry['id'].trim(), text: entry['text'].trim(), options })
  }
  return questions
}
