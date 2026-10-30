import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../atomic-write.ts'
import { WORLD_FILE_NAME } from './world-file.ts'

const queues = new Map<string, Promise<unknown>>()

/**
 * Runs `work` after everything asked for the same folder before it has finished. The import, the editor and the assistant each read `world.json`, change a field and write it
 * back; run side by side, the last one to write would take back what the others changed.
 */
export function serialized<T>(directory: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(directory) ?? Promise.resolve()).then(work, work)
  const tail = run.then(() => undefined, () => undefined)
  queues.set(directory, tail)
  void tail.then(() => { if (queues.get(directory) === tail) queues.delete(directory) })
  return run
}

type Json = Record<string, unknown>

/** Changes `world.json` in place: read, `update`, written back in one step with the indentation the file had, nothing else moving in between. @returns the document as written. */
export function updateWorldFile(directory: string, update: (document: Json) => void | Promise<void>): Promise<Json> {
  return serialized(directory, async () => {
    const file = join(directory, WORLD_FILE_NAME)
    const text = await readFile(file, 'utf8')
    const document = JSON.parse(text.replace(/^﻿/, '')) as Json
    await update(document)
    await atomicWrite(file, JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') || text.trim() === '' ? '\n' : ''))
    return document
  })
}
