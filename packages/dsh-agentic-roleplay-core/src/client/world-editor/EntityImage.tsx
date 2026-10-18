import { useState } from 'react'
import type { Translate } from './WorldEditor.tsx'
import type { WorldSource } from './source.ts'
import type { WorldState } from '../../shared/world-state.ts'
import css from './CharactersPanel.module.css'

/** A steady colour per name, for a picture that does not exist yet. */
function hueOf(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** The reference picture of a place or a thing: shown, generated from its saved visual identity, or brought as a PNG. */
export function EntityImage({ t, kind, entry, hasIdentity, dirty, source, onChanged }: {
  t: Translate
  kind: 'place' | 'thing'
  entry: { key: string; name: string; image?: string }
  /** Whether the visual identity is saved: a picture is made from the saved one. */
  hasIdentity: boolean
  dirty: boolean
  source: WorldSource
  onChanged: (world: WorldState) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = (job: () => Promise<WorldState>): void => {
    setBusy(true)
    setError(undefined)
    job().then(
      (next) => { setBusy(false); onChanged(next) },
      (failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : String(failure)) },
    )
  }
  const action = busy ? t('portraitGenerating') : entry.image === undefined ? t('imageGenerate') : t('imageRetry')
  return (
    <div data-testid={`roleplay-${kind}-image`}>
      <button className={css.portraitBox} type="button" disabled={dirty || busy || !hasIdentity} aria-label={action} title={action} onClick={() => { run(() => source.generateImage(kind, entry.key, new AbortController().signal)) }}>
        {entry.image !== undefined
          ? <img className={css.portrait} src={entry.image} alt="" loading="lazy" decoding="async" />
          : <div className={`${css.portrait} ${css.placeholder}`} style={{ background: `hsl(${hueOf(entry.name)} 22% 88%)` }} role="img" aria-label={t('imageMissing')}>
              <span className={css.initial} aria-hidden="true">{Array.from(entry.name)[0]?.toUpperCase()}</span>
              <span className={css.missing}>{t('imageMissing')}</span>
            </div>}
        <span className={css.portraitAction}>{action}</span>
      </button>
      <label className={css.portraitHint}>
        <input type="file" accept="image/png" hidden disabled={dirty || busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) run(() => source.uploadImage(kind, entry.key, file, new AbortController().signal)) }} />
        <span role="button" tabIndex={0}>{t('imageUpload')}</span>
      </label>
      {error !== undefined && <p className={css.portraitError} role="alert">{t('imageFailed', { message: error })}</p>}
      {!hasIdentity && <p className={css.portraitHint}>{t('imageIdentityRequired')}</p>}
      {dirty && hasIdentity && <p className={css.portraitHint}>{t('portraitSaveFirst')}</p>}
    </div>
  )
}
