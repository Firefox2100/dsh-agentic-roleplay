import { Service, type Context } from '@deepseek-ai/cordis'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import { WorldNotFoundError } from '../sessions/errors.ts'
import { CheckpointError, diffCheckpoint, lastRestore, listCheckpoints, makeCheckpoint, readCheckpointFile, restoreCheckpoint, type CheckpointDiff, type CheckpointInfo } from './checkpoints.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayCheckpoints: WorldCheckpoints
  }
}

/** A restore was asked for while the world's authoring assistant is working on it. */
export class CheckpointBusyError extends CheckpointError {}

/** The checkpoints of the worlds, by world id: made at the first edit of an authoring turn or on request, read back, compared and restored. */
export class WorldCheckpoints extends Service {
  private readonly taken = new Map<string, number>()
  private readonly told = new Map<string, string>()

  constructor(ctx: Context, private readonly kept: () => number, private readonly problem: (message: string) => void) {
    super(ctx, 'roleplayCheckpoints')
  }

  private async directory(worldId: string): Promise<string> {
    const record = await this.ctx.roleplayWorlds.find(worldId)
    if (record === undefined) throw new WorldNotFoundError(`there is no world with id "${worldId}"`)
    return record.directory
  }

  async list(worldId: string): Promise<CheckpointInfo[]> {
    return await listCheckpoints(await this.directory(worldId))
  }

  async make(worldId: string, label: string): Promise<CheckpointInfo> {
    return (await makeCheckpoint(await this.directory(worldId), { label: label.trim() === '' ? 'Checkpoint' : label.trim(), reason: 'manual', keep: this.kept() })).checkpoint
  }

  async diff(worldId: string, id: string): Promise<CheckpointDiff> {
    return await diffCheckpoint(await this.directory(worldId), id)
  }

  async read(worldId: string, id: string, path: string): Promise<Awaited<ReturnType<typeof readCheckpointFile>>> {
    return await readCheckpointFile(await this.directory(worldId), id, path)
  }

  /** Puts a world back as a checkpoint has it; refused while its authoring assistant is in the middle of a turn. */
  async restore(worldId: string, id: string, running: boolean): Promise<{ restored: CheckpointInfo; before?: CheckpointInfo }> {
    if (running) throw new CheckpointBusyError('the authoring assistant is working on this world: wait for it to finish, then restore')
    const outcome = await restoreCheckpoint(await this.directory(worldId), id, this.kept())
    await this.ctx.roleplayWorlds.list({ refresh: true })
    return outcome
  }

  /** The first edit of an authoring chat's turn: the world as it is, before the turn changes it. A checkpoint that cannot be made never stops the edit. */
  async beforeEdit(chat: string, turn: number, tool: string): Promise<void> {
    const worldId = authoredWorldOf(chat)
    if (worldId === undefined || this.taken.get(chat) === turn) return
    this.taken.set(chat, turn)
    try {
      await makeCheckpoint(await this.directory(worldId), { label: `Before the edits of turn ${turn} (${tool})`, reason: 'turn', chat, turn, keep: this.kept() })
    } catch (error) {
      this.problem(`could not make a checkpoint of world ${worldId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** What a chat has not been told yet about the person restoring its world. */
  async unannouncedRestore(chat: string): Promise<{ at: string; label: string } | undefined> {
    const worldId = authoredWorldOf(chat)
    if (worldId === undefined) return undefined
    const restored = await lastRestore(await this.directory(worldId))
    if (restored === undefined || this.told.get(chat) === restored.at) return undefined
    this.told.set(chat, restored.at)
    return restored
  }
}
