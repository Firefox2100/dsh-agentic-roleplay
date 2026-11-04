import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './WorldEditor.tsx'
import { MAX_QUESTION_OPTIONS, MAX_START_QUESTIONS } from '../../shared/start-questions.ts'
import { newOption, newQuestion, type OptionDraft, type QuestionDraft } from './questions-draft.ts'
import css from './CharactersPanel.module.css'

interface Props { t: Translate; questions: QuestionDraft[]; openings: { title: string }[]; onChange: (questions: QuestionDraft[]) => void }

/** The questions a world asks before a story starts, and what each answer changes. */
export function QuestionsEditor({ t, questions, openings, onChange }: Props) {
  const setQuestion = (at: number, next: QuestionDraft): void => { onChange(questions.map((question, index) => (index === at ? next : question))) }
  const setOption = (at: number, option: number, next: OptionDraft): void => { setQuestion(at, { ...questions[at]!, options: questions[at]!.options.map((entry, index) => (index === option ? next : entry)) }) }
  return (
    <section className={css.section} data-testid="roleplay-start-questions">
      <h3 className={css.sectionTitle}>{t('sq_title')}</h3>
      <span className={css.help}>{t('sq_help')}</span>
      {questions.map((question, at) => (
        <fieldset key={at} className={css.question} data-testid="roleplay-start-question">
          <legend className={css.questionTitle}>{t('sq_questionText')} {at + 1}</legend>
          <div className={css.grid}>
          <label className={css.field}>
            <span className={css.label}>{t('sq_questionId')}</span>
            <input className={css.nameInput} value={question.id} onChange={(event) => { setQuestion(at, { ...question, id: event.target.value }) }} />
          </label>
          <label className={`${css.field} ${css.wide}`}>
            <span className={css.label}>{t('sq_questionText')}</span>
            <input className={css.nameInput} value={question.text} onChange={(event) => { setQuestion(at, { ...question, text: event.target.value }) }} />
          </label>
          {question.options.map((option, index) => (
            <fieldset key={index} className={`${css.optionFields} ${css.wide}`}>
              <legend className={css.optionTitle}>{t('sq_answerLabel')} {index + 1}</legend>
              <div className={css.grid}>
              <label className={css.field}>
                <span className={css.label}>{t('sq_answerId')}</span>
                <input className={css.nameInput} value={option.id} onChange={(event) => { setOption(at, index, { ...option, id: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('sq_answerLabel')}</span>
                <input className={css.nameInput} value={option.label} onChange={(event) => { setOption(at, index, { ...option, label: event.target.value }) }} />
              </label>
              <label className={`${css.field} ${css.wide}`}>
                <span className={css.label}>{t('sq_answerDescription')}</span>
                <input className={css.nameInput} value={option.description} onChange={(event) => { setOption(at, index, { ...option, description: event.target.value }) }} />
              </label>
              <label className={`${css.field} ${css.wide}`}>
                <span className={css.label}>{t('sq_rules')}</span>
                <textarea className={css.area} rows={2} value={option.rules} onChange={(event) => { setOption(at, index, { ...option, rules: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('sq_opening')}</span>
                <select className={css.select} value={option.opening} onChange={(event) => { setOption(at, index, { ...option, opening: event.target.value }) }}>
                  <option value="">{t('sq_openingNone')}</option>
                  {openings.map((opening, position) => <option key={position} value={String(position)}>{opening.title === '' ? String(position + 1) : opening.title}</option>)}
                </select>
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('sq_startingTime')}</span>
                <input className={css.nameInput} value={option.startingTime} placeholder="1912-04-14T23:40:00" onChange={(event) => { setOption(at, index, { ...option, startingTime: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span className={css.label}>{t('sq_clock')}</span>
                <select className={css.select} value={option.clockMode} onChange={(event) => { setOption(at, index, { ...option, clockMode: event.target.value as OptionDraft['clockMode'] }) }}>
                  <option value="">{t('sq_clockNone')}</option>
                  <option value="simulated">{t('sq_clockSimulated')}</option>
                  <option value="real">{t('sq_clockReal')}</option>
                </select>
              </label>
              {(option.kept.tools !== undefined || option.kept.plots !== undefined) && <span className={css.help}>{t('sq_keptElsewhere')}</span>}
              </div>
              {question.options.length > 2 && <div className={css.itemActions}><Button variant="ghost" size="sm" onClick={() => { setQuestion(at, { ...question, options: question.options.filter((_, position) => position !== index) }) }}>{t('sq_removeAnswer')}</Button></div>}
            </fieldset>
          ))}
          </div>
          <div className={css.questionActions}>
            {question.options.length < MAX_QUESTION_OPTIONS && <Button variant="outline" size="sm" onClick={() => { setQuestion(at, { ...question, options: [...question.options, newOption()] }) }}>{t('sq_addAnswer')}</Button>}
            <Button variant="ghost" size="sm" onClick={() => { onChange(questions.filter((_, index) => index !== at)) }}>{t('sq_removeQuestion')}</Button>
          </div>
        </fieldset>
      ))}
      {questions.length < MAX_START_QUESTIONS && <div className={css.itemActions}><Button variant="outline" size="sm" onClick={() => { onChange([...questions, newQuestion()]) }}>{t('sq_addQuestion')}</Button></div>}
    </section>
  )
}
