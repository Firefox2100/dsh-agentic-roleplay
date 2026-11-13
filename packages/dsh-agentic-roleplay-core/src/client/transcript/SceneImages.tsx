import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useMediaCapabilities } from '../media-capabilities.ts'
import { Button } from '../ui/Button.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SceneImageStatus } from '../../shared/images.ts'
import { roleplaySessionOf } from '../../shared/chat.ts'
import { MediaImage } from '../widgets/media-image/MediaImage.tsx'
import { onPageVisible, pageVisible } from '../visibility.ts'
import css from './NarrationView.module.css'

async function request(chat: string, node: string, method: 'GET' | 'POST'): Promise<SceneImageStatus> {
  const id = roleplaySessionOf(chat)
  if (id === undefined) throw new Error('this chat is not a roleplay session')
  const response = await fetch(`roleplay-api/sessions/images?id=${encodeURIComponent(id)}&node=${encodeURIComponent(node)}`, { method })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? `image request failed (${response.status})`)
  return await response.json() as SceneImageStatus
}

/** The pictures of a turn and the buttons under it: the one that plays the turn (`leading`, when speech is available) and the one that makes a picture (when an image service is selected). */
export function SceneImages({ chat, node, t, leading }: { chat: string; node: string | undefined; t: TranslateNS<'roleplay.transcript'>; leading?: ReactNode }) {
  const capabilities = useMediaCapabilities()
  const [status, setStatus] = useState<SceneImageStatus>()
  const [error, setError] = useState<string>()
  const refresh = useCallback(() => {
    request(chat, node!, 'GET').then((next) => { setStatus(next); setError(undefined) }).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }, [chat, node])
  useEffect(() => { if (node !== undefined) refresh() }, [refresh, node])
  useEffect(() => {
    if (status?.state !== 'generating') return
    const timer = window.setTimeout(() => { if (pageVisible()) refresh() }, 1500)
    const off = onPageVisible(refresh)


    return () => { window.clearTimeout(timer); off() }
  }, [refresh, status])
  const generate = () => {
    setStatus(current => current === undefined ? current : { ...current, state: 'generating' })
    setError(undefined)
    request(chat, node!, 'POST').then(setStatus).catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)); refresh() })
  }
  const canGenerate = node !== undefined && capabilities?.images === true && status !== undefined && status.mode !== 'off'
  const pictures = status?.images ?? []
  if (leading === undefined && !canGenerate && pictures.length === 0 && (error ?? status?.message) === undefined) return null
  return (
    <div className={css.images} data-testid="roleplay-scene-images">
      {pictures.map(image => <MediaImage key={image.serial} src={image.url} alt={t('sceneImage') ?? ''} details={image.details} labels={{ description: t('imageDescription') ?? '', prompt: t('imagePrompt') ?? '', subjects: t('imageSubjects') ?? '', reusable: t('imageReusable') ?? '', uploaded: t('imageUploaded') ?? '', dialog: t('imageDialog') ?? '', close: t('imageClose') ?? '' }} className={css.sceneImage ?? ''} onOpenClassName={css.imageButton ?? ''} />)}
      <div className={css.actions}>
        {leading}
        {canGenerate && status.state === 'generating' && <span className={css.imageStatus}>{t('imageGenerating')}</span>}
        {canGenerate && (status.state === 'absent' || status.state === 'failed') && <Button size="sm" onClick={generate}>{status.state === 'failed' ? t('imageRetry') : t('imageGenerate')}</Button>}
        {canGenerate && status.state === 'ready' && <Button size="sm" onClick={generate}>{t('imageAnother')}</Button>}
      </div>
      {(error ?? status?.message) !== undefined && <span className={css.imageError}>{error ?? status?.message}</span>}
    </div>
  )
}
