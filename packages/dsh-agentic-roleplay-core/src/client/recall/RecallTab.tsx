import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RunRecall } from '../../shared/activity.ts'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { MAX_SITUATION, type RecallPreview } from '../../shared/recall-preview.ts'
import { loadCharacters, previewRecall } from './recall-api.ts'
import { SidebarGuideEntry } from '../widgets/sidebar-guide/SidebarGuideEntry.tsx'
import css from './RecallTab.module.css'

/** The kind of the tab type, and the identity it registers its card and body under. */
export const RECALL_KIND = 'roleplay-recall'
export const RECALL_ID = '@dsh-agentic-roleplay/core/recall-sidebar'

export type RecallBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'roleplay.recall'> & InjectFace<Record<string, never>> & { sessionId: string }
export type RecallGuideProps = PropsRuntime<'sidebar.right.tab.guide.entry'> & PropsLocale<'roleplay.recall'> & { sessionId: string }

type Translate = RecallBodyProps['t']

/** The guide entry that opens the recall check, drawn like DSH's own; only a roleplay chat has it. */
export function RecallGuide({ sessionId, useTabInfo, t }: RecallGuideProps): ReactNode {
  const { tab } = useTabInfo()
  if (roleplaySessionOf(sessionId) === undefined) return null
  return <SidebarGuideEntry kind={RECALL_KIND} title={t('title')} description={t('description')} icon={IconSearchOutlineRegular} onOpen={() => { tab.actions.openTab(RECALL_KIND, { replaceTab: true }) }} />
}

const figure = (value: number): string => (Math.round(value * 100) / 100).toString()

function reasonOf(t: Translate, why: RunRecall['why']): string {
  if (why === undefined) return ''
  return [
    t('whyMatch', { value: figure(why.relevance) }),
    t('whyMatters', { value: why.importance }),
    t('whyAge', { value: figure(why.ageDays) }),
    ...why.retention === undefined ? [] : [t('whyKept', { value: figure(why.retention) })],
    t('whyScore', { value: figure(why.score) }),
    ...why.linked === undefined ? [] : [t('whyLinked')],
  ].join(' · ')
}

type Result = { state: 'idle' } | { state: 'working' } | { state: 'failed'; message: string } | { state: 'done'; preview: RecallPreview }

/** The tab: a moment in, what each character would be reminded of out. Nothing is played and nothing the story keeps changes. */
export function RecallBody({ sessionId, useTabInfo, t }: RecallBodyProps): ReactNode {
  const session = roleplaySessionOf(sessionId)
  const { tab } = useTabInfo()
  const [situation, setSituation] = useState('')
  const [character, setCharacter] = useState('')
  const [people, setPeople] = useState<{ key: string; name: string }[]>([])
  const [result, setResult] = useState<Result>({ state: 'idle' })
  const running = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    if (session === undefined || !tab.visible) return undefined
    const abort = new AbortController()
    loadCharacters(session, abort.signal).then(setPeople, () => undefined)
    return () => { abort.abort() }
  }, [session, tab.visible])
  useEffect(() => () => { running.current?.abort() }, [])

  const show = (): void => {
    if (session === undefined || situation.trim() === '') return
    running.current?.abort()
    const abort = new AbortController()
    running.current = abort
    setResult({ state: 'working' })
    previewRecall(session, situation, character === '' ? undefined : character, abort.signal).then(
      (preview) => { if (!abort.signal.aborted) setResult({ state: 'done', preview }) },
      (error: unknown) => { if (!abort.signal.aborted) setResult({ state: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
  }

  return (
    <div className={css.page} data-rp="recall">
      <div className={css.bar}>
        <Button variant="ghost" size="sm" onClick={() => { tab.actions.openTab('guide', { replaceTab: true }) }}>← {t('back')}</Button>
        <span className={css.name}>{t('title')}</span>
      </div>
      <div className={css.body}>
        {session === undefined ? <p className={css.hint}>{t('none')}</p> : (
          <>
            <div className={css.form}>
              <label className={css.label} htmlFor="rp-recall-situation">{t('situation')}</label>
              <textarea id="rp-recall-situation" className={`${css.field} ${css.area}`} value={situation} maxLength={MAX_SITUATION} placeholder={t('situationHint')} onChange={(event) => { setSituation(event.target.value) }} />
              <label className={css.label} htmlFor="rp-recall-who">{t('who')}</label>
              <select id="rp-recall-who" className={css.field} value={character} onChange={(event) => { setCharacter(event.target.value) }}>
                <option value="">{t('here')}</option>
                {people.map(person => <option key={person.key} value={person.key}>{person.name}</option>)}
              </select>
              <div className={css.actions}>
                <Button variant="primary" size="sm" disabled={situation.trim() === '' || result.state === 'working'} onClick={show}>{result.state === 'working' ? t('showing') : t('show')}</Button>
              </div>
              <p className={css.hint}>{t('readOnly')}</p>
            </div>
            {result.state === 'failed' && <p className={css.error} role="alert">{t('failed', { message: result.message })}</p>}
            {result.state === 'done' && <Preview t={t} preview={result.preview} />}
          </>
        )}
      </div>
    </div>
  )
}

function Preview({ t, preview }: { t: Translate; preview: RecallPreview }) {
  return (
    <div data-testid="roleplay-recall-result">
      <p className={css.note}>{`${t('turn', { turn: preview.turn })}. ${preview.byMeaning ? t('byMeaning') : t('byWords')} ${t('limit', { count: preview.limit })}`}</p>
      {preview.characters.length === 0 && <p className={css.hint}>{t('noCharacters')}</p>}
      {preview.characters.map(person => (
        <section key={person.key} className={css.person}>
          <div className={css.heading}>{person.name}{person.place === undefined ? null : <span className={css.place}>{person.place}</span>}</div>
          {person.memories.length === 0
            ? <p className={css.hint}>{t('nothing')}</p>
            : (
              <ul className={css.list}>
                {person.memories.map((memory, index) => (
                  <li key={index} className={css.item}>
                    {memory.text}
                    <span className={css.meta}>{`${t(memory.clarity)} · ${memory.turn} — ${reasonOf(t, memory.why)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          <p className={css.hint}>{t('known', person.known)}</p>
          {person.lore.length > 0 && <p className={css.hint}>{`${t('lore')}: ${person.lore.join(', ')}`}</p>}
        </section>
      ))}
    </div>
  )
}
