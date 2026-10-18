import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { isStrip, SURFACE_NAMES, type PackPreview, type SurfaceName, type WorldPackDetail } from '../../shared/interface-pack.ts'
import { PackFrame, type FrameInput } from '../widgets/pack-frame/PackFrame.tsx'
import type { FrameBackend } from '../widgets/pack-frame/frame-api.ts'
import type { PacksLocaleKey } from './packs-locales.ts'
import { createPack, loadPackFile, loadPackPreview, loadWorldPacks, removePackFile, savePackFile } from './world-files-api.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './CharactersPanel.module.css'
import own from './PacksPanel.module.css'

const WIDTHS = { narrow: 360, medium: 720, wide: 1100 } as const
type Width = keyof typeof WIDTHS
const MAX_LOG = 8
const TEXT_FILE = /\.(html|css|js|json|txt|svg)$/i

type Editing = { path: string; text: string; state: 'loading' | 'ready' | 'saving'; error?: string; created?: boolean }

/** A preview keeps nothing and has no turns played: what a surface asks to keep stays in memory until it is reloaded. */
function previewBackend(): FrameBackend {
  const kept = new Map<string, unknown>()
  return {
    history: () => Promise.resolve([]),
    storage: (op, key, value) => {
      if (op === 'set') kept.set(key, value)
      else if (op === 'remove') kept.delete(key)
      return Promise.resolve(op === 'get' ? kept.get(key) ?? null : null)
    },
  }
}

