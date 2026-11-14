import { useEffect, useState } from 'react'

/** Whether a text-to-speech and an image-generation service are selected in this DSH: the buttons that need one are shown only then. */
export interface MediaCapabilities { synthesis: boolean; images: boolean }

/** A choice in the provider settings takes effect without a restart, so the answer is asked for again after a short while. */
const FRESH_MS = 15_000
let asked: { at: number; value: Promise<MediaCapabilities> } | undefined

export function mediaCapabilities(): Promise<MediaCapabilities> {
  if (asked !== undefined && Date.now() - asked.at < FRESH_MS) return asked.value
  const value = fetch('roleplay-api/speech/capabilities', { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status))
      const body = await response.json() as Partial<MediaCapabilities>
      return { synthesis: body.synthesis === true, images: body.images === true }
    })
    // a host that cannot say is not taken to lack them: the control is shown and fails with its own reason
    .catch((): MediaCapabilities => ({ synthesis: true, images: true }))
  asked = { at: Date.now(), value }
  return value
}

/**
 * The capabilities, asked for now and then again, and told to `notify` as they change; the returned function stops the asking. Plain, so that a test can watch it without a page.
 */
export function watchMediaCapabilities(notify: (value: MediaCapabilities) => void): () => void {
  let stopped = false
  const load = (): void => { mediaCapabilities().then((value) => { if (!stopped) notify(value) }, () => undefined) }
  load()
  const timer = setInterval(load, FRESH_MS)
  return () => { stopped = true; clearInterval(timer) }
}

/** The capabilities, or nothing until the host has answered, so that a control that may not belong is not shown and taken away again. */
export function useMediaCapabilities(): MediaCapabilities | undefined {
  const [found, setFound] = useState<MediaCapabilities | undefined>()
  useEffect(() => watchMediaCapabilities(setFound), [])
  return found
}
