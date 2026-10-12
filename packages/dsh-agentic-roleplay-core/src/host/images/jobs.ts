import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageGenerationService, RequestPriority } from 'dsh-ai-core'
import { sessionDatabase, sessionFolder, type RoleplayState } from 'dsh-roleplay-state'
import type { GalleryImage } from '../../shared/gallery.ts'
import type { SceneImageStatus } from '../../shared/images.ts'
import type { TurnOutput } from '../../shared/narration.ts'
import type { ChatSettings } from '../../shared/settings.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { chatSessionId, roleplaySessionOf } from '../../shared/chat.ts'
import { describeGalleryImage, listGallery, updateImage, type ImageUpdate } from './gallery.ts'
import type { Timelines } from '../timeline/service.ts'
import { childSampling } from '../agents/child.ts'
import { runImagePresenter } from './presenter-agent.ts'
import type { ImagePresenterJob, ImagePresenterResult } from './presenter-agent.ts'
import { interpretImage, type ImageAttachments } from './interpreter.ts'
import { addToLibrary } from './library.ts'
import type { Embedder } from '../memory/embedding-index.ts'
import { presentedFor } from './presented.ts'

/** The same service, whose requests stand where the job's do unless a call says otherwise. */
function withPriority(service: ImageGenerationService, priority: RequestPriority, highRes: boolean): ImageGenerationService {
  return Object.create(service, { generate: { value: (prompt: string, options?: Parameters<ImageGenerationService['generate']>[1]) => service.generate(prompt, { priority, ...highRes ? { highRes } : {}, ...options }) } }) as ImageGenerationService
}

interface ActiveJob {
  node: string
  controller: AbortController
  promise: Promise<void>
}

export interface ImageJobsDeps {
  state: Pick<RoleplayState, 'openSession'>
  sessionsDir: () => string
  timelines: Timelines
  service: () => ImageGenerationService | undefined
  agentOf: (chat: string) => Agent | undefined
  settings: (id: string) => ChatSettings
  problem: (message: string) => void
  presenter?: (job: ImagePresenterJob) => Promise<ImagePresenterResult>
  /** DSH's attachment service, which lets a model be shown a picture; none means pictures cannot be described. */
  attachments?: () => ImageAttachments | undefined
  /** The embedding service, when there is one: pictures are then found by meaning as well as words. */
  embedder?: () => Embedder | undefined
  /** Describes one picture of the library; replaced in tests. */
  interpret?: typeof interpretImage
}

export class ImageJobs {
  private readonly active = new Map<string, ActiveJob>()
  private readonly failures = new Map<string, string>()
  private readonly describing = new Map<string, Promise<void>>()
  private readonly interpretFailures = new Map<string, string>()

  constructor(private readonly deps: ImageJobsDeps) {}

  status(id: string, node: string): Promise<SceneImageStatus> {
    this.assertNode(id, node)
    return this.readStatus(id, node)
  }

  async generate(id: string, node: string): Promise<SceneImageStatus> {
    const timelineNode = this.assertNode(id, node)
    const settings = this.deps.settings(id)
    if (settings.images.mode === 'off') throw new Error('scene illustrations are disabled for this chat')
    this.start(id, node, timelineNode.turn, timelineNode.output!, settings, 'foreground', false)
    return await this.readStatus(id, node)
  }

