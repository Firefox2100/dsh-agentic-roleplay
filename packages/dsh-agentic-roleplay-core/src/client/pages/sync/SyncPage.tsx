import { useEffect, useState } from 'react'
import { Button, IconRefreshOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncSide, SyncUnitStatus } from '../../../shared/sync.ts'
import type {} from '../../panel/slot-contract.ts'
import type { SyncFace } from './sync-controller.ts'
import css from './SyncPage.module.css'

export type SyncPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.sync'>
  & InjectFace<SyncFace>

const when = (iso: string | undefined, never: string, locale: string): string => (iso === undefined ? never : new Date(iso).toLocaleString(locale))

interface DeletionChoice { unit: string; side: SyncSide; scope: 'everywhere' | 'here' }

function Details({ t, unit, working, face, confirmDeletion }: { t: SyncPageProps['t']; unit: SyncUnitStatus; working: boolean; face: Pick<SyncFace, 'resolve' | 'forget' | 'restore'>; confirmDeletion: (choice: DeletionChoice) => void }) {
  if (unit.state === 'ignored') {
    return (
      <p className={css.detail}>
        <span>{t('ignoredDetail')}</span>
        <span className={css.choices}><Button size="sm" variant="outline" disabled={working} onClick={() => { face.restore(unit.id) }}>{t('restore')}</Button></span>
      </p>
    )
  }
  if (unit.state !== 'conflict') return unit.message === undefined ? null : <span className={unit.state === 'failed' ? css.failed : undefined}>{unit.message}</span>
  if (unit.removal === 'removed') {
    return (
      <p className={css.detail}>
        <span className={css.conflict}>{t('removedDetail')}</span>
        <span className={css.choices}>
          <Button size="sm" variant="outline" disabled={working} onClick={() => { confirmDeletion({ unit: unit.id, side: 'local', scope: 'everywhere' }) }}>{t('deleteEverywhere')}</Button>
          <Button size="sm" variant="outline" disabled={working} onClick={() => { face.forget(unit.id) }}>{t('keepOnRemote')}</Button>
          <Button size="sm" variant="outline" disabled={working} onClick={() => { face.resolve(unit.id, 'remote') }}>{t('getBack')}</Button>
        </span>
      </p>
    )
  }
  if (unit.removal === 'deleted') {
    return (
      <p className={css.detail}>
        <span className={css.conflict}>{t('deletedDetail')}</span>
        <span className={css.choices}>
          <Button size="sm" variant="outline" disabled={working} onClick={() => { face.resolve(unit.id, 'local') }}>{t('keepMine')}</Button>
          <Button size="sm" variant="outline" disabled={working} onClick={() => { confirmDeletion({ unit: unit.id, side: 'remote', scope: 'here' }) }}>{t('deleteHere')}</Button>
        </span>
      </p>
    )
  }
  const files = unit.conflicts ?? []
  return (
    <p className={css.detail}>
      <span className={css.conflict}>{files.length === 0 ? t('conflictWhole') : t('conflictFiles', { files: files.join(', ') })}</span>
      <span className={css.choices}>
        <Button size="sm" variant="outline" disabled={working} onClick={() => { face.resolve(unit.id, 'local') }}>{t('keepLocal')}</Button>
        <Button size="sm" variant="outline" disabled={working} onClick={() => { face.resolve(unit.id, 'remote') }}>{t('keepRemote')}</Button>
      </span>
    </p>
  )
}

/** The units that sync, their state, a button to sync now, and the choices a conflict waits for. */
export function SyncPage(props: SyncPageProps) {
  const { t, load, refresh, run, resolve, forget, restore } = props
  const state = props.useSync(snapshot => snapshot)
  const [deletion, setDeletion] = useState<DeletionChoice>()
  useEffect(() => { load() }, [load])
  const status = state.sync
  const busy = state.working || status?.running === true
  return (
    <div className={css.page} data-testid="roleplay-sync-page">
      <div className={css.toolbar}>
        <span className={css.meta}>{t('lastRun', { when: when(status?.lastRun, t('never'), t('dateLocale')) })}</span>
        <span className={css.actions}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={refresh}><IconRefreshOutlineRegular />{t('refresh')}</Button>
          <Button size="sm" variant="primary" disabled={busy || status?.problem !== undefined} onClick={() => { run() }}>{busy ? t('running') : t('run')}</Button>
        </span>
      </div>
      {status?.problem !== undefined && <p className={css.problem} role="note">{t('problem', { message: status.problem })}</p>}
      {state.error !== undefined && <p className={css.error} role="alert">{state.status === 'failed' ? t('loadFailed', { message: state.error }) : t('failed', { message: state.error })}</p>}
      <div className={css.viewport}>
        {state.status === 'loading' && <p className={css.message}>{t('loading')}</p>}
        {status !== undefined && status.units.length === 0 && <p className={css.message}>{t('empty')}</p>}
        {status !== undefined && status.units.length > 0 && (
          <table className={css.table}>
            <thead><tr><th>{t('unit')}</th><th>{t('kind')}</th><th>{t('state')}</th><th>{t('synced')}</th><th>{t('details')}</th><th /></tr></thead>
            <tbody>
              {status.units.map(unit => (
                <tr key={unit.id}>
                  <td className={css.unit}>{unit.id}</td>
                  <td>{t(`kind_${unit.kind}`)}</td>
                  <td>{t(`state_${unit.state}`)}</td>
                  <td>{when(unit.at, t('never'), t('dateLocale'))}</td>
                  <td><Details t={t} unit={unit} working={busy} face={{ resolve, forget, restore }} confirmDeletion={setDeletion} /></td>
                  <td><Button size="sm" variant="ghost" disabled={busy || status.problem !== undefined || unit.state === 'conflict' || unit.state === 'ignored'} onClick={() => { run(unit.id) }}>{t('runOne')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {deletion !== undefined && (
        <Modal
          open
          onClose={() => { setDeletion(undefined) }}
          title={t(deletion.scope === 'everywhere' ? 'confirmEverywhereTitle' : 'confirmHereTitle')}
          closeLabel={t('close')}
          footer={(
            <>
              <Button variant="ghost" data-modal-autofocus disabled={busy} onClick={() => { setDeletion(undefined) }}>{t('cancel')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { resolve(deletion.unit, deletion.side); setDeletion(undefined) }}>
                {deletion.scope === 'everywhere' ? t('deleteEverywhere') : t('deleteHere')}
              </Button>
            </>
          )}
        >
          <p className={css.confirmation}>{t(deletion.scope === 'everywhere' ? 'confirmEverywhere' : 'confirmHere', { unit: deletion.unit })}</p>
        </Modal>
      )}
    </div>
  )
}
