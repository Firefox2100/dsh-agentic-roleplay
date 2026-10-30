import { randomUUID } from 'node:crypto'
import { chmodSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface AtomicWriteOptions {
  /** Make the folder first. */
  createDirectory?: boolean
  /** The permissions the file gets: those of the file it replaces by default, `0o644` for a new one. */
  mode?: number
}

/**
 * Replaces a file in one step: the data goes to a temporary file in the same folder and is renamed over the file, so an interruption leaves the old file or the new one,
 * never half of either. Every writer of a file someone else may read at the same time goes through here.
 */
export async function atomicWrite(file: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  if (options.createDirectory === true) await mkdir(dirname(file), { recursive: true })
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const mode = options.mode ?? await stat(file).then(value => value.mode & 0o777, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return 0o644; throw error })
    await writeFile(temporary, data, { mode })
    await chmod(temporary, mode)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** A JSON file written the same way, with the indentation given (none by default) and a final newline when it is indented. */
export async function atomicWriteJson(file: string, value: unknown, options: AtomicWriteOptions & { indent?: number } = {}): Promise<void> {
  const { indent, ...rest } = options
  await atomicWrite(file, indent === undefined ? JSON.stringify(value) : `${JSON.stringify(value, null, indent)}\n`, rest)
}

/** The synchronous form, for the few writers that cannot wait (the chat settings, read at every step). */
export function atomicWriteSync(file: string, data: string): void {
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    let mode = 0o644
    try { mode = statSync(file).mode & 0o777 } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    writeFileSync(temporary, data, { mode })
    chmodSync(temporary, mode)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
