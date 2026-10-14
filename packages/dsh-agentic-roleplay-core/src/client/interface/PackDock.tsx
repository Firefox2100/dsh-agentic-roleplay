import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { PackToken, StripSurface } from '../../shared/interface-pack.ts'
import { useBackdropHost } from './backdrop.ts'
import { usePack, usePlayerView } from './hooks.ts'
import { PackFrame, type FrameInput } from './PackFrame.tsx'
import css from './PackFrame.module.css'

/** What a dock needs of the page: which strip it is, the input box, and the theme service to lay the pack's colours over DSH's. */
export interface DockInjected {
  surface: StripSurface
  frameInput: FrameInput
  overrideTokens: (source: string, tokens: Record<string, PackToken>) => () => void
}

export type PackDockProps = PropsRuntime<'conversation.input.dock'> & DockInjected & PropsLocale<'roleplay.interface'>

/**
 * A strip of the story's interface pack in the chat: `hud` above the input box and its docks, `dock` just above the
 * input, `opening` in the place of both until the first turn has been played. The `hud` one also puts the pack's
 * colours and skin into the page, so that they come with the pack even when it has no strip. Renders nothing for a
 * story without such a strip.
 */
export function PackDock({ sessionId, surface, frameInput, overrideTokens, useSession, t }: PackDockProps) {
  const session = roleplaySessionOf(sessionId)
  const payload = usePack(session)
  const pack = payload?.pack ?? undefined
  const strip = pack?.surfaces[surface]
  const backdrop = surface === 'hud' ? pack?.surfaces.backdrop : undefined
  const anchor = useRef<HTMLSpanElement>(null)
  const layer = useBackdropHost(anchor, backdrop !== undefined)
  const running = useSession(state => state.running)
  const view = usePlayerView(session, strip !== undefined || backdrop !== undefined)
  const [height, setHeight] = useState<number | undefined>(undefined)
  const resize = useCallback((next: number) => { setHeight(next) }, [])

  useEffect(() => {
    if (surface !== 'hud' || pack === undefined || pack.skin === '') return undefined
    const style = document.createElement('style')
    style.setAttribute('data-roleplay-pack', pack.id)
    style.textContent = pack.skin
    document.head.append(style)
    return () => { style.remove() }
  }, [surface, pack?.id, pack?.skin])

  const tokens = pack?.theme
  useEffect(() => {
    if (surface !== 'hud' || tokens === undefined || Object.keys(tokens).length === 0) return undefined
    return overrideTokens('roleplay-pack', tokens)
  }, [surface, tokens, overrideTokens])

  if (session === undefined || pack === undefined) return null
  const shown = strip !== undefined && !(surface === 'opening' && (running || view === undefined || view.story.turn > 0))
  if (!shown && backdrop === undefined) return null
  return (
    <>
      {shown && strip !== undefined && (
        <div className={css.hud} data-rp={surface}>
          <PackFrame session={session} pack={pack} surface={surface} view={view} input={frameInput} onResize={resize} {...(height === undefined && strip.height === undefined ? {} : { height: height ?? strip.height as number })} title={t(surface)} />
        </div>
      )}
      {backdrop !== undefined && <span ref={anchor} hidden />}
      {layer !== undefined && createPortal(<PackFrame session={session} pack={pack} surface="backdrop" view={view} input={frameInput} fill title={t('backdrop')} />, layer)}
    </>
  )
}
