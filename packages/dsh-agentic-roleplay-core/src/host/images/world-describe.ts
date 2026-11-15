import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GalleryImage } from '../../shared/gallery.ts'
import { DEFAULT_SETTINGS } from '../../shared/settings.ts'
import { childSampling } from '../agents/child.ts'
import { interpretImage, type ImageAttachments } from './interpreter.ts'

export interface WorldDescribeDeps {
  directory: string
  /** The agent of the world's authoring chat, which the description is run under; nothing when that chat is not loaded. */
  parent: Agent | undefined
  attachments: ImageAttachments | undefined
  language: string
  subjects: readonly { kind: 'character' | 'location' | 'item'; name: string }[]
}

/** Describes one picture of a world's library with a model that reads images, and writes the answer into the picture's file. */
export async function describeWorldImage(deps: WorldDescribeDeps, path: string): Promise<GalleryImage> {
  if (deps.attachments === undefined) throw new Error('this DSH profile has no attachment service, so a picture cannot be shown to a model')
  if (deps.parent === undefined) throw new Error('the world\'s authoring chat is not running: open it with Author with AI once, then describe the picture again')
  const settings = DEFAULT_SETTINGS
  return await interpretImage({
    parent: deps.parent, signal: new AbortController().signal, attachments: deps.attachments, subjects: deps.subjects, sessionFolder: deps.directory, path, language: deps.language,
    model: settings.images.interpreterModel, captioner: settings.images.captioner, sampling: childSampling(settings, 'records'),
  })
}
