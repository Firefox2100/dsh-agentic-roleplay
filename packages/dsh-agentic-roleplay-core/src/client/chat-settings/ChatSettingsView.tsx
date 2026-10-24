import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { SettingsPayload } from '../../shared/settings.ts'
import css from './ChatSettingsView.module.css'
import { NotRoleplayError, loadSettings, openDoctor, resetVectors, saveSettings, startReflection } from './settings-api.ts'
import { fromDrafts, problemsOf, toDrafts, type Drafts } from '../settings-form/fields.ts'
import { useEmbeddingOptions } from '../settings-form/embedding-options.ts'
import { DecisionsSection } from './DecisionsSection.tsx'
import { InterfaceSection } from './InterfaceSection.tsx'
import { LorebookSection } from './LorebookSection.tsx'
import { PresetSection } from './PresetSection.tsx'
import { ReflectionSection } from './ReflectionSection.tsx'
import { VectorsSection } from './VectorsSection.tsx'
import { ToolSwitches } from '../widgets/tool-switches/ToolSwitches.tsx'
import { loadExternalTools } from '../widgets/tool-switches/tools-api.ts'
import type { ExternalTool } from '../../shared/tools.ts'
import { ActivityList, UsageTable } from './ActivityList.tsx'
import { InterventionList } from './InterventionList.tsx'
import { SettingsFields } from '../settings-form/SettingsFields.tsx'

export interface ChatSettingsInjected {
  openChat: (chatSessionId: string) => void
}

export type ChatSettingsViewProps = PropsRuntime<'conversation.view'> & ChatSettingsInjected & PropsLocale<'roleplay.chatSettings'>

type Load =
  | { status: 'loading' }
  | { status: 'not-roleplay' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; payload: SettingsPayload }

