import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { CHARACTER_KINDS, CHARACTER_ROLES, CHARACTER_TIERS, INTENT_STATUSES } from 'dsh-roleplay-model'
import type { WorldCharacter, WorldState } from '../../shared/world-state.ts'
import { draftProblems, editOf, isDirty, toDraft, type CharacterDraft } from './character-draft.ts'
import { RefusedEditError, type WorldSource } from './source.ts'
import type { Translate } from './WorldEditor.tsx'
import css from './CharactersPanel.module.css'

/** A steady colour per name, for a portrait that does not exist yet. */
function hueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

function Portrait({ character, t, generating, disabled, onGenerate }: { character: WorldCharacter; t: Translate; generating: boolean; disabled: boolean; onGenerate: () => void }) {
  const action = generating ? t('portraitGenerating') : character.portrait === undefined ? t('portraitGenerate') : t('portraitRetry')
  return <button className={css.portraitBox} type="button" disabled={disabled || generating} aria-label={action} title={action} onClick={onGenerate}>
    {character.portrait !== undefined
      ? <img className={css.portrait} src={character.portrait} alt="" />
      : <div className={`${css.portrait} ${css.placeholder}`} style={{ background: `hsl(${hueOf(character.name)} 22% 88%)` }} role="img" aria-label={t('portraitMissing')}>
          <span className={css.initial} aria-hidden="true">{Array.from(character.name)[0]?.toUpperCase()}</span>
          <span className={css.missing}>{t('portraitMissing')}</span>
        </div>}
    <span className={css.portraitAction}>{action}</span>
  </button>
}

function Field({ label, help, error, wide, children }: { label: string; help?: string; error?: string | undefined; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`${css.field} ${wide === true ? css.wide : ''}`}>
      <span className={css.label}>{label}</span>
      {children}
      {help !== undefined && <span className={css.help}>{help}</span>}
      {error !== undefined && <span className={css.error} role="alert">{error}</span>}
    </label>
  )
}

function Area({ value, rows, onChange, invalid }: { value: string; rows: number; onChange: (value: string) => void; invalid?: boolean }) {
  return <textarea className={css.area} rows={rows} value={value} aria-invalid={invalid} onChange={(event) => { onChange(event.target.value) }} />
}

