import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SceneImageStatus } from '../../shared/images.ts'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { MediaImage } from '../widgets/media-image/MediaImage.tsx'
import css from './NarrationView.module.css'

async function request(chat: string, node: string, method: 'GET' | 'POST'): Promise<SceneImageStatus> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/images?id=${encodeURIComponent(id)}&node=${encodeURIComponent(node)}`, { method })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `image request failed (${response.status})`)
  return await response.json() as SceneImageStatus
}

export function SceneImages({ chat, node, t }: { chat: string; node: string; t: TranslateNS<'roleplay.transcript'> }) {
  const [status, setStatus] = useState<SceneImageStatus>()
  const [error, setError] = useState<string>()
  const refresh = useCallback(() => {
    request(chat, node, 'GET').then((next) => { setStatus(next); setError(undefined) }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }, [chat, node])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (status?.state !== 'generating') return
    const timer = window.setTimeout(refresh, 1500)
    return () => { window.clearTimeout(timer) }
  }, [refresh, status])
  const generate = () => {
    setStatus(current => current === undefined ? current : { ...current, state: 'generating' })
    setError(undefined)
    request(chat, node, 'POST').then(setStatus).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)); refresh() })
  }
  if (status?.mode === 'off') return null
  return (
    <div className={css.images} data-testid="roleplay-scene-images">
      {status?.images.map(image => <MediaImage key={image.serial} src={image.url} alt={t('sceneImage')} details={image.details} labels={{ description: t('imageDescription'), prompt: t('imagePrompt'), subjects: t('imageSubjects'), reusable: t('imageReusable'), uploaded: t('imageUploaded'), dialog: t('imageDialog'), close: t('imageClose') }} className={css.sceneImage} onOpenClassName={css.imageButton} />)}
      {status?.state === 'generating' && <span className={css.imageStatus}>{t('imageGenerating')}</span>}
      {(status?.state === 'absent' || status?.state === 'failed') && <Button size="sm" onClick={generate}>{status.state === 'failed' ? t('imageRetry') : t('imageGenerate')}</Button>}
      {status?.state === 'ready' && <Button size="sm" onClick={generate}>{t('imageAnother')}</Button>}
      {(error ?? status?.message) !== undefined && <span className={css.imageError}>{error ?? status?.message}</span>}
    </div>
  )
}
