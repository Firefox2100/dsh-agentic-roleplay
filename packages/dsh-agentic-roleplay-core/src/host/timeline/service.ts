import { existsSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { sessionDatabase, sessionFolder, type RoleplayState } from '@dsh-agentic-roleplay/state'
import { SerialQueue } from '../serial.ts'
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

export const MAX_LABEL = 80
export const MAX_NOTE = 500

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
  private readonly queue = new SerialQueue()

  constructor(private readonly deps: TimelineDeps) {}

  private serial<T>(chat: string, job: () => Promise<T>): Promise<T> {
    return this.queue.run(chat, job)
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

  /** What the narration of the last `count` turns before the one being played told, oldest first, on the path the story has taken; never what an alternative or a withdrawn turn said. */
  narrationBefore(chat: string, count: number): string[] {
    const id = roleplaySessionOf(chat)
    if (id === undefined) return []
    const { path, head } = this.view(id)
    return path.filter(turn => turn.id !== head).slice(-count).flatMap(turn => (turn.output === undefined ? [] : [turn.output.segments.flatMap(segment => (segment.type === 'narration' ? [segment.text] : [])).join('\n')]))
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
   * @param beganSeq - where that turn's own `turn/start` sits, so the log is not searched for it.
   */
  ended(chat: string, session: { snapshotEvents(fromSeq?: SessionLogOffset): readonly { seq: number; type: string; data: unknown }[] }, seq: number, beganSeq?: SessionLogOffset): void {
    const id = this.idOf(chat)
    const timeline = this.read(id)
    const node = timeline.nodes.find(candidate => candidate.id === timeline.head)
    if (node === undefined || node.endSeq !== undefined) return
    const after = Math.max(-1, ...timeline.nodes.filter(other => other.id !== node.id).map(other => other.endSeq ?? other.userSeq))
    const human = session.snapshotEvents((after + 1) as SessionLogOffset).find(event => event.seq > after && event.type === 'user/message' && (event.data as { source: { kind: string } }).source.kind === 'user')
    if (human === undefined) throw new TimelineError(`turn ${node.turn} has no message of the player in the log`)
    node.userSeq = human.seq
    node.endSeq = seq
    const began = beganSeq ?? session.snapshotEvents(0 as SessionLogOffset).find(event => event.type === 'turn/start' && (event.data as { turn?: number }).turn === node.turn)?.seq
    node.startSeq = Math.min(began ?? human.seq, human.seq)
    writeTimeline(this.folder(id), timeline)
  }

  /** Keeps the state as it is under the name of the turn it follows from, when that is not done yet. */
  private keep(id: string, timeline: Timeline, at: string | null, force = false): void {
    if (!force && this.deps.keepSnapshots(id) === 0) return
    const node = at === null ? undefined : timeline.nodes.find(candidate => candidate.id === at)
    const name = node === undefined ? START_SNAPSHOT : snapshotOf(node.id)
    if (node !== undefined && node.snapshot !== undefined) return
    if (node === undefined && this.deps.state.snapshots(this.deps.sessionsDir(), id).includes(START_SNAPSHOT)) return
    this.deps.state.snapshot(this.deps.sessionsDir(), id, name)
    if (node !== undefined) { node.snapshot = name; writeTimeline(this.folder(id), timeline) }
  }

  /**
   * Names a turn as a checkpoint, with a note: its state is kept (taken now when the story stands there and has not kept it) and no longer pruned.
   * @throws {TimelineError} when there is no such turn, the name is empty or too long, or the turn's state is gone.
   */
  mark(chat: string, target: string, label: string, note?: string): Promise<void> {
    return this.serial(chat, async () => {
      const id = this.idOf(chat)
      const name = label.trim()
      if (name === '' || name.length > MAX_LABEL) throw new TimelineError(`a checkpoint's name is 1 to ${MAX_LABEL} characters`)
      if (note !== undefined && note.length > MAX_NOTE) throw new TimelineError(`a checkpoint's note is at most ${MAX_NOTE} characters`)
      const timeline = this.read(id)
      const node = timeline.nodes.find(candidate => candidate.id === target)
      if (node === undefined) throw new TimelineError(`there is no turn "${target}"`)
      if (node.snapshot === undefined && timeline.head === node.id) {
        await this.deps.engine.quiesce(chat)
        this.keep(id, timeline, node.id, true)
      }
      if (node.snapshot === undefined) throw new TimelineError('the state of the story at that turn was not kept, so it cannot be a checkpoint')
      node.label = name
      if (note === undefined || note.trim() === '') delete node.note
      else node.note = note.trim()
      writeTimeline(this.folder(id), timeline)
    })
  }

  /** Takes the name off a turn; its state is kept or let go like any other turn's. */
  unmark(chat: string, target: string): Promise<void> {
    return this.serial(chat, () => {
      const id = this.idOf(chat)
      const timeline = this.read(id)
      const node = timeline.nodes.find(candidate => candidate.id === target)
      if (node === undefined) throw new TimelineError(`there is no turn "${target}"`)
      delete node.label
      delete node.note
      writeTimeline(this.folder(id), timeline)
      this.prune(id, timeline)
      return Promise.resolve()
    })
  }

  /** Lets the oldest snapshots go: only the turns most recently played keep theirs, and the one that holds the start stays. */
  private prune(id: string, timeline: Timeline): void {
    const keep = this.deps.keepSnapshots(id)
    const kept = timeline.nodes.filter(node => node.snapshot !== undefined && node.label === undefined)
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
