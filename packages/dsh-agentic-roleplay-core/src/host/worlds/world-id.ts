import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** The indentation the file already uses, so adding the id does not reformat it. */
export function indentOf(text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
}

/**
 * The text of a world file with `id` as its first field. Other fields keep
 * their order and values; a blank or null `id` is replaced.
 */
export function withWorldId(text: string, id: string): string {
  const { id: _previous, ...rest } = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
  return JSON.stringify({ id, ...rest }, null, indentOf(text)) + (text.endsWith('\n') ? '\n' : '')
}

/**
 * Give a world file that has no id a new one, returning it. The file is
 * replaced in one step, so an interruption cannot leave it half written.
 */
export async function assignWorldId(file: string): Promise<string> {
  const id = randomUUID()
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`)
  try {
    const { mode } = await stat(file)
    await writeFile(temporary, withWorldId(await readFile(file, 'utf8'), id), { mode })
    await chmod(temporary, mode)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return id
}
