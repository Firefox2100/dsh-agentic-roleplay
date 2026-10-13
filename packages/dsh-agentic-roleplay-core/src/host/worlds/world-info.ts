import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import type { WorldInfo, WorldInfoEdit } from '../../shared/world-info.ts'
import { formatIssue } from '../validation.ts'
import { parseWorldFile, WORLD_FILE_NAME } from './world-file.ts'

type Json = Record<string, unknown>

async function replaceFile(file: string, text: string): Promise<void> {
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const { mode } = await stat(file)
    await writeFile(temporary, text, { mode })
    await chmod(temporary, mode)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

function infoOf(document: Json): WorldInfo {
  const opening = document['opening_message']
  const parts = Array.isArray(opening) && opening.some(part => typeof part === 'object' && part !== null && (part as Json)['type'] === 'utterance')
  const plain = typeof opening === 'string' ? opening : Array.isArray(opening) ? opening.map(part => textOf((part as Json | null)?.['text'])).filter(text => text !== '').join('\n\n') : ''
  const metadata = typeof document['metadata'] === 'object' && document['metadata'] !== null ? document['metadata'] as Json : {}
  const author = typeof document['author'] === 'object' && document['author'] !== null ? document['author'] as Json : {}
  const rules = document['rules']
  return {
    name: textOf(document['name']), description: textOf(document['description']),
    tags: Array.isArray(metadata['tags']) ? metadata['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
    rules: typeof rules === 'string' ? [rules] : Array.isArray(rules) ? rules.filter((rule): rule is string => typeof rule === 'string') : [],
    opening: plain, openingParts: parts, authorName: textOf(author['name']), authorUrl: textOf(author['url']),
    timeZone: textOf(document['time_zone']), startingTime: textOf(document['starting_time']), version: (typeof document['version'] === 'number' ? String(document['version']) : textOf(document['version'])),
    alternateOpenings: Array.isArray(document['alternate_openings']) ? document['alternate_openings'].flatMap((entry): { title: string; text: string }[] => (typeof entry === 'object' && entry !== null && typeof (entry as Json)['text'] === 'string' ? [{ title: textOf((entry as Json)['title']), text: (entry as Json)['text'] as string }] : [])) : [],
  }
}

async function readDocument(directory: string): Promise<{ text: string; document: Json }> {
  const text = await readFile(join(directory, WORLD_FILE_NAME), 'utf8')
  return { text, document: JSON.parse(text.replace(/^﻿/, '')) as Json }
}

export async function readWorldInfo(directory: string): Promise<WorldInfo> {
  return infoOf((await readDocument(directory)).document)
}

function setOrRemove(document: Json, key: string, value: string): void {
  if (value === '') delete document[key]
  else document[key] = value
}

/**
 * Changes the fields of `world.json` the edit names and nothing else, keeping the file's other fields and its indentation. The result is read
 * back as the world will be read before it is written.
 * @throws {InvalidEditProblems} when the world would no longer be valid.
 */
export async function editWorldInfo(directory: string, edit: WorldInfoEdit): Promise<WorldInfo> {
  const { text, document } = await readDocument(directory)
  const before = infoOf(document)
  if (edit.opening !== undefined && before.openingParts && edit.opening !== before.opening) throw new InvalidEditProblems(['the opening has lines spoken by characters: change it in the file, or ask the authoring assistant'])
  if (edit.name !== undefined) document['name'] = edit.name
  if (edit.description !== undefined) document['description'] = edit.description
  if (edit.tags !== undefined) document['metadata'] = { ...(typeof document['metadata'] === 'object' && document['metadata'] !== null ? document['metadata'] as Json : {}), tags: edit.tags }
  if (edit.rules !== undefined) { if (edit.rules.length === 0) delete document['rules']; else document['rules'] = edit.rules }
  if (edit.opening !== undefined && !before.openingParts) setOrRemove(document, 'opening_message', edit.opening)
  if (edit.authorName !== undefined || edit.authorUrl !== undefined) {
    const name = edit.authorName ?? before.authorName
    const url = edit.authorUrl ?? before.authorUrl
    if (name === '' && url !== '') throw new InvalidEditProblems(['an author link needs the author\'s name'])
    if (name === '') delete document['author']
    else document['author'] = { ...(typeof document['author'] === 'object' && document['author'] !== null ? document['author'] as Json : {}), name, ...(url === '' ? {} : { url }) }
    if (url === '' && typeof document['author'] === 'object') delete (document['author'] as Json)['url']
  }
  if (edit.timeZone !== undefined) setOrRemove(document, 'time_zone', edit.timeZone)
  if (edit.startingTime !== undefined) setOrRemove(document, 'starting_time', edit.startingTime)
  if (edit.version !== undefined) setOrRemove(document, 'version', edit.version)
  if (edit.alternateOpenings !== undefined) { if (edit.alternateOpenings.length === 0) delete document['alternate_openings']; else document['alternate_openings'] = edit.alternateOpenings.map(entry => ({ title: entry.title === '' ? entry.text.slice(0, 40) : entry.title, text: entry.text })) }
  const next = JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') ? '\n' : '')
  const parsed = parseWorldFile(next)
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  await replaceFile(join(directory, WORLD_FILE_NAME), next)
  return infoOf(document)
}
