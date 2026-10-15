import { useEffect, useMemo, useRef, useState } from 'react'
import { isStrip, type InterfaceDescription, type PlayerView, type SurfaceName } from '../../shared/interface-pack.ts'
import { frameAddress, historyOf, storeOf } from './api.ts'
import { Bridge, clampHeight, parseFrameMessage, type Answer, type BridgeEnv } from './bridge.ts'
import css from './PackFrame.module.css'
import { readTheme, watchTheme } from './theme.ts'

/** What the page does for a surface when it asks to speak or to fill the input. */
export interface FrameInput {
  say: (text: string) => void
  fill: (text: string) => void
  /** Shows the pack's own tab or its page in the right sidebar. */
  open: (surface: 'tab' | 'sidebar') => void
}

export interface PackFrameProps {
  /** The roleplay session. */
  session: string
  pack: InterfaceDescription
  surface: SurfaceName
  view: PlayerView | undefined
  input: FrameInput
  /** Called with the height the surface asks for (pixels), when it asks. */
  onResize?: (height: number) => void
  /** The frame takes the height of its container instead of its own. */
  fill?: boolean
  height?: number
  title: string
}

/**
 * A surface of a pack, in a frame that can run its scripts and nothing more: no access to this page,
 * its storage or the network. The only way out is the bridge, which answers what the pack asked for.
 */
export function PackFrame({ session, pack, surface, view, input, onResize, fill, height, title }: PackFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const latest = useRef({ view, input, actions: pack.actions })
  const before = useRef<PlayerView | undefined>(undefined)
  latest.current = { view, input, actions: pack.actions }
  const file = pack.surfaces[surface]?.file

  const bridge = useMemo(() => {
    const env: BridgeEnv = {
      get actions() { return latest.current.actions },
      view: () => latest.current.view,
      say: (text) => { latest.current.input.say(text) },
      fill: (text) => { latest.current.input.fill(text) },
      open: (surface) => { latest.current.input.open(surface) },
      history: limit => historyOf(session, limit),
      storage: (op, key, value) => storeOf(session, { op, key, ...(value === undefined ? {} : { value }) }),
      theme: () => readTheme(),
      now: () => Date.now(),
    }
    return new Bridge(env)
  }, [session])

  const send = (message: Record<string, unknown>): void => { frame.current?.contentWindow?.postMessage({ rp: 1, ...message }, '*') }

  useEffect(() => {
    setReady(false)
    before.current = undefined
    const onMessage = (event: MessageEvent): void => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return
      const message = parseFrameMessage(event.data)
      if (message === undefined) return
      if (message.type === 'hello') setReady(true)
      else if (message.type === 'resize') { if (isStrip(surface)) onResize?.(clampHeight(message.height, surface)) }
      else void bridge.answer(message).then((answer: Answer) => { send({ type: 'response', id: message.id, ...(answer.ok ? { ok: true, value: answer.value } : { ok: false, error: answer.error }) }) })
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [bridge, file, pack.revision, onResize, surface])

  useEffect(() => {
    if (!ready) return undefined
    const push = (): void => { send({ type: 'event', name: 'theme', data: readTheme() }) }
    push()
    return watchTheme(push)
  }, [ready])

  useEffect(() => {
    if (!ready || view === undefined) return
    send({ type: 'event', name: 'state', data: view })
    const previous = before.current
    if (previous !== undefined && view.story.turn !== previous.story.turn) send({ type: 'event', name: 'turn', data: { turn: view.story.turn } })
    if (previous !== undefined && JSON.stringify(view.suggestions) !== JSON.stringify(previous.suggestions)) send({ type: 'event', name: 'suggestions', data: view.suggestions })
    before.current = view
  }, [ready, view])

  if (file === undefined) return null
  return (
    <iframe
      ref={frame}
      className={`${css.frame}${fill === true ? ` ${css.fill}` : ''}`}
      style={fill === true ? undefined : { height: `${height ?? pack.surfaces[surface]?.height ?? 56}px` }}
      title={title}
      src={frameAddress(pack.frame, file, pack.revision)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      data-rp-frame={surface}
    />
  )
}
