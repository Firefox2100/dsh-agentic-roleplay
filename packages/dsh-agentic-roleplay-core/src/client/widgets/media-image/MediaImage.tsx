import { useState } from 'react'
import { ImageLightbox, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GalleryImage } from '../../../shared/gallery.ts'

export interface MediaImageLabels {
  description: string
  prompt: string
  subjects: string
  /** Shown when the image may be used again in a later scene, and when the person brought it. */
  reusable: string
  uploaded: string
  /** Accessible name of the full-size view. */
  dialog: string
  close: string
}

const MAX_PROMPT = 360

/** What the tooltip of an image says: what it shows, who is in it, and the prompt it was made from. */
export function imageSummary(details: GalleryImage | undefined, labels: MediaImageLabels): string {
  if (details === undefined || details.unreadable === true) return ''
  const prompt = details.prompt === undefined ? undefined : details.prompt.length > MAX_PROMPT ? `${details.prompt.slice(0, MAX_PROMPT)}…` : details.prompt
  const flags = [details.origin === 'uploaded' ? labels.uploaded : undefined, details.reusable ? labels.reusable : undefined].filter(flag => flag !== undefined).join(' · ')
  return [
    flags === '' ? undefined : flags,
    details.description === undefined ? undefined : `${labels.description}: ${details.description}`,
    details.subjects.length === 0 ? undefined : `${labels.subjects}: ${details.subjects.map(subject => subject.name).join(', ')}`,
    prompt === undefined ? undefined : `${labels.prompt}: ${prompt}`,
  ].filter(part => part !== undefined).join('\n\n')
}

/** An image that shows what its file says about it on hover and opens full size, over the rest of the page, when clicked. */
export function MediaImage({ src, alt, details, labels, className, onOpenClassName }: { src: string; alt: string; details?: GalleryImage | undefined; labels: MediaImageLabels; className: string; onOpenClassName?: string }) {
  const [open, setOpen] = useState(false)
  const summary = imageSummary(details, labels)
  return (
    <>
      <Tooltip label={summary} side="right" delayMs={400} maxWidth={460} portal disabled={summary === ''}>
        <button type="button" className={onOpenClassName} aria-label={alt} onClick={() => { setOpen(true) }}>
          <img className={className} src={src} alt={alt} />
        </button>
      </Tooltip>
      {open && <ImageLightbox src={src} alt={alt} labels={{ dialog: labels.dialog, close: labels.close }} onClose={() => { setOpen(false) }} />}
    </>
  )
}