function Choice<T extends string>({ value, options, label, onChange }: { value: T; options: readonly T[]; label: (option: T) => string; onChange: (value: T) => void }) {
  return (
    <select className={css.select} value={value} onChange={(event) => { onChange(event.target.value as T) }}>
      {options.map(option => <option key={option} value={option}>{label(option)}</option>)}
    </select>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

/** One character as an editable page, like a CV: the portrait and the short facts above, what is written about it below. */
function Sheet({ t, character, places, voices, draft, onChange, generating, portraitDisabled, onGenerate }: { t: Translate; character: WorldCharacter; places: WorldState['places']; voices: { id: string; name?: string }[]; draft: CharacterDraft; onChange: (draft: CharacterDraft) => void; generating: boolean; portraitDisabled: boolean; onGenerate: () => void }) {
  const set = <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]): void => { onChange({ ...draft, [key]: value }) }
  const problems = draftProblems(draft)
  const known = places.some(place => place.key === draft.place)
  return (
    <article className={css.sheet} data-testid="roleplay-character">
      <header className={css.head}>
        <Portrait character={character} t={t} generating={generating} disabled={portraitDisabled} onGenerate={onGenerate} />
        <div className={css.meta}>
          <Input value={draft.name} aria-label={t('name')} aria-invalid={problems.has('name')} onChange={(event) => { set('name', event.target.value) }} />
          {problems.has('name') && <span className={css.error} role="alert">{t('invalidName')}</span>}
          <div className={css.row}>
            <Choice value={draft.role} options={CHARACTER_ROLES} label={option => t(option)} onChange={(value) => { set('role', value) }} />
            <Choice value={draft.tier} options={CHARACTER_TIERS} label={option => t(option)} onChange={(value) => { set('tier', value) }} />
            <Choice value={draft.kind} options={CHARACTER_KINDS} label={option => t(option)} onChange={(value) => { set('kind', value) }} />
            <Tag>{t(character.control)}</Tag>
          </div>
          {problems.has('role') && <span className={css.error} role="alert">{t('invalidPlayable')}</span>}
          <div className={css.grid}>
            <Field label={t('age')}><Input value={draft.age} onChange={(event) => { set('age', event.target.value) }} /></Field>
            <Field label={t('gender')}><Input value={draft.gender} onChange={(event) => { set('gender', event.target.value) }} /></Field>
            <Field label={t('pronouns')}><Input value={draft.pronouns} onChange={(event) => { set('pronouns', event.target.value) }} /></Field>
            <Field label={t('aliases')} help={t('aliasesHelp')}><Input value={draft.aliases} onChange={(event) => { set('aliases', event.target.value) }} /></Field>
            <Field label={t('where')}>
              <select className={css.select} value={draft.place} onChange={(event) => { set('place', event.target.value) }}>
                {draft.place === '' && <option value="">{t('noPlace')}</option>}
                {!known && draft.place !== '' && <option value={draft.place}>{draft.place}</option>}
                {places.map(place => <option key={place.key} value={place.key}>{place.name}</option>)}
              </select>
            </Field>
            <Field label={t('position')}><Input value={draft.position} disabled={draft.place === ''} onChange={(event) => { set('position', event.target.value) }} /></Field>
            <Field label={t('doing')} wide><Input value={draft.activity} onChange={(event) => { set('activity', event.target.value) }} /></Field>
          </div>
        </div>
      </header>

      <Section title={t('summary')}><Area value={draft.summary} rows={2} onChange={(value) => { set('summary', value) }} /></Section>
      <Section title={t('personality')}><Area value={draft.personality} rows={4} onChange={(value) => { set('personality', value) }} /></Section>
      <Section title={t('backgroundText')}><Area value={draft.background} rows={4} onChange={(value) => { set('background', value) }} /></Section>
      <Section title={t('appearance')}><Area value={draft.appearance} rows={3} onChange={(value) => { set('appearance', value) }} /></Section>
      <Section title={t('visualIdentity')}>
        <Field label={t('visualDescription')} help={t('visualDescriptionHelp')}><Area value={draft.visualDescription} rows={3} onChange={(value) => { set('visualDescription', value) }} /></Field>
        <div className={css.grid}>
          <Field label={t('visualTags')} help={t('visualTagsHelp')}><Input value={draft.visualTags} onChange={(event) => { set('visualTags', event.target.value) }} /></Field>
          <Field label={t('visualNegativeTags')}><Input value={draft.visualNegativeTags} onChange={(event) => { set('visualNegativeTags', event.target.value) }} /></Field>
          <Field label={t('visualGlobalId')}><Input value={draft.visualGlobalId} onChange={(event) => { set('visualGlobalId', event.target.value) }} /></Field>
        </div>
      </Section>
      <Section title={t('speech')}><Field label={t('voice')} help={t('voiceHelp')}><Input list="roleplay-tts-voices" value={draft.voice} onChange={(event) => { set('voice', event.target.value) }} /><datalist id="roleplay-tts-voices">{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name ?? voice.id}</option>)}</datalist></Field>
        <Field label={t('speechStyle')}><Area value={draft.speechStyle} rows={2} onChange={(value) => { set('speechStyle', value) }} /></Field>
        <Field label={t('speechExamples')} help={t('speechExamplesHelp')}><Area value={draft.speechExamples} rows={3} onChange={(value) => { set('speechExamples', value) }} /></Field>
      </Section>
      <Section title={t('state')}>
        <Field label={t('publicState')}><Area value={draft.publicState} rows={2} onChange={(value) => { set('publicState', value) }} /></Field>
        <Field label={t('innerState')}><Area value={draft.innerState} rows={2} onChange={(value) => { set('innerState', value) }} /></Field>
      </Section>
      <Section title={t('goals')}>
        {draft.goals.length === 0 && <p className={css.empty}>{t('noGoals')}</p>}
        {draft.goals.map((goal, index) => {
          const change = (patch: Partial<CharacterDraft['goals'][number]>): void => { set('goals', draft.goals.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))) }
          return (
            <div key={goal.ref} className={css.goal}>
              <div className={css.grid}>
                <Field label={t('goalName')} error={problems.has(`goal.${index}.name`) ? t('invalidName') : undefined}><Input value={goal.name} onChange={(event) => { change({ name: event.target.value }) }} /></Field>
                <Field label={t('goalStatus')}><Choice value={goal.status} options={INTENT_STATUSES} label={option => t(option)} onChange={(value) => { change({ status: value }) }} /></Field>
                <Field label={t('goalPriority')} error={problems.has(`goal.${index}.priority`) ? t('invalidPriority') : undefined}><Input value={goal.priority} inputMode="decimal" onChange={(event) => { change({ priority: event.target.value }) }} /></Field>
              </div>
              <Field label={t('goalDescription')}><Area value={goal.description} rows={2} onChange={(value) => { change({ description: value }) }} /></Field>
            </div>
          )
        })}
      </Section>
    </article>
  )
}

type Saving = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'failed'; message: string }

