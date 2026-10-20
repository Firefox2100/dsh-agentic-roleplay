import { useEffect, useId, useRef, useState } from 'react'
import { Button, IconRefreshOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LorebookSummary } from '../../../shared/lorebooks.ts'
import type {} from '../../panel/slot-contract.ts'
import { LorebookEditor } from './LorebookEditor.tsx'
import type { LorebooksFace } from './lorebooks-controller.ts'
import css from './LorebooksPage.module.css'

export type LorebooksPageProps =
  PropsRuntime<'roleplay.page'>
  & PropsLocale<'roleplay.lorebooks'>
  & InjectFace<LorebooksFace>

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure))
const nameFromFile = (file: string): string => file.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 64)

function NameDialog({ t, mode, file, submit, onClose }: { t: LorebooksPageProps['t']; mode: 'create' | 'import'; file?: string; submit: (name: string, title: string, description: string) => Promise<void>; onClose: () => void }) {
  const formId = useId()
  const [name, setName] = useState(file === undefined ? '' : nameFromFile(file))
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const go = (): void => {
    if (!NAME.test(name) || busy) return
    setBusy(true); setError(undefined)
    submit(name, title.trim(), description.trim()).then(onClose, (failure: unknown) => { setBusy(false); setError(messageOf(failure)) })
  }
  const importing = mode === 'import'
  return (
    <Modal open onClose={onClose} title={importing ? t('importTitle') : t('createTitle')} description={importing ? t('importHelp', { file: file ?? '' }) : t('createHelp')} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId} disabled={busy || !NAME.test(name)}>{importing ? (busy ? t('importing') : t('import')) : (busy ? t('creating') : t('create'))}</Button></>}>
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); go() }}>
        <label className={css.field}><span className={css.label}>{t('bookName')}</span><Input value={name} maxLength={64} data-modal-autofocus onChange={(event) => { setName(event.target.value) }} /><span className={css.help}>{t('bookNameHelp')}</span></label>
        {!importing && <label className={css.field}><span className={css.label}>{t('bookTitle')}</span><Input value={title} maxLength={300} onChange={(event) => { setTitle(event.target.value) }} /></label>}
        {!importing && <label className={css.field}><span className={css.label}>{t('bookDescription')}</span><Input value={description} maxLength={300} onChange={(event) => { setDescription(event.target.value) }} /></label>}
        {error !== undefined && <p className={css.error} role="alert">{importing ? t('importFailed', { message: error }) : t('createFailed', { message: error })}</p>}
      </form>
    </Modal>
  )
}

function DeleteDialog({ t, book, remove, onClose }: { t: LorebooksPageProps['t']; book: LorebookSummary; remove: LorebooksFace['remove']; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const confirm = (): void => {
    setBusy(true); setError(undefined)
    remove(book.name).then(onClose, (failure: unknown) => { setBusy(false); setError(messageOf(failure)) })
  }
  return (
    <Modal open onClose={onClose} title={t('deleteTitle')} description={t('deleteHelp', { name: book.title })} closeLabel={t('close')} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={confirm}>{busy ? t('deleting') : t('delete')}</Button></>}>
      {error !== undefined && <p className={css.error} role="alert">{t('deleteFailed', { message: error })}</p>}
    </Modal>
  )
}

/** The lorebook library: reusable background knowledge that a story copies when it starts. */
export function LorebooksPage({ t, useLorebooks, load, refresh, create, remove, author, importFile }: LorebooksPageProps) {
  const state = useLorebooks(snapshot => snapshot)
  const [editing, setEditing] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<LorebookSummary>()
  const [uploaded, setUploaded] = useState<File>()
  const [notice, setNotice] = useState<string>()
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => { load() }, [load])

  const open = (name: string): void => {
    setNotice(undefined)
    author(name).catch((failure: unknown) => { setNotice(t('authorFailed', { message: messageOf(failure) })) })
  }

  if (editing !== undefined) return <LorebookEditor t={t} name={editing} onBack={() => { setEditing(undefined); refresh() }} author={() => { open(editing) }} />

  const books = state.books ?? []
  const failedWithoutData = state.status === 'failed' && state.books === undefined
  return (
    <div className={css.page} data-testid="roleplay-lorebooks-page">
      <div className={css.toolbar}>
        <span className={css.count}>{state.books === undefined ? '' : t(books.length === 1 ? 'countOne' : 'countOther', { count: books.length })}</span>
        <div className={css.actions}>
          <input ref={picker} type="file" accept=".json,application/json" hidden data-testid="roleplay-lorebook-file" onChange={(event) => { setUploaded(event.target.files?.[0]); event.target.value = '' }} />
          <Button variant="outline" size="sm" onClick={() => { picker.current?.click() }}>{t('import')}</Button>
          <Button variant="primary" size="sm" onClick={() => { setCreating(true) }}>{t('create')}</Button>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} disabled={state.refreshing || state.status === 'loading'} aria-busy={state.refreshing} onClick={refresh}>{state.refreshing ? t('refreshing') : t('refresh')}</Button>
        </div>
      </div>
      {state.error !== undefined && !failedWithoutData && <p className={css.error} role="alert">{t('loadFailed', { message: state.error })}</p>}
      {notice !== undefined && <p className={css.error} role="alert">{notice}</p>}
      <div className={css.viewport}>
        {state.status === 'idle' || state.status === 'loading'
          ? <p className={css.message}>{t('loading')}</p>
          : failedWithoutData
            ? <p className={css.error} role="alert">{t('loadFailed', { message: state.error ?? '' })}</p>
            : books.length === 0
              ? <p className={css.message}>{t('empty')}</p>
              : (
                <ul className={css.grid}>
                  {books.map(book => (
                    <li className={css.card} key={book.name} data-testid="roleplay-lorebook-card">
                      <div className={css.head}><span className={css.title}>{book.title}</span>{book.title !== book.name && <span className={css.name}>{book.name}</span>}</div>
                      {book.description !== '' && <p className={css.description}>{book.description}</p>}
                      {book.problems.length > 0
                        ? <p className={css.error}>{t('broken', { problems: book.problems.join('; ') })}</p>
                        : <span className={css.meta}>{[t('entriesCount', { count: book.entries }), t('commonCount', { count: book.common })].join(' · ')}</span>}
                      <div className={css.cardActions}>
                        <Button variant="outline" size="sm" onClick={() => { setEditing(book.name) }}>{t('edit')}</Button>
                        <Button variant="outline" size="sm" onClick={() => { open(book.name) }}>{t('author')}</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setDeleting(book) }}>{t('delete')}</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
      </div>
      {creating && <NameDialog t={t} mode="create" submit={create} onClose={() => { setCreating(false) }} />}
      {uploaded !== undefined && <NameDialog t={t} mode="import" file={uploaded.name} submit={async (name) => { const file = uploaded; const result = await importFile(name, file); if (!result.started) setNotice(t('importNotStarted', { message: result.failure ?? '' })) }} onClose={() => { setUploaded(undefined) }} />}
      {deleting !== undefined && <DeleteDialog t={t} book={deleting} remove={remove} onClose={() => { setDeleting(undefined) }} />}
    </div>
  )
}
