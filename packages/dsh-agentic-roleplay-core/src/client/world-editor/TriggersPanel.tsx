import { useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorldState, WorldTrigger } from '../../shared/world-state.ts'
import type { TriggersLocaleKey } from './triggers-locales.ts'
import { describeCondition, describeEffect, namesOf } from './trigger-text.ts'
import type { Translate } from './WorldEditor.tsx'
import type { WorldSource } from './source.ts'
import css from './CharactersPanel.module.css'

const STATUS = { fired: 'fired', failed: 'failed', expired: 'expired', dormant: 'dormant' } as const

const TEMPLATE = { name: 'New trigger', when: { type: 'event', tag: 'alarm' }, effects: [{ type: 'beat', text: 'Something stirs.' }] }

type Editing = { key: string; text: string; state: 'loading' | 'ready' | 'saving'; error?: string; created?: boolean }

/**
 * What the world does by itself, in sentences: what each trigger waits for and does, and what is wrong with it. For a world's files each trigger can be edited as its
 * document (checked as a story start checks it), added and removed; a story's triggers are only shown.
 */
export function TriggersPanel({ t, world, source, onChanged, actions }: { t: Translate; world: WorldState; source: WorldSource; onChanged: (world: WorldState) => void; actions: React.ReactNode }) {
  const [editing, setEditing] = useState<Editing>()
  const [adding, setAdding] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const [removing, setRemoving] = useState<string>()
  const writable = source.worldId !== undefined && source.writeTrigger !== undefined && source.readTrigger !== undefined && source.removeTrigger !== undefined
  const signal = (): AbortSignal => new AbortController().signal
  const edit = (key: string): void => {
    setFailure(undefined)
    setEditing({ key, text: '', state: 'loading' })
    source.readTrigger!(key, signal()).then(
      (document) => { const { key: _own, ...rest } = document; setEditing(current => (current?.key === key ? { key, text: JSON.stringify(rest, null, 2), state: 'ready' } : current)) },
      (error: unknown) => { setEditing(undefined); setFailure(error instanceof Error ? error.message : String(error)) },
    )
  }
  const save = (): void => {
    if (editing === undefined) return
    let document: unknown
    try { document = JSON.parse(editing.text) } catch (error) { setEditing({ ...editing, error: t('trig_notJson', { message: error instanceof Error ? error.message : String(error) }) }); return }
    setEditing({ ...editing, state: 'saving' })
    source.writeTrigger!(editing.key, document, signal()).then(
      (next) => { setEditing(undefined); onChanged(next) },
      (error: unknown) => { setEditing({ ...editing, state: 'ready', error: t('trig_saveFailed', { message: error instanceof Error ? error.message : String(error) }) }) },
    )
  }
  const remove = (key: string): void => {
    setRemoving(undefined)
    setFailure(undefined)
    source.removeTrigger!(key, signal()).then(onChanged, (error: unknown) => { setFailure(t('trig_saveFailed', { message: error instanceof Error ? error.message : String(error) })) })
  }
  const add = (): void => {
    const key = (adding ?? '').trim()
    if (key === '') return
    setAdding(undefined)
    setFailure(undefined)
    setEditing({ key, text: JSON.stringify(TEMPLATE, null, 2), state: 'ready', created: true })
  }
  const say = (key: TriggersLocaleKey, values?: Record<string, string | number>): string => t(`trig_${key}`, values)
  const names = namesOf(world)
  const story = world.triggers?.some(trigger => trigger.status !== undefined) === true
  const triggers = world.triggers ?? []
  const meta = (trigger: WorldTrigger): string[] => [
    ...(trigger.repeat ? [say('repeats')] : []),
    ...(trigger.cooldownSeconds === undefined ? [] : [say('cooldown', { time: `${Math.round(trigger.cooldownSeconds / 60)} min` })]),
    ...(trigger.chance === undefined ? [] : [say('chance', { percent: Math.round(trigger.chance * 100) })]),
    ...(trigger.priority === 0 ? [] : [say('priority', { value: trigger.priority })]),
    ...(trigger.expires === undefined ? [] : [say('expires', { at: trigger.expires.replace('T', ' ') })]),
    ...(trigger.announced ? [say('announced')] : []),
  ]
  return (
    <div className={css.panel}>
      <div className={css.tabs}><span className={css.tabsSpace} />{actions}</div>
      <div className={css.body}>
        <article className={css.sheet}>
          <p>{story ? t('trig_helpStory') : t('trig_help')}</p>
          {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
          {writable && (adding === undefined
            ? <div><Button variant="ghost" size="sm" onClick={() => { setAdding('') }}>{t('trig_addTrigger')}</Button></div>
            : <div className={css.row}><Input value={adding} placeholder={t('trig_newKey')} aria-label={t('trig_newKey')} onChange={event => { setAdding(event.target.value) }} /><Button size="sm" onClick={add}>{t('trig_editTrigger')}</Button><Button variant="ghost" size="sm" onClick={() => { setAdding(undefined) }}>{t('trig_cancelTrigger')}</Button></div>)}
          {editing?.created === true && <TriggerEditor t={t} editing={editing} onText={text => { setEditing({ ...editing, text }) }} onSave={save} onCancel={() => { setEditing(undefined) }} />}
          {world.triggersProblem !== undefined && <p className={css.error} role="alert">{t('trig_fileProblem', { message: world.triggersProblem })}</p>}
          {world.triggersProblem === undefined && triggers.length === 0 && <p>{t('trig_none')}</p>}
          {triggers.map(trigger => (
            <section key={trigger.key} className={css.section} data-testid={`roleplay-trigger-${trigger.key}`}>
              <h3 className={css.sectionTitle}>{trigger.name} <Tag>{trigger.key}</Tag>{trigger.status !== undefined && <> <Tag>{say(STATUS[trigger.status])}</Tag>{trigger.fireCount !== undefined && trigger.fireCount > 0 && <span> {say('firedCount', { count: trigger.fireCount })}</span>}</>}{trigger.origin === 'story' && <> <Tag>{say('fromStory')}</Tag></>}</h3>
              <p><span className={css.label}>{say('when')}</span> {describeCondition(say, names, trigger.when)}</p>
              <div><span className={css.label}>{say('then')}</span><ul>{trigger.effects.map((effect, index) => <li key={index}>{describeEffect(say, names, effect)}</li>)}</ul></div>
              {meta(trigger).length > 0 && <p>{meta(trigger).join(' · ')}</p>}
              {writable && editing?.key !== trigger.key && <p><Button variant="ghost" size="sm" onClick={() => { edit(trigger.key) }}>{t('trig_editTrigger')}</Button> {removing === trigger.key
                ? <><Button variant="primary" size="sm" onClick={() => { remove(trigger.key) }}>{t('trig_removeConfirm', { key: trigger.key })}</Button> <Button variant="ghost" size="sm" onClick={() => { setRemoving(undefined) }}>{t('trig_cancelTrigger')}</Button></>
                : <Button variant="ghost" size="sm" onClick={() => { setRemoving(trigger.key) }}>{t('trig_removeTrigger')}</Button>}</p>}
              {editing !== undefined && editing.created !== true && editing.key === trigger.key && <TriggerEditor t={t} editing={editing} onText={text => { setEditing({ ...editing, text }) }} onSave={save} onCancel={() => { setEditing(undefined) }} />}
              {trigger.problems.length > 0 && <div className={css.error} role="alert"><strong>{say('problems')}</strong><ul>{trigger.problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div>}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}

function TriggerEditor({ t, editing, onText, onSave, onCancel }: { t: Translate; editing: Editing; onText: (text: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div data-testid="roleplay-trigger-editor">
      <p className={css.portraitHint}>{t('trig_editHelp')}</p>
      <textarea className={css.area} rows={14} spellCheck={false} style={{ fontFamily: 'monospace' }} aria-label={editing.key} value={editing.state === 'loading' ? t('trig_editing') : editing.text} disabled={editing.state !== 'ready'} onChange={event => { onText(event.target.value) }} />
      {editing.error !== undefined && <p className={css.error} role="alert">{editing.error}</p>}
      <p><Button size="sm" disabled={editing.state !== 'ready'} onClick={onSave}>{editing.state === 'saving' ? t('trig_saving') : t('trig_saveTrigger')}</Button> <Button variant="ghost" size="sm" onClick={onCancel}>{t('trig_cancelTrigger')}</Button></p>
    </div>
  )
}