/** The characters of the story: one tab each along the top, and the editable sheet of the one chosen. Drafts are kept while another character is looked at. */
export function CharactersPanel({ t, world, source, onChanged, actions, initial }: {
  t: Translate
  world: WorldState
  source: WorldSource
  onChanged: (world: WorldState) => void
  /** Shown at the right end of the tabs. */
  actions: React.ReactNode
  /** The character that is open first. */
  initial?: string
}) {
  const [chosen, setChosen] = useState<string | undefined>(initial)
  const [drafts, setDrafts] = useState<Record<string, CharacterDraft>>({})
  const [saving, setSaving] = useState<Saving>({ status: 'idle' })
  const [portrait, setPortrait] = useState<{ key?: string; error?: string }>({})
  const [voices, setVoices] = useState<{ id: string; name?: string }[]>([])
  const [narrationVoice, setNarrationVoice] = useState(world.narrationVoice ?? '')
  const body = useRef<HTMLDivElement>(null)
  const current = world.characters.find(character => character.key === chosen) ?? world.characters[0]

  useEffect(() => { body.current?.scrollTo({ top: 0 }) }, [current?.key])
  useEffect(() => { const abort = new AbortController(); source.listVoices(abort.signal).then(setVoices, () => setVoices([])); return () => abort.abort() }, [source])
  useEffect(() => { setNarrationVoice(world.narrationVoice ?? '') }, [world.narrationVoice])

  if (current === undefined) return <p className={css.empty}>{t('noCharacters')}</p>
  const draftOf = (character: WorldCharacter): CharacterDraft => drafts[character.key] ?? toDraft(character)
  const draft = draftOf(current)
  const dirty = isDirty(current, draft)
  const invalid = draftProblems(draft).size > 0

  const save = (): void => {
    const edit = editOf(current, draft)
    if (Object.keys(edit).length === 0 || invalid) return
    setSaving({ status: 'saving' })
    source.saveCharacter(current.key, edit, new AbortController().signal).then(
      (next) => {
        setDrafts(({ [current.key]: _saved, ...rest }) => rest)
        setSaving({ status: 'saved' })
        onChanged(next)
      },
      (failure: unknown) => { setSaving({ status: 'failed', message: failure instanceof RefusedEditError || failure instanceof Error ? failure.message : String(failure) }) },
    )
  }
  const reset = (): void => {
    setDrafts(({ [current.key]: _discarded, ...rest }) => rest)
    setSaving({ status: 'idle' })
  }
  const uploadPortrait = (file: File | undefined): void => {
    if (file === undefined || dirty) return
    setPortrait({ key: current.key })
    source.uploadPortrait(current.key, file, new AbortController().signal).then(
      (next) => { setPortrait({}); onChanged(next) },
      (failure: unknown) => { setPortrait({ error: failure instanceof Error ? failure.message : String(failure) }) },
    )
  }
  const generatePortrait = (): void => {
    if (dirty) return
    setPortrait({ key: current.key })
    source.generatePortrait(current.key, new AbortController().signal).then(
      (next) => { setPortrait({}); onChanged(next) },
      (failure: unknown) => { setPortrait({ error: failure instanceof Error ? failure.message : String(failure) }) },
    )
  }

  return (
    <div className={css.panel}>
      <div className={css.tabs} role="tablist" aria-label={t('characters')}>
        {world.characters.map(character => (
          <button
            key={character.key}
            type="button"
            role="tab"
            aria-selected={character.key === current.key}
            className={`${css.tab} ${character.key === current.key ? css.tabOn : ''}`}
            onClick={() => { setChosen(character.key); setSaving({ status: 'idle' }) }}
          >
            {character.name}{isDirty(character, draftOf(character)) ? ' •' : ''}
          </button>
        ))}
        <span className={css.tabsSpace} />
        <label className={css.voiceInline}>{t('narrationVoice')}<Input list="roleplay-tts-voices" value={narrationVoice} onChange={event => setNarrationVoice(event.target.value)} /></label>
        {narrationVoice !== (world.narrationVoice ?? '') && <Button variant="primary" size="sm" onClick={() => { source.saveNarrationVoice(narrationVoice, new AbortController().signal).then(onChanged) }}>{t('save')}</Button>}
        {actions}
      </div>
      {(dirty || saving.status !== 'idle') && (
        <div className={css.bar} role="status">
          {saving.status === 'failed'
            ? <span className={css.error}>{t('saveFailed', { message: saving.message })}</span>
            : <span className={css.barText}>{dirty ? t('unsaved') : saving.status === 'saved' ? t('saved') : ''}</span>}
          {dirty && <Button variant="ghost" size="sm" onClick={reset} disabled={saving.status === 'saving'}>{t('reset')}</Button>}
          {dirty && <Button variant="primary" size="sm" onClick={save} disabled={invalid || saving.status === 'saving'}>{saving.status === 'saving' ? t('saving') : t('save')}</Button>}
        </div>
      )}
      <div className={css.body} ref={body}>
        <div><label className={css.portraitHint}><input type="file" accept="image/png" hidden disabled={dirty || portrait.key === current.key} onChange={(event) => { uploadPortrait(event.target.files?.[0]); event.target.value = '' }} /><span role="button" tabIndex={0}>{t('portraitUpload')}</span></label></div>
        {portrait.error !== undefined && <p className={css.portraitError} role="alert">{t('portraitFailed', { message: portrait.error })}</p>}
        {draft.visualDescription.trim() === '' && <p className={css.portraitHint}>{t('portraitIdentityRequired')}</p>}
        {dirty && draft.visualDescription.trim() !== '' && <p className={css.portraitHint}>{t('portraitSaveFirst')}</p>}
        <Sheet t={t} character={current} places={world.places} voices={voices} draft={draft} generating={portrait.key === current.key} portraitDisabled={dirty} onGenerate={generatePortrait} onChange={(next) => { setDrafts({ ...drafts, [current.key]: next }); setPortrait({}); if (saving.status !== 'saving') setSaving({ status: 'idle' }) }} />
      </div>
    </div>
  )
}
