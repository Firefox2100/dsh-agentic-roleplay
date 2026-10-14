import { useEffect, useState, type RefObject } from 'react'
import { conversationBody } from './conversation-body.ts'

const LIFTED = 'data-rp-lifted'
const STYLE = 'data-roleplay-backdrop-style'

/**
 * A layer behind the transcript of the chat that `anchor` stands in, for a pack's backdrop. The conversation paints its
 * own opaque background and its scrolling body above any layer under it, so the layer is put first in the body and the
 * scrolling body is lifted over it; both stay transparent to clicks. When the page is not built as expected there is
 * no layer and a note in the console, and the story plays as it does without a backdrop.
 */
export function useBackdropHost(anchor: RefObject<Element | null>, enabled: boolean): HTMLElement | undefined {
  const [host, setHost] = useState<HTMLElement | undefined>(undefined)
  useEffect(() => {
    const from = anchor.current
    if (!enabled || from === null) { setHost(undefined); return undefined }
    const found = conversationBody(from)
    if (found === undefined) { console.warn('roleplay: the interface pack has a backdrop, but this page has no place for one'); setHost(undefined); return undefined }
    const layer = document.createElement('div')
    layer.setAttribute('data-rp', 'backdrop')
    layer.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden'
    found.body.insertBefore(layer, found.body.firstChild)
    found.scroll.setAttribute(LIFTED, '')
    let style = document.head.querySelector(`style[${STYLE}]`)
    if (style === null) {
      style = document.createElement('style')
      style.setAttribute(STYLE, '')
      style.textContent = `[${LIFTED}]{position:relative;z-index:1}`
      document.head.append(style)
    }
    setHost(layer)
    return () => {
      layer.remove()
      found.scroll.removeAttribute(LIFTED)
      if (document.querySelector(`[${LIFTED}]`) === null) document.head.querySelector(`style[${STYLE}]`)?.remove()
      setHost(undefined)
    }
  }, [anchor, enabled])
  return host
}
