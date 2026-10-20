import { existsSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { sessionDatabase, sessionFolder, type RoleplayState } from '@dsh-agentic-roleplay/state'
import { roleplaySessionOf } from '../../shared/chat.ts'
import type { TurnOutput } from '../../shared/narration.ts'
import { START_SNAPSHOT, childrenOf, noticeText, pathTo, snapshotOf, viewOf, type Timeline, type TimelineNode, type TimelineView } from '../../shared/timeline.ts'
import { readTimeline, writeTimeline } from './file.ts'
import { branchName, branchTimeline } from './branch.ts'
import { planMove, type MovePlan } from './plan.ts'
import { inheritImages } from '../images/storage.ts'
import { inheritPrompts } from '../prompts/library.ts'
import { inheritPreset } from '../presets/apply.ts'
import { inheritPacks } from '../interface/packs.ts'

/** The text of the marker that stands for the turns it replaces: never empty, as a model service may refuse an empty message. */
const MARKER_TEXT = '(empty message)'

/** A turn that has not ended does not know yet where its own message is in the log. */
const UNKNOWN_SEQ = -1

export class TimelineError extends Error {}

export interface TimelineDeps {
  state: Pick<RoleplayState, 'snapshot' | 'snapshots' | 'removeSnapshot' | 'restore' | 'fork' | 'openSession' | 'deleteSession'>
  sessionsDir: () => string
  /** What is in flight for a chat is stopped, and waited for, before the story is taken back. */
  engine: { stop(chat: string): void; quiesce(chat: string): Promise<void>; forget(chat: string): void }
  /** Cancels work whose result belongs to the current timeline head, such as a scene image. */
  cancel?: (chat: string) => void
  /** The agent of a chat, loaded when it is not. */
  agentOf: (chat: string) => Promise<Agent | undefined>
  /** How many turns keep a snapshot; 0 keeps none. */
  keepSnapshots: (id: string) => number
}

/**
 * What the story's turns are, and taking the story back to one of them (or forward again). The conversation with the model is
 * only ever added to: the turns that no longer belong are replaced by a marker, which DSH keeps out of the next request, and
 * a turn that comes back is told once as a notice. The state of the story is put back from the snapshot taken when the turn settled.
 * Everything here is one at a time per chat.
 */
export class Timelines {
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: TimelineDeps) {}

  private serial<T>(chat: string, job: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(chat) ?? Promise.resolve()).then(job, job)
    this.queues.set(chat, run.catch(() => undefined))
    return run
  }

  private idOf(chat: string): string {
    const id = roleplaySessionOf(chat)
    if (id === undefined) throw new TimelineError(`${chat} is not a roleplay chat`)
    return id
  }

  private folder(id: string): string {
    return sessionFolder(this.deps.sessionsDir(), id)
  }

  read(id: string): Timeline {
    return readTimeline(this.folder(id))
  }

  view(id: string): TimelineView {
    return viewOf(this.read(id))
  }

  /**
   * The player has said something and a turn begins: the turn is added to the timeline after the head, and the state the earlier one left is kept at once,
   * with the records still waiting for the keeper in it (they are in the database, so a restored state carries them).
   */
  begin(chat: string, turn: number, player: string): Promise<TimelineNode> {
    return this.serial(chat, async () => {
      this.deps.cancel?.(chat)
      const id = this.idOf(chat)
      const timeline = this.read(id)
      this.keep(id, timeline, timeline.head)
      const node: TimelineNode = { id: `n${timeline.next}`, parent: timeline.head, turn, userSeq: UNKNOWN_SEQ, player, createdAt: new Date().toISOString() }
      timeline.nodes.push(node)
      timeline.next += 1
      timeline.head = node.id
      writeTimeline(this.folder(id), timeline)
      this.prune(id, timeline)
      return node
    })
  }

  /** What the turn delivered; and, once nothing writes to the story any more, its state is kept. */
  delivered(chat: string, output: TurnOutput): string | undefined {
    const id = this.idOf(chat)
    const timeline = this.read(id)
    const node = timeline.nodes.find(candidate => candidate.id === timeline.head)
    if (node === undefined) return undefined
    node.output = output
    writeTimeline(this.folder(id), timeline)
    void this.deps.engine.quiesce(chat)
      .then(() => this.serial(chat, () => {
        const current = this.read(id)
        if (current.head === node.id) this.keep(id, current, node.id)
        return Promise.resolve()
      }))
      .catch(() => undefined)
    return node.id
  }

  /**
   * The turn ended in the log. Its own message is found now: it is the first message of the player after the last turn that ended
   * (it is not in the log yet when the turn begins).
   */
  ended(chat: string, session: { snapshotEvents(): readonly { seq: number; type: string; data: unknown }[] }, seq: number): void {
    const id = this.idOf(chat)
    const timeline = this.read(id)
    const node = timeline.nodes.find(candidate => candidate.id === timeline.head)
    if (node === undefined || node.endSeq !== undefined) return
    const after = Math.max(-1, ...timeline.nodes.filter(other => other.id !== node.id).map(other => other.endSeq ?? other.userSeq))
    const human = session.snapshotEvents().find(event => event.seq > after && event.type === 'user/message' && (event.data as { source: { kind: string } }).source.kind === 'user')
    if (human === undefined) throw new TimelineError(`turn ${node.turn} has no message of the player in the log`)
    node.userSeq = human.seq
    node.endSeq = seq
    const began = session.snapshotEvents().find(event => event.type === 'turn/start' && (event.data as { turn?: number }).turn === node.turn)
    node.startSeq = Math.min(began?.seq ?? human.seq, human.seq)
    writeTimeline(this.folder(id), timeline)
  }

  /** Keeps the state as it is under the name of the turn it follows from, when that is not done yet. */
  private keep(id: string, timeline: Timeline, at: string | null): void {
    if (this.deps.keepSnapshots(id) === 0) return
    const node = at === null ? undefined : timeline.nodes.find(candidate => candidate.id === at)
    const name = node === undefined ? START_SNAPSHOT : snapshotOf(node.id)
    if (node !== undefined && node.snapshot !== undefined) return
    if (node === undefined && this.deps.state.snapshots(this.deps.sessionsDir(), id).includes(START_SNAPSHOT)) return
    this.deps.state.snapshot(this.deps.sessionsDir(), id, name)
    if (node !== undefined) { node.snapshot = name; writeTimeline(this.folder(id), timeline) }
  }

  /** Lets the oldest snapshots go: only the turns most recently played keep theirs, and the one that holds the start stays. */
  private prune(id: string, timeline: Timeline): void {
    const keep = this.deps.keepSnapshots(id)
    const kept = timeline.nodes.filter(node => node.snapshot !== undefined)
    const dropped = kept.slice(0, Math.max(0, kept.length - keep))
    if (dropped.length === 0) return
    for (const node of dropped) { this.deps.state.removeSnapshot(this.deps.sessionsDir(), id, node.snapshot!); delete node.snapshot }
    writeTimeline(this.folder(id), timeline)
  }

  /**
   * Takes the story to the state after a turn (`null` for the start): what is in flight stops, the state is put back from the snapshot,
   * the turns that no longer belong are replaced by a marker on the model's conversation, and the turns that come back are told as notices.
   * @returns what the player said in the first turn that was left, to put back in the input; nothing when the story went forward.
   * @throws {TimelineError} when there is no such turn, its state was not kept, or the chat is not loaded.
   */
  move(chat: string, target: string | null): Promise<{ draft?: string }> {
    return this.serial(chat, async () => {
      const id = this.idOf(chat)
      const timeline = this.read(id)
      const to = target === null ? undefined : timeline.nodes.find(node => node.id === target)
      if (target !== null && to === undefined) throw new TimelineError(`there is no turn "${target}"`)
      const snapshot = target === null ? START_SNAPSHOT : to!.snapshot
      if (snapshot === undefined || !this.deps.state.snapshots(this.deps.sessionsDir(), id).includes(snapshot)) throw new TimelineError('the state of the story at that turn was not kept')
      const agent = await this.deps.agentOf(chat)
      if (agent === undefined) throw new TimelineError(`the chat ${chat} is not loaded`)
      if (agent.status !== 'idle') {
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        await agent.whenIdle()
      }
      this.deps.cancel?.(chat)
      this.deps.engine.stop(chat)
      await this.deps.engine.quiesce(chat)
      this.deps.engine.forget(chat)

      const was = pathTo(timeline, timeline.head)
      const plan = planMove(timeline, target, [...agent.session.surface.nodes] as number[])
      this.deps.state.restore(this.deps.sessionsDir(), id, snapshot)
      this.reconcile(agent, plan)
      timeline.head = target
      writeTimeline(this.folder(id), timeline)
      const left = was.find(node => !pathTo(timeline, target).some(kept => kept.id === node.id))
      return left === undefined ? {} : { draft: left.player }
    })
  }

  /** Makes the model's conversation carry the turns of a plan and no others: what does not belong is replaced by a marker, and the turns that come back are told as notices. */
  private reconcile(agent: Agent, plan: MovePlan): void {
    for (const run of plan.shadow) {
      agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: MARKER_TEXT }], source: { kind: 'roleplay' } }), {
        surfaceOp: { op: 'replace', startSeq: run.startSeq as never, endSeq: run.endSeq as never }, sourceEventSeqs: run.seqs as never,
      })
    }
    for (const node of plan.inject) {
      const event = agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: noticeText(node) }], source: { kind: 'roleplay' } }), { surfaceOp: 'append' })
      node.noticeSeq = event.seq as number
    }
  }

  /**
   * A chat DSH made as a branch of a roleplay chat gets a session of its own: the state of the story where the branch was cut (its snapshot, or
   * the live state when the story stands there and has not kept one yet), the turns it inherits, the settings, and a name. The branch's own chat is
   * made to carry the turns it inherits and no others. A chat that already has its session (it is only loaded again) is left as it is.
   * @param cut - the seq of the last event of the log the branch inherits.
   * @returns whether a session was made.
   * @throws {BranchError} when the state at the cut was not kept; the branch is then not made.
   */
  adopt(chat: string, parent: string, cut: number, agent: Agent): Promise<boolean> {
    return this.serial(parent, async () => {
      const id = this.idOf(chat)
      const from = this.idOf(parent)
      const directory = this.deps.sessionsDir()
      if (existsSync(sessionDatabase(directory, id)) || !existsSync(sessionDatabase(directory, from))) return false
      const branch = branchTimeline(this.read(from), cut, this.deps.state.snapshots(directory, from))
      if ('live' in branch.from) await this.deps.engine.quiesce(parent)
      const name = branchName(this.deps.state.openSession(directory, from).metadata.get().name)
      this.deps.state.fork(directory, from, id, branch.from, { name, keep: branch.keep })
      try {
        await inheritImages(this.folder(from), this.folder(id), branch.timeline.nodes.map(node => node.id))
        inheritPrompts(this.folder(from), this.folder(id))
        inheritPreset(this.folder(from), this.folder(id))
        inheritPacks(this.folder(from), this.folder(id))
        const plan = planMove(branch.timeline, branch.timeline.head, [...agent.session.surface.nodes] as number[])
        this.reconcile(agent, plan)
        writeTimeline(this.folder(id), branch.timeline)
      } catch (error) {
        this.deps.state.deleteSession(directory, id)
        throw error
      }
      return true
    })
  }

  /** The turns that follow a turn, for the choices the story can be taken to. */
  forward(id: string): TimelineNode[] {
    const timeline = this.read(id)
    return childrenOf(timeline, timeline.head)
  }
}
