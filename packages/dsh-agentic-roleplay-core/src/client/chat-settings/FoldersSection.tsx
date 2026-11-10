import { useEffect, useState } from 'react'
import { Button } from '../ui/Button.tsx'
import type { FolderAccess, FoldersStatus } from '../../shared/folders.ts'
import { loadStoryFolders, saveStoryFolders } from '../folders-api.ts'
import type { ChatSettingsLocaleKey } from './locales.ts'
import css from './ChatSettingsView.module.css'

type Translate = (key: ChatSettingsLocaleKey, values?: Record<string, string | number>) => string

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))

/** The folders the file tools of this story reach: the workspace every story shares, and the folders this story was given. */
export function FoldersSection({ t, session, disabled }: { t: Translate; session: string; disabled: boolean }) {
  const [status, setStatus] = useState<FoldersStatus>()
  const [path, setPath] = useState('')
  const [access, setAccess] = useState<FolderAccess>('read')
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()
    loadStoryFolders(session, abort.signal).then(
      (next) => { setStatus(next); setFailure(undefined) },
      (error: unknown) => { if (!abort.signal.aborted) setFailure(message(error)) },
    )
    return () => { abort.abort() }
  }, [session])

  const save = (folders: FoldersStatus['folders']): void => {
    saveStoryFolders(session, folders, new AbortController().signal).then(
      (next) => { setStatus(next); setPath(''); setFailure(undefined) },
      (error: unknown) => { setFailure(t('foldersFailed', { message: message(error) })) },
    )
  }

  if (status === undefined) return failure === undefined ? null : <p className={css.error} role="alert">{t('foldersLoadFailed', { message: failure })}</p>
  return (
    <section className={css.activity} data-testid="roleplay-folders">
      <strong>{t('foldersTitle')}</strong>
      <p className={css.description}>{t('foldersHelp', { workspace: status.workspace })}</p>
      {status.folders.length === 0 && <p className={css.description}>{t('foldersNone')}</p>}
      {status.folders.map(folder => (
        <div key={folder.path}>
          <span>{t(folder.access === 'write' ? 'foldersRowWrite' : 'foldersRowRead', { path: folder.path })}</span>{' '}
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { save(status.folders.filter(other => other.path !== folder.path)) }}>{t('foldersRemove')}</Button>
        </div>
      ))}
      {status.folders.length < status.limit && (
        <>
          <label className={css.field} style={{ maxWidth: 'none' }}>
            <span className={css.label}>{t('foldersPath')}</span>
            <input className={css.select} type="text" value={path} disabled={disabled} placeholder="/home/…" onChange={(event) => { setPath(event.target.value) }} />
          </label>
          <label className={css.field} style={{ maxWidth: 'none' }}>
            <span className={css.label}>{t('foldersAccess')}</span>
            <select className={css.select} value={access} disabled={disabled} onChange={(event) => { setAccess(event.target.value as FolderAccess) }}>
              <option value="read">{t('foldersRead')}</option>
              <option value="write">{t('foldersWrite')}</option>
            </select>
          </label>
          {path.trim() !== '' && <div><Button variant="ghost" size="sm" disabled={disabled} onClick={() => { save([...status.folders, { path: path.trim(), access }]) }}>{t('foldersAdd')}</Button></div>}
        </>
      )}
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
    </section>
  )
}
