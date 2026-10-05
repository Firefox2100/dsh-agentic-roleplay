import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TimelineView } from '../../shared/timeline.ts'
import css from './TurnsDock.module.css'
import { withdrawnKeys, type NodeLike } from './withdrawn.ts'

/** What the dock does besides showing: ask the host for the turns and take the story to one, and put words in the input, sending them when asked. */
export interface TurnsInjected {
  timeline: () => Promise<TimelineView>
  move: (to: string) => Promise<{ draft?: string }>
  fill: (text: string, send: boolean) => void
  /** Makes a new session from the story as it stands after the turn that ended at the seq, and shows it. */
  branch: (atSeq: number) => Promise<void>
}

export type TurnsDockProps = PropsRuntime<'conversation.input.dock'> & TurnsInjected & PropsLocale<'roleplay.transcript'>


const START = 'start'
const LABEL_LENGTH = 40

const escapeAttribute = (value: string): string => value.replace(/["\\]/g, match => `\\${match}`)

/**
 * The turns of the story: swap the last one for another that was played from the same state, play it again, go back to before
 * any turn, or forward again. What belongs to the turns the story is not at is left out of the transcript (the log keeps it).
 */
export function TurnsDock({ useChat, useSession, timeline, move, fill, branch, t }: TurnsDockProps) {
  const running = useSession(session => session.running)
  const [view, setView] = useState<TimelineView | undefined>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const marks = useChat((chat) => {
    const nodes = [...(chat.nodes.values() as Iterable<NodeLike>)]
    return `${nodes.length}:${nodes.reduce((latest, node) => Math.max(latest, node.anchorSeq ?? 0), 0)}`
  })
  const hidden = useChat(chat => (view === undefined ? '' : JSON.stringify(withdrawnKeys(chat.nodes.values() as Iterable<NodeLike>, view.withdrawn))))

  useEffect(() => {
    let stopped = false
    timeline().then((found) => { if (!stopped) setView(found) }).catch((error: unknown) => { console.warn('roleplay: the turns could not be read', error) })
    return () => { stopped = true }
  }, [marks, running, refresh, timeline])

  const rules = (JSON.parse(hidden === '' ? '[]' : hidden) as string[]).map(key => `[data-chat-node-key="${escapeAttribute(key)}"]{display:none}`).join('')
  const style = rules === '' ? null : <style>{rules}</style>
  if (view === undefined || view.path.length === 0) return style

  const last = view.path.at(-1)!
  const parent = view.path.at(-2)?.id ?? START
  const alternatives = last.alternatives
  const at = alternatives.indexOf(last.id)
  const act = (to: string, then?: (draft: string | undefined) => void): void => {
    setBusy(true)
    setProblem(undefined)
    move(to).then((moved) => { then?.(moved.draft); setRefresh(count => count + 1) }).catch((error: unknown) => { setProblem(error instanceof Error ? error.message : String(error)) }).finally(() => { setBusy(false) })
  }
  const off = running || busy
  const label = (text: string): string => (text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text)

  return (
    <div className={css.dock} data-testid="roleplay-turns">
      {style}
      {alternatives.length > 1 && (
        <span className={css.group}>
          <button type="button" className={css.button} disabled={off || at <= 0} title={t('swapPrevious')} onClick={() => { act(alternatives[at - 1]!) }}>◀</button>
          <span className={css.count}>{at + 1}/{alternatives.length}</span>
          <button type="button" className={css.button} disabled={off || at >= alternatives.length - 1} title={t('swapNext')} onClick={() => { act(alternatives[at + 1]!) }}>▶</button>
        </span>
      )}
      <button type="button" className={css.button} disabled={off || (parent !== START && !view.path.at(-2)?.restorable)} title={t('regenerateHint')} onClick={() => { act(parent, (draft) => { if (draft !== undefined) fill(draft, true) }) }}>{t('regenerate')}</button>
      <select className={css.select} disabled={off} value="" aria-label={t('rewind')} onChange={(event) => { if (event.target.value !== '') act(event.target.value, (draft) => { if (draft !== undefined) fill(draft, false) }) }}>
        <option value="">{t('rewind')}</option>
        {[...view.path].reverse().map((turn, index, list) => {
          const before = list[index + 1]?.id ?? START
          const restorable = index === list.length - 1 || list[index + 1]!.restorable
          return <option key={turn.id} value={before} disabled={!restorable}>{`${t('before')} ${label(turn.player)}`}</option>
        })}
      </select>
      <select
        className={css.select}
        disabled={off}
        value=""
        title={t('branchHint')}
        aria-label={t('branch')}
        onChange={(event) => {
          const at = Number(event.target.value)
          if (event.target.value === '' || !Number.isInteger(at)) return
          setBusy(true)
          setProblem(undefined)
          branch(at).catch((error: unknown) => { setProblem(t('branchFailed', { message: error instanceof Error ? error.message : String(error) })) }).finally(() => { setBusy(false) })
        }}
      >
        <option value="">{t('branch')}</option>
        {[...view.path].reverse().map(turn => <option key={turn.id} value={turn.endSeq ?? ''} disabled={turn.endSeq === undefined}>{`${t('after')} ${label(turn.player)}`}</option>)}
      </select>
      {view.forward.length > 0 && <button type="button" className={css.button} disabled={off || !view.forward.at(-1)!.restorable} title={t('redoHint')} onClick={() => { act(view.forward.at(-1)!.id) }}>{t('redo')}</button>}
      {problem !== undefined && <span className={css.error}>{problem}</span>}
    </div>
  )
}
