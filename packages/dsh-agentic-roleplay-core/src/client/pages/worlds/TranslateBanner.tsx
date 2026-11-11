import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { storyLanguageOf, translateWorld, worldLanguages, type StoryLanguage } from './translate-api.ts'
import css from './TranslateBanner.module.css'

type Translate = TranslateNS<'roleplay.worlds'>

/** A language by name in the person's own language; the two the plugin has texts for use them, any other is named by the browser. */
export function languageName(t: Translate, language: string): string {
  if (language === 'zh') return t('languageChinese')
  if (language === 'en') return t('languageEnglish')
  try { return new Intl.DisplayNames([t('language')], { type: 'language' }).of(language) ?? language } catch { return language }
}

/** The language a world is written in, read from the host; nothing while it is being read or when it cannot be told. */
export function useWorldLanguage(worldId: string): StoryLanguage | undefined {
  return useWorldLanguages(worldId).written
}

/** Both languages of a world: the one its words are in, and the one its file declares for its stories. */
export function useWorldLanguages(worldId: string): { written?: StoryLanguage; declared?: string } {
  const [languages, setLanguages] = useState<{ written?: StoryLanguage; declared?: string }>({})
  useEffect(() => {
    const abort = new AbortController()
    setLanguages({})
    worldLanguages(worldId, abort.signal).then(setLanguages, () => undefined)
    return () => { abort.abort() }
  }, [worldId])
  return languages
}

/** Says that a world is written in another language than the person's, and offers to translate it into a copy. */
export function TranslateBanner({ t, worldId, worldName, openChat }: { t: Translate; worldId: string; worldName: string; openChat: (chatSessionId: string) => void }) {
  const own = storyLanguageOf(t('language'))
  const written = useWorldLanguage(worldId)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  if (written === undefined || written === own) return null
  const translate = (): void => {
    setBusy(true)
    setFailure(undefined)
    translateWorld(worldId, own, t('translateChatTitle', { name: worldName }), t('language')).then(
      (opened) => { setBusy(false); if (!opened.started) setFailure(t('translateNotStarted', { message: opened.failure ?? '' })); openChat(opened.chatSessionId) },
      (error: unknown) => { setBusy(false); setFailure(t('translateFailed', { message: error instanceof Error ? error.message : String(error) })) },
    )
  }
  return (
    <>
      <div className={css.banner} role="status" data-testid="roleplay-translate-banner">
        <span className={css.text}>{t('translateWarning', { from: languageName(t, written), to: languageName(t, own) })}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={translate}>{busy ? t('translateOpening') : t('translateAction', { to: languageName(t, own) })}</Button>
      </div>
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
    </>
  )
}