/** The settings of one chat. Ordinary DSH chats have ids of the same shape, so the host decides whether this one is a roleplay session. */
export function ChatSettingsView({ t, sessionId, openChat }: ChatSettingsViewProps) {
  const session = roleplaySessionOf(sessionId)
  const [load, setLoad] = useState<Load>(session === undefined ? { status: 'not-roleplay' } : { status: 'loading' })
  const [drafts, setDrafts] = useState<Drafts>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [toolsError, setToolsError] = useState<string | undefined>()
  const [external, setExternal] = useState<ExternalTool[]>([])
  const options = useEmbeddingOptions('all')

  useEffect(() => {
    const abort = new AbortController()
    loadExternalTools(abort.signal).then(setExternal, () => undefined)
    return () => { abort.abort() }
  }, [])

  useEffect(() => {
    if (session === undefined) return undefined
    const abort = new AbortController()
    setLoad({ status: 'loading' })
    loadSettings(session, abort.signal).then(
      (payload) => { setLoad({ status: 'ready', payload }); setDrafts(toDrafts(payload.settings, options)) },
      (failure: unknown) => {
        if (abort.signal.aborted) return
        setLoad(failure instanceof NotRoleplayError ? { status: 'not-roleplay' } : { status: 'failed', message: failure instanceof Error ? failure.message : String(failure) })
      },
    )
    return () => { abort.abort() }
  }, [session, options])

  if (load.status === 'loading') return <p className={css.message}>{t('loading')}</p>
  if (load.status === 'not-roleplay') return <p className={css.message}>{t('notRoleplay')}</p>
  if (load.status === 'failed') return <p className={css.message} role="alert">{t('loadFailed', { message: load.message })}</p>

  const { payload } = load
  const bad = problemsOf(drafts, options)
  const changed = bad.size === 0 && JSON.stringify(fromDrafts(payload.settings, drafts, options)) !== JSON.stringify(payload.settings)

  const change = (key: string, value: string | boolean): void => {
    setDrafts({ ...drafts, [key]: value })
    setSaved(false)
  }

  const reset = (): void => {
    if (session === undefined) return
    resetVectors(session, new AbortController().signal).then(
      refreshActivity,
      (failure: unknown) => { setError(t('vectorsFailed', { message: failure instanceof Error ? failure.message : String(failure) })) },
    )
  }

  const reflect = (): void => {
    if (session === undefined) return
    setError(undefined)
    startReflection(session, new AbortController().signal).then(
      refreshActivity,
      (failure: unknown) => { setError(t('reflectFailed', { message: failure instanceof Error ? failure.message : String(failure) })) },
    )
  }

  const askDoctor = (): void => {
    if (session === undefined) return
    setError(undefined)
    openDoctor(session, t('doctorChat'), t('language'), new AbortController().signal).then(
      openChat,
      (failure: unknown) => { setError(t('doctorFailed', { message: failure instanceof Error ? failure.message : String(failure) })) },
    )
  }

  const refreshActivity = (): void => {
    if (session === undefined) return
    loadSettings(session, new AbortController().signal).then(
      (next) => { setLoad({ status: 'ready', payload: { ...payload, activity: next.activity, usage: next.usage, interventions: next.interventions, vectors: next.vectors, reflection: next.reflection, pendingRecords: next.pendingRecords, pendingConsolidation: next.pendingConsolidation } }) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }

  const setTools = (tools: SettingsPayload['settings']['tools']): void => {
    if (session === undefined) return
    setSaving(true)
    setToolsError(undefined)
    saveSettings(session, { ...payload.settings, tools }, new AbortController().signal).then(
      (next) => { setLoad({ status: 'ready', payload: next }) },
      (failure: unknown) => { setToolsError(failure instanceof Error ? failure.message : String(failure)) },
    ).finally(() => { setSaving(false) })
  }

  const save = (): void => {
    if (session === undefined || !changed) return
    setSaving(true)
    setError(undefined)
    setSaved(false)
    saveSettings(session, fromDrafts(payload.settings, drafts, options), new AbortController().signal).then(
      (next) => { setLoad({ status: 'ready', payload: next }); setDrafts(toDrafts(next.settings, options)); setSaved(true) },
      (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) },
    ).finally(() => { setSaving(false) })
  }

  return (
    <form className={css.view} data-testid="roleplay-chat-settings" onSubmit={(event) => { event.preventDefault(); save() }}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
      {payload.pendingConsolidation > 0 && <p className={css.notice} role="status">{t('pendingConsolidation', { count: payload.pendingConsolidation })}</p>}
      {payload.pendingRecords > 0 && <p className={css.notice} role="status">{t('pendingRecords', { count: payload.pendingRecords })}</p>}
      <SettingsFields t={t} drafts={drafts} onChange={change} onPreset={(changes) => { setDrafts({ ...drafts, ...changes }); setSaved(false) }} options={options} disabled={saving} hidden={['interface.pack']} locked={payload.clockMode === 'simulated' ? { 'clock.mode': { real: t('clockLocked') } } : {}} />
      {session !== undefined && <InterfaceSection t={t} session={session} value={String(drafts['interface.pack'] ?? '')} onChange={(next) => { change('interface.pack', next) }} saved={payload.settings.interface.pack} disabled={saving} />}
      {session !== undefined && <PresetSection t={t} session={session} disabled={saving} />}
      {session !== undefined && <LorebookSection t={t} session={session} disabled={saving} />}
      <ToolSwitches board={payload.settings.tools} onChange={setTools} disabled={saving} external={external} {...(toolsError === undefined ? {} : { error: toolsError })} t={t} />
      {session !== undefined && <DecisionsSection t={t} session={session} modes={payload.settings.decisions} />}
      <ReflectionSection t={t} status={payload.reflection} disabled={saving} onStart={reflect} onRefresh={refreshActivity} />
      <section className={css.activity} data-testid="roleplay-doctor">
        <strong>{t('doctorTitle')}</strong>
        <p className={css.description}>{t('doctorHelp')}</p>
        <div><Button variant="ghost" size="sm" onClick={askDoctor}>{t('doctorOpen')}</Button></div>
      </section>
      <VectorsSection t={t} status={payload.vectors} disabled={saving} onReset={reset} />
      <InterventionList t={t} entries={payload.interventions} />
      {session !== undefined && <UsageTable t={t} usage={payload.usage} />}
      {session !== undefined && <ActivityList t={t} session={session} entries={payload.activity} onRefresh={refreshActivity} />}
      {error !== undefined && <p className={css.error} role="alert">{t('saveFailed', { message: error })}</p>}
      <div className={css.actions}>
        <Button variant="primary" size="sm" type="submit" disabled={!changed || saving}>{saving ? t('saving') : t('save')}</Button>
        {saved && <span className={css.saved}>{t('saved')}</span>}
      </div>
    </form>
  )
}
