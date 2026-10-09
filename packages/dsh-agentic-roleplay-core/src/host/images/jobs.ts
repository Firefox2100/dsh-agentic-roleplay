import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageGenerationService } from 'dsh-ai-core'
import { sessionDatabase, sessionFolder, type RoleplayState } from 'dsh-roleplay-state'
import type { SceneImageStatus } from '../../shared/images.ts'
import type { TurnOutput } from '../../shared/narration.ts'
import type { ChatSettings } from '../../shared/settings.ts'
import { API_PREFIX } from '../../shared/worlds.ts'
import { chatSessionId, roleplaySessionOf } from '../../shared/chat.ts'
import type { Timelines } from '../timeline/service.ts'
import { childSampling } from '../agents/child.ts'
import { runImageAuthor } from './author-agent.ts'
import type { ImageAuthorJob, ImageAuthorResult } from './author-agent.ts'

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
  author?: (job: ImageAuthorJob) => Promise<ImageAuthorResult>
}

export class ImageJobs {
  private readonly active = new Map<string, ActiveJob>()
  private readonly failures = new Map<string, string>()

  constructor(private readonly deps: ImageJobsDeps) {}

  status(id: string, node: string): Promise<SceneImageStatus> {
    this.assertNode(id, node)
    return this.readStatus(id, node)
  }

  async generate(id: string, node: string): Promise<SceneImageStatus> {
    const timelineNode = this.assertNode(id, node)
    const settings = this.deps.settings(id)
    if (settings.images.mode === 'off') throw new Error('scene illustrations are disabled for this chat')
    this.start(id, node, timelineNode.turn, timelineNode.output!, settings)
    return await this.readStatus(id, node)
  }

  afterDelivery(chat: string, node: string, output: TurnOutput): void {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return
    const settings = this.deps.settings(id)
    if (settings.images.mode !== 'every-turn') return
    try { this.start(id, node, this.assertNode(id, node).turn, output, settings) } catch (error) {
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

  private start(id: string, node: string, turn: number, output: TurnOutput, settings: ChatSettings): void {
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
    const promise = (this.deps.author ?? runImageAuthor)({
      parent, signal: controller.signal, service, story: this.deps.state.openSession(this.deps.sessionsDir(), id),
      root: sessionFolder(this.deps.sessionsDir(), id), turn, timelineNode: node, request, purpose: 'transient',
      language: settings.prompts.language, sampling: childSampling(settings, 'records'), referenceMode: settings.images.references, ...(settings.reasoning.children === '' ? {} : { reasoningEffort: settings.reasoning.children }),
    }).then(() => undefined).catch((error: unknown) => {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      this.failures.set(this.key(id, node), message)
      this.deps.problem(`image for ${id}/${node} was not made: ${message}`)
    }).finally(() => {
      if (this.active.get(id)?.controller === controller) this.active.delete(id)
    })
    this.active.set(id, { node, controller, promise })
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
    const images = files.flatMap((file) => {
      const match = file.startsWith(prefix) ? /-(\d{2,3})\.png$/.exec(file) : null
      if (match === null) return []
      const serial = Number(match[1])
      return [{ serial, url: `/${API_PREFIX}/sessions/images/file?id=${encodeURIComponent(id)}&node=${encodeURIComponent(node)}&serial=${serial}` }]
    }).sort((a, b) => a.serial - b.serial)
    const active = this.active.get(id)?.node === node
    const message = this.failures.get(this.key(id, node))
    return { node, mode: this.deps.settings(id).images.mode, state: active ? 'generating' : images.length > 0 ? 'ready' : message === undefined ? 'absent' : 'failed', images, ...(message === undefined || images.length > 0 ? {} : { message }) }
  }

  private key(id: string, node: string): string { return `${id}/${node}` }
}