/** The interface packs of a world: what each holds, what is wrong with it, and its surfaces shown as a story of the world would start with them. */
export function PacksPanel({ t, worldId, actions }: { t: Translate; worldId: string; actions: React.ReactNode }) {
  const say = useCallback((key: PacksLocaleKey, values?: Record<string, string | number>): string => t(`pk_${key}`, values), [t])
  const [packs, setPacks] = useState<WorldPackDetail[] | { failed: string } | undefined>()
  const [chosen, setChosen] = useState<string | undefined>()
  const [surface, setSurface] = useState<SurfaceName | undefined>()
  const [width, setWidth] = useState<Width>('medium')
  const [reload, setReload] = useState(0)
  const [preview, setPreview] = useState<PackPreview | { failed: string } | undefined>()
  const [log, setLog] = useState<string[]>([])
  const [editing, setEditing] = useState<Editing>()
  const [creating, setCreating] = useState<{ kind: 'pack' | 'file'; value: string }>()
  const [removing, setRemoving] = useState<string>()
  const [outcome, setOutcome] = useState<string>()

  useEffect(() => {
    const abort = new AbortController()
    loadWorldPacks(worldId, abort.signal).then(setPacks, (failure: unknown) => { if (!abort.signal.aborted) setPacks({ failed: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId, reload])

  const list = Array.isArray(packs) ? packs : []
  const pack = list.find(entry => entry.id === chosen) ?? list[0]
  const surfaces = pack === undefined ? [] : SURFACE_NAMES.filter(name => pack.surfaces[name] !== undefined)
  const shown = surface !== undefined && surfaces.includes(surface) ? surface : surfaces[0]

  useEffect(() => {
    setPreview(undefined)
    setLog([])
    if (pack === undefined || pack.problems.length > 0) return undefined
    const abort = new AbortController()
    loadPackPreview(worldId, pack.id, abort.signal).then(setPreview, (failure: unknown) => { if (!abort.signal.aborted) setPreview({ failed: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { abort.abort() }
  }, [worldId, pack?.id, pack?.problems.length, reload])

  const backend = useMemo(previewBackend, [preview, reload])
  const note = useCallback((entry: string): void => { setLog(before => [entry, ...before].slice(0, MAX_LOG)) }, [])
  const input = useMemo<FrameInput>(() => ({
    say: (text) => { note(say('logSay', { text })) },
    fill: (text) => { note(say('logFill', { text })) },
    open: (target) => { note(say('logOpen', { surface: say(target) })) },
  }), [note, say])
  const [stripHeight, setStripHeight] = useState<number | undefined>()
  useEffect(() => { setStripHeight(undefined) }, [shown, preview, reload])

  const signal = (): AbortSignal => new AbortController().signal
  const failed = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  const openFile = (path: string): void => {
    if (pack === undefined) return
    setOutcome(undefined)
    setEditing({ path, text: '', state: 'loading' })
    loadPackFile(worldId, pack.id, path, signal()).then(
      (text) => { setEditing(current => (current?.path === path ? { path, text, state: 'ready' } : current)) },
      (error: unknown) => { setEditing({ path, text: '', state: 'ready', error: say('fileNotSaved', { message: failed(error) }) }) },
    )
  }
  const saveFile = (): void => {
    if (pack === undefined || editing === undefined) return
    setEditing({ ...editing, state: 'saving' })
    savePackFile(worldId, pack.id, editing.path, editing.text, signal()).then(
      (problems) => { setEditing(undefined); setOutcome(problems.length === 0 ? say('savedClean') : say('savedWith', { count: problems.length })); setReload(count => count + 1) },
      (error: unknown) => { setEditing({ ...editing, state: 'ready', error: say('fileNotSaved', { message: failed(error) }) }) },
    )
  }
  const removeFile = (path: string): void => {
    if (pack === undefined) return
    setRemoving(undefined)
    removePackFile(worldId, pack.id, path, signal()).then(
      () => { setOutcome(undefined); setReload(count => count + 1) },
      (error: unknown) => { setOutcome(say('fileNotSaved', { message: failed(error) })) },
    )
  }
  const create = (): void => {
    if (creating === undefined || creating.value.trim() === '') return
    const value = creating.value.trim()
    setCreating(undefined)
    if (creating.kind === 'file') { setEditing({ path: value, text: '', state: 'ready', created: true }); return }
    createPack(worldId, value, value, signal()).then(
      () => { setChosen(value); setOutcome(undefined); setReload(count => count + 1) },
      (error: unknown) => { setOutcome(say('fileNotSaved', { message: failed(error) })) },
    )
  }

  const refresh = (
    <Button variant="ghost" size="sm" onClick={() => { setReload(count => count + 1) }}>{say('reload')}</Button>
  )

  return (
    <div className={css.panel}>
      <div className={css.tabs} role="tablist">
        {list.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={entry.id === pack?.id} className={`${css.tab} ${entry.id === pack?.id ? css.tabOn : ''}`} onClick={() => { setChosen(entry.id) }}>{entry.name}</button>)}
        <span className={css.tabsSpace} />{actions}
      </div>
      <div className={css.body}>
        <article className={css.sheet}>
          <p>{say('help')}</p>
          <div className={own.controls}>
            {creating === undefined
              ? <><Button variant="ghost" size="sm" onClick={() => { setCreating({ kind: 'pack', value: '' }) }}>{say('newPack')}</Button>{pack !== undefined && <Button variant="ghost" size="sm" onClick={() => { setCreating({ kind: 'file', value: '' }) }}>{say('newFile')}</Button>}</>
              : <><Input value={creating.value} placeholder={say(creating.kind === 'pack' ? 'newPackId' : 'newFilePath')} aria-label={say(creating.kind === 'pack' ? 'newPackId' : 'newFilePath')} onChange={event => { setCreating({ ...creating, value: event.target.value }) }} /><Button size="sm" onClick={create}>{say('create')}</Button><Button variant="ghost" size="sm" onClick={() => { setCreating(undefined) }}>{say('cancelFile')}</Button></>}
          </div>
          {outcome !== undefined && <p className={own.note} role="status">{outcome}</p>}
          {packs === undefined && <p>{say('loading')}</p>}
          {packs !== undefined && !Array.isArray(packs) && <p className={css.error} role="alert">{say('loadFailed', { message: packs.failed })}</p>}
          {Array.isArray(packs) && list.length === 0 && <p>{say('none')}</p>}
          {pack !== undefined && (
            <>
              <section className={css.section}>
                <h3 className={css.sectionTitle}>{pack.name} <Tag>{pack.id}</Tag>{pack.version !== '' && <> <Tag>{say('version', { version: pack.version })}</Tag></>}</h3>
                {pack.description !== '' && <p>{pack.description}</p>}
                <p>{pack.actions.length === 0 ? say('noActions') : `${say('actions')}: ${pack.actions.join(', ')}`}{pack.skin === undefined ? '' : ` · ${say('skin', { file: pack.skin })}`}{pack.tokens === 0 ? '' : ` · ${say('tokens', { count: pack.tokens })}`}</p>
                {surfaces.length > 0 && <p><span className={css.label}>{say('surfaces')}</span> {surfaces.map(name => <Tag key={name}>{say(name)}: {pack.surfaces[name]?.file}</Tag>)}</p>}
                {pack.files.length > 0 && <details open={editing !== undefined}><summary>{say('files')} ({pack.files.length})</summary><ul className={own.files}>{pack.files.map(file => <li key={file.path}>{file.path} <span className={css.label}>{file.size} B</span>{' '}{TEXT_FILE.test(file.path) && <Button variant="ghost" size="sm" onClick={() => { openFile(file.path) }}>{say('editFile')}</Button>}{removing === file.path ? <><Button variant="primary" size="sm" onClick={() => { removeFile(file.path) }}>{say('deleteConfirm', { path: file.path })}</Button><Button variant="ghost" size="sm" onClick={() => { setRemoving(undefined) }}>{say('cancelFile')}</Button></> : <Button variant="ghost" size="sm" onClick={() => { setRemoving(file.path) }}>{say('deleteFile')}</Button>}</li>)}</ul><p className={own.note}>{say('textOnly')}</p></details>}
                {editing !== undefined && (
                  <div data-testid="roleplay-pack-editor">
                    <p><span className={css.label}>{editing.path}</span> <span className={own.note}>{say('editHelp')}</span></p>
                    <textarea className={css.area} rows={16} spellCheck={false} style={{ fontFamily: 'monospace' }} aria-label={editing.path} value={editing.state === 'loading' ? say('fileLoading') : editing.text} disabled={editing.state !== 'ready'} onChange={event => { setEditing({ ...editing, text: event.target.value }) }} />
                    {editing.error !== undefined && <p className={css.error} role="alert">{editing.error}</p>}
                    <p><Button size="sm" disabled={editing.state !== 'ready'} onClick={saveFile}>{editing.state === 'saving' ? say('fileSaving') : say('saveFile')}</Button> <Button variant="ghost" size="sm" onClick={() => { setEditing(undefined) }}>{say('cancelFile')}</Button></p>
                  </div>
                )}
                {pack.problems.length > 0 && <div className={css.error} role="alert"><strong>{say('problems')}</strong><ul>{pack.problems.map((problem, index) => <li key={index}>{problem.file === '' ? problem.message : `${problem.file}: ${problem.message}`}</li>)}</ul></div>}
              </section>
              <section className={css.section}>
                <h3 className={css.sectionTitle}>{say('preview')}</h3>
                {pack.problems.length > 0 && <p>{say('previewBlocked')}</p>}
                {pack.problems.length === 0 && surfaces.length === 0 && <p>{say('noSurfaces')}</p>}
                {preview !== undefined && 'failed' in preview && <p className={css.error} role="alert">{say('previewFailed', { message: preview.failed })}</p>}
                {preview !== undefined && !('failed' in preview) && shown !== undefined && (
                  <>
                    <div className={own.controls}>
                      <label className={own.group}>{say('surface')} <select value={shown} onChange={event => { setSurface(event.target.value as SurfaceName) }}>{surfaces.map(name => <option key={name} value={name}>{say(name)}</option>)}</select></label>
                      <label className={own.group}>{say('width')} <select value={width} onChange={event => { setWidth(event.target.value as Width) }}>{(Object.keys(WIDTHS) as Width[]).map(name => <option key={name} value={name}>{say(name)} ({WIDTHS[name]})</option>)}</select></label>
                      {refresh}
                    </div>
                    <div className={`${own.stage}${isStrip(shown) ? '' : ` ${own.stageTall}`}`} style={{ width: `${WIDTHS[width]}px` }} data-testid="roleplay-pack-preview">
                      <PackFrame key={`${preview.pack.revision}-${shown}-${reload}`} backend={backend} pack={preview.pack} surface={shown} view={preview.view} input={input} onResize={setStripHeight} title={`${pack.name}: ${say(shown)}`} {...(isStrip(shown) ? (stripHeight === undefined ? {} : { height: stripHeight }) : { fill: true })} />
                    </div>
                    <p className={own.note}>{say('previewNote')}</p>
                    <div><span className={css.label}>{say('log')}</span>{log.length === 0 ? <p className={own.note}>{say('logEmpty')}</p> : <ul className={own.log}>{log.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul>}</div>
                  </>
                )}
              </section>
            </>
          )}
        </article>
      </div>
    </div>
  )
}