  afterDelivery(chat: string, node: string, output: TurnOutput): void {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return
    const settings = this.deps.settings(id)
    if (settings.images.mode !== 'every-turn') return
    try { this.start(id, node, this.assertNode(id, node).turn, output, settings, 'background', true) } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.failures.set(this.key(id, node), message)
      this.deps.problem(`image for ${id}/${node} was not started: ${message}`)
    }
  }

  cancel(chat: string): void {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return
    this.active.get(id)?.controller.abort()
    this.active.delete(id)
  }

  /**
   * @param priority - `foreground` when the player asked for the picture, `background` when it is made on its own after a turn and may wait behind the next one.
   * @param automatic - the picture was not asked for: the library is looked at first, and the pictures the person brought are described before that.
   */
  private start(id: string, node: string, turn: number, output: TurnOutput, settings: ChatSettings, priority: RequestPriority, automatic: boolean): void {
    const current = this.active.get(id)
    if (current?.node === node) return
    current?.controller.abort()
    const service = this.deps.service()
    if (service === undefined) throw new Error('no image generation provider is selected')
    const parent = this.deps.agentOf(chatSessionId(id))
    if (parent === undefined) throw new Error('the roleplay agent is not loaded')
    const controller = new AbortController()
    this.failures.delete(this.key(id, node))
    const request = output.segments.map(segment => segment.type === 'utterance' ? `${segment.name}: “${segment.text}”` : segment.text).join('\n')
    const reuse = automatic && settings.images.reuse
    const present = (): Promise<ImagePresenterResult> => (this.deps.presenter ?? runImagePresenter)({
      parent, signal: controller.signal, service: withPriority(service, priority, settings.images.highRes), story: this.deps.state.openSession(this.deps.sessionsDir(), id),
      root: sessionFolder(this.deps.sessionsDir(), id), turn, timelineNode: node, request, purpose: 'transient', reuse,
      language: settings.prompts.language, sampling: childSampling(settings, 'records'), referenceMode: settings.images.references, ...(reuse && this.deps.attachments?.() !== undefined ? { attachments: this.deps.attachments() as ImageAttachments } : {}), ...(reuse && this.deps.embedder?.() !== undefined ? { embedder: this.deps.embedder() as Embedder } : {}), ...(settings.reasoning.children === '' ? {} : { reasoningEffort: settings.reasoning.children }),
    })
    const promise = (reuse && settings.images.interpret && this.deps.attachments?.() !== undefined ? this.describePending(id, controller.signal).then(present) : present()).then(() => undefined).catch((error: unknown) => {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      this.failures.set(this.key(id, node), message)
      this.deps.problem(`image for ${id}/${node} was not made: ${message}`)
    }).finally(() => {
      if (this.active.get(id)?.controller === controller) this.active.delete(id)
    })
    this.active.set(id, { node, controller, promise })
  }

  /** The images of a session and why any of the pictures brought could not be described. Describing what is waiting starts on its own. */
  async gallery(id: string): Promise<{ images: GalleryImage[]; failures: Record<string, string> }> {
    this.assertSession(id)
    const images = await listGallery(sessionFolder(this.deps.sessionsDir(), id))
    if (images.some(image => image.pending) && this.deps.settings(id).images.interpret) this.describeInBackground(id)
    return { images, failures: Object.fromEntries(this.interpretFailures) }
  }

  /** Puts a picture the person brought into the library and starts describing it. @returns its path. */
  async upload(id: string, name: string, bytes: Uint8Array): Promise<string> {
    this.assertSession(id)
    const path = await addToLibrary(sessionFolder(this.deps.sessionsDir(), id), bytes, name)
    if (this.deps.settings(id).images.interpret) this.describeInBackground(id)
    return path
  }

  /** Changes a picture's metadata through the session: see `updateImage`. */
  async update(id: string, path: string, update: ImageUpdate): Promise<GalleryImage> {
    this.assertSession(id)
    const image = await updateImage(sessionFolder(this.deps.sessionsDir(), id), path, update)
    this.interpretFailures.delete(path)
    return image
  }

  private describeInBackground(id: string): void {
    this.describePending(id, new AbortController().signal).catch((error: unknown) => { this.deps.problem(`pictures of ${id} were not described: ${error instanceof Error ? error.message : String(error)}`) })
  }

  /** Describes the pictures of the library that are waiting, one at a time, behind everything a person waits for. One run at a time per session; a picture that fails stays as it was. */
  describePending(id: string, signal: AbortSignal): Promise<void> {
    const running = this.describing.get(id)
    if (running !== undefined) return running
    const run = (async () => {
      const attachments = this.deps.attachments?.()
      const parent = this.deps.agentOf(chatSessionId(id))
      const settings = this.deps.settings(id)
      if (attachments === undefined || parent === undefined) return
      const folder = sessionFolder(this.deps.sessionsDir(), id)
      for (const image of (await listGallery(folder)).filter(entry => entry.pending)) {
        if (signal.aborted) return
        try {
          await (this.deps.interpret ?? interpretImage)({
            parent, signal, attachments, story: this.deps.state.openSession(this.deps.sessionsDir(), id), sessionFolder: folder, path: image.path, language: settings.prompts.language, model: settings.images.interpreterModel, captioner: settings.images.captioner,
            sampling: childSampling(settings, 'records'), ...(settings.reasoning.children === '' ? {} : { reasoningEffort: settings.reasoning.children }),
          })
          this.interpretFailures.delete(image.path)
        } catch (error) {
          if (signal.aborted) return
          const message = error instanceof Error ? error.message : String(error)
          this.interpretFailures.set(image.path, message)
          this.deps.problem(`${image.path} was not described: ${message}`)
        }
      }
    })().finally(() => { this.describing.delete(id) })
    this.describing.set(id, run)
    return run
  }

  private assertSession(id: string): void {
    if (!existsSync(sessionDatabase(this.deps.sessionsDir(), id))) throw new Error(`no session "${id}"`)
  }

  private assertNode(id: string, node: string) {
    if (!existsSync(sessionDatabase(this.deps.sessionsDir(), id))) throw new Error(`no session "${id}"`)
    const found = this.deps.timelines.read(id).nodes.find(candidate => candidate.id === node)
    if (found === undefined || found.output === undefined) throw new Error(`there is no delivered turn "${node}"`)
    return found
  }

  private async readStatus(id: string, node: string): Promise<SceneImageStatus> {
    const directory = join(sessionFolder(this.deps.sessionsDir(), id), 'images', 'scenes')
    let files: string[] = []
    try { files = await readdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const prefix = `turn-${node}-`
    const found = files.flatMap((file) => {
      const match = file.startsWith(prefix) ? /-(\d{2,3})\.png$/.exec(file) : null
      return match === null ? [] : [{ file, serial: Number(match[1]) }]
    }).sort((a, b) => a.serial - b.serial)
    const images: SceneImageStatus['images'] = await Promise.all(found.map(async ({ file, serial }) => ({
      serial,
      url: `/${API_PREFIX}/sessions/images/file?id=${encodeURIComponent(id)}&node=${encodeURIComponent(node)}&serial=${serial}`,
      details: await describeGalleryImage(sessionFolder(this.deps.sessionsDir(), id), `scenes/${file}`),
    })))
    const folder = sessionFolder(this.deps.sessionsDir(), id)
    for (const shown of await presentedFor(folder, node)) {
      const details = await describeGalleryImage(folder, shown.path).catch(() => undefined)
      images.push({ serial: images.length + 1, url: `/${API_PREFIX}/sessions/gallery/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(shown.path)}`, ...(details === undefined ? {} : { details }), existing: true })
    }
    const active = this.active.get(id)?.node === node
    const message = this.failures.get(this.key(id, node))
    return { node, mode: this.deps.settings(id).images.mode, state: active ? 'generating' : images.length > 0 ? 'ready' : message === undefined ? 'absent' : 'failed', images, ...(message === undefined || images.length > 0 ? {} : { message }) }
  }

  private key(id: string, node: string): string { return `${id}/${node}` }
}
