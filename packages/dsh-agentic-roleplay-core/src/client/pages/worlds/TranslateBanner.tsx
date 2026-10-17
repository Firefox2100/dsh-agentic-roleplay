import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { storyLanguageOf, translateWorld, worldLanguage, type StoryLanguage } from './translate-api.ts'
import css from './TranslateBanner.module.css'

type Translate = TranslateNS<'roleplay.worlds'>

export const languageName = (t: Translate, language: StoryLanguage): string => (language === 'zh' ? t('languageChinese') : t('languageEnglish'))

/** The language a world is written in, read from the host; nothing while it is being read or when it cannot be told. */
export function useWorldLanguage(worldId: string): StoryLanguage | undefined {
  const [language, setLanguage] = useState<StoryLanguage | undefined>()
  useEffect(() => {
    const abort = new AbortController()
    setLanguage(undefined)
    worldLanguage(worldId, abort.signal).then(setLanguage, () => undefined)
    return () => { abort.abort() }
  }, [worldId])
  return language
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
