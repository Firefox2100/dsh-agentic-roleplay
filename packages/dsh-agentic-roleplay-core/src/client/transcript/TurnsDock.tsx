import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { StoryComparison } from '../../shared/compare.ts'
import type { TimelineView } from '../../shared/timeline.ts'
import { Menu } from '../ui/Menu.tsx'
import { useDockFolded } from './dock-fold.ts'
import css from './TurnsDock.module.css'
import { withdrawnKeys, type NodeLike } from './withdrawn.ts'

/** What the dock does besides showing: ask the host for the turns and take the story to one, and put words in the input, sending them when asked. */
export interface TurnsInjected {
  timeline: () => Promise<TimelineView | undefined>
  move: (to: string) => Promise<{ draft?: string }>
  /** Names a turn as a checkpoint, or takes the name off with an empty one. */
  mark: (turn: string, label: string, note?: string) => Promise<void>
  /** What differs between the story as it stands and its state after a turn (or `start`). */
  compare: (turn: string) => Promise<StoryComparison>
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
export function TurnsDock({ useChat, useSession, timeline, move, mark, compare, fill, branch, t }: TurnsDockProps) {
  const running = useSession(session => session.running)
  const [folded, toggleFolded] = useDockFolded()
  const [view, setView] = useState<TimelineView | undefined>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [naming, setNaming] = useState<string | undefined>()
  const [comparison, setComparison] = useState<StoryComparison | undefined>()
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
  const checkpoints = view.path.filter(turn => turn.label !== undefined && turn.restorable)
  const save = (): void => {
    const label = naming?.trim() ?? ''
    if (label === '') return
    setBusy(true)
    setProblem(undefined)
    mark(last.id, label).then(() => { setNaming(undefined); setRefresh(count => count + 1) }).catch((error: unknown) => { setProblem(error instanceof Error ? error.message : String(error)) }).finally(() => { setBusy(false) })
  }
  const label = (text: string): string => (text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text)

  return (
    <div className={css.dock} data-testid="roleplay-turns" data-rp="turns">
      {style}
      <button type="button" className={`${css.button ?? ''} ${css.fold ?? ''}`} aria-expanded={!folded} title={folded ? t('dockShow') : t('dockHide')} onClick={toggleFolded}>{folded ? '▸' : '▾'} {t('dockTools')}</button>
      {folded ? null : <>
      {alternatives.length > 1 && (
        <span className={css.group}>
          <button type="button" className={css.button} disabled={off || at <= 0} title={t('swapPrevious')} onClick={() => { act(alternatives[at - 1]!) }}>◀</button>
          <span className={css.count}>{at + 1}/{alternatives.length}</span>
          <button type="button" className={css.button} disabled={off || at >= alternatives.length - 1} title={t('swapNext')} onClick={() => { act(alternatives[at + 1]!) }}>▶</button>
        </span>
      )}
      <button type="button" className={css.button} disabled={off || (parent !== START && !view.path.at(-2)?.restorable)} title={t('regenerateHint')} onClick={() => { act(parent, (draft) => { if (draft !== undefined) fill(draft, true) }) }}>{t('regenerate')}</button>
      <Menu
        triggerClassName={css.button ?? ''}
        label={t('rewind')}
        disabled={off}
        onSelect={(key) => { act(key, (draft) => { if (draft !== undefined) fill(draft, false) }) }}
        entries={[
          ...checkpoints.map(turn => ({ key: turn.id, label: `◆ ${turn.label!}`, title: turn.note })),
          ...[...view.path].reverse().map((turn, index, list) => ({ key: list[index + 1]?.id ?? START, label: `${t('before')} ${label(turn.player)}`, disabled: !(index === list.length - 1 || list[index + 1]!.restorable) })),
        ]}
      />
      {naming === undefined
        ? <button type="button" className={css.button} disabled={off} title={last.label === undefined ? t('checkpointHint') : t('checkpointNamed', { name: last.label })} onClick={() => { setNaming(last.label ?? '') }}>{t('checkpoint')}</button>
        : (
          <span className={css.group}>
            <input className={css.select} autoFocus maxLength={80} value={naming} placeholder={t('checkpointName')} aria-label={t('checkpointName')} onChange={(event) => { setNaming(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setNaming(undefined) }} />
            <button type="button" className={css.button} disabled={off || naming.trim() === ''} onClick={save}>{t('checkpointSave')}</button>
            {last.label !== undefined && <button type="button" className={css.button} disabled={off} onClick={() => { setBusy(true); mark(last.id, '').then(() => { setNaming(undefined); setRefresh(count => count + 1) }).catch((error: unknown) => { setProblem(error instanceof Error ? error.message : String(error)) }).finally(() => { setBusy(false) }) }}>{t('checkpointRemove')}</button>}
            <button type="button" className={css.button} onClick={() => { setNaming(undefined) }}>{t('checkpointCancel')}</button>
          </span>
        )}
      <Menu
        triggerClassName={css.button ?? ''}
        label={t('branch')}
        title={t('branchHint')}
        disabled={off}
        onSelect={(key) => {
          const at = Number(key)
          if (!Number.isInteger(at)) return
          setBusy(true)
          setProblem(undefined)
          branch(at).catch((error: unknown) => { setProblem(t('branchFailed', { message: error instanceof Error ? error.message : String(error) })) }).finally(() => { setBusy(false) })
        }}
        entries={[...view.path].reverse().map(turn => ({ key: String(turn.endSeq ?? ''), label: `${t('after')} ${label(turn.player)}`, disabled: turn.endSeq === undefined }))}
      />
      <Menu
        triggerClassName={css.button ?? ''}
        label={t('compare')}
        title={t('compareHint')}
        disabled={off}
        onSelect={(turn) => {
          setBusy(true)
          setProblem(undefined)
          compare(turn).then(setComparison).catch((error: unknown) => { setProblem(error instanceof Error ? error.message : String(error)) }).finally(() => { setBusy(false) })
        }}
        entries={[
          ...checkpoints.map(turn => ({ key: turn.id, label: `◆ ${turn.label!}`, disabled: !turn.restorable })),
          { key: START, label: t('compareStart'), disabled: !view.canStart },
          ...[...view.path].reverse().map(turn => ({ key: turn.id, label: `${t('after')} ${label(turn.player)}`, disabled: !turn.restorable })),
        ]}
      />
      {view.forward.length > 0 && <button type="button" className={css.button} disabled={off || !view.forward.at(-1)!.restorable} title={t('redoHint')} onClick={() => { act(view.forward.at(-1)!.id, () => { fill('', false) }) }}>{t('redo')}</button>}
      </>}
      {problem !== undefined && <span className={css.error}>{problem}</span>}
      {comparison !== undefined && (
        <div className={css.comparison} data-testid="roleplay-comparison">
          <div className={css.comparisonHead}>
            <span>{t('compareHeading', { a: comparison.a, b: comparison.b })}</span>
            <button type="button" className={css.button} onClick={() => { setComparison(undefined) }}>{t('checkpointCancel')}</button>
          </div>
          {comparison.changes.length === 0
            ? <p className={css.comparisonLine}>{t('compareSame')}</p>
            : comparison.changes.map((change, index) => (
              <p key={index} className={css.comparisonLine}>
                <span className={css.comparisonSubject}>{change.subject}</span>: {change.a === undefined ? t('compareNone') : change.a} → {change.b === undefined ? t('compareNone') : change.b}
              </p>
            ))}
        </div>
      )}
    </div>
  )
}
