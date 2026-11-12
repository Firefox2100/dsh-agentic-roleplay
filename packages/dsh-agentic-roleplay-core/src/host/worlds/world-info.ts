import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InvalidEditProblems } from '../../shared/world-state.ts'
import type { AlternateOpeningText, WorldInfo, WorldInfoEdit } from '../../shared/world-info.ts'
import { parseOpeningParts, partsText, type OpeningPart } from '../../shared/opening.ts'
import { parseSwitchboard } from '../../shared/settings.ts'
import { parseSampling } from '../../shared/sampling.ts'
import { startQuestionsToFile } from '../../shared/start-questions.ts'
import { formatIssue } from '../validation.ts'
import { parseWorldFile, WORLD_FILE_NAME } from './world-file.ts'
import { atomicWrite } from '../atomic-write.ts'
import { serialized } from './world-file-io.ts'

type Json = Record<string, unknown>


const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

const toolsOf = (value: unknown): WorldInfo['tools'] => { const board = value === undefined ? {} : parseSwitchboard(value, 'tools'); return typeof board === 'string' ? {} : board }

/** The parts of an opening as the file has them; parts that cannot be read are left out. */
function partsOf(list: unknown[]): OpeningPart[] | undefined {
  const problems: string[] = []
  const parts = parseOpeningParts(list, 'opening', problems)
  return parts === undefined || parts.length === 0 ? undefined : parts
}

function alternateOf(entry: unknown): AlternateOpeningText[] {
  if (typeof entry !== 'object' || entry === null) return []
  const body = entry as Json
  const character = textOf(body['character'])
  const named = character === '' ? {} : { character }
  const parts = Array.isArray(body['parts']) ? partsOf(body['parts']) : undefined
  if (parts !== undefined) return [{ title: textOf(body['title']), text: partsText(parts), parts, ...named }]
  return typeof body['text'] === 'string' ? [{ title: textOf(body['title']), text: body['text'], ...named }] : []
}

function infoOf(document: Json, startQuestions: WorldInfo['startQuestions'] = []): WorldInfo {
  const opening = document['opening_message']
  const parts = Array.isArray(opening) ? partsOf(opening) : undefined
  const plain = typeof opening === 'string' ? opening : parts === undefined ? '' : partsText(parts)
  const metadata = typeof document['metadata'] === 'object' && document['metadata'] !== null ? document['metadata'] as Json : {}
  const author = typeof document['author'] === 'object' && document['author'] !== null ? document['author'] as Json : {}
  const rules = document['rules']
  return {
    name: textOf(document['name']), description: textOf(document['description']),
    tags: Array.isArray(metadata['tags']) ? metadata['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
    rules: typeof rules === 'string' ? [rules] : Array.isArray(rules) ? rules.filter((rule): rule is string => typeof rule === 'string') : [],
    opening: plain, ...(parts === undefined ? {} : { openingParts: parts }), authorName: textOf(author['name']), authorUrl: textOf(author['url']),
    timeZone: textOf(document['time_zone']), startingTime: textOf(document['starting_time']), language: textOf(document['language']), preset: textOf(document['preset']), lorebooks: Array.isArray(document['lorebooks']) ? document['lorebooks'].filter((name): name is string => typeof name === 'string') : [], version: (typeof document['version'] === 'number' ? String(document['version']) : textOf(document['version'])),
    sampling: parseSampling(document['sampling'], 'sampling', []),
    tools: toolsOf(document['tools']), autonomy: document['autonomy'] === true, startQuestions,
    alternateOpenings: Array.isArray(document['alternate_openings']) ? document['alternate_openings'].flatMap(alternateOf) : [],
  }
}

async function readDocument(directory: string): Promise<{ text: string; document: Json }> {
  const text = await readFile(join(directory, WORLD_FILE_NAME), 'utf8')
  return { text, document: JSON.parse(text.replace(/^﻿/, '')) as Json }
}

/** The questions the file asks, as its own reader understands them; none when the file does not parse (its problems are reported elsewhere). */
function questionsOf(text: string): WorldInfo['startQuestions'] {
  const parsed = parseWorldFile(text)
  return parsed.ok ? parsed.value.startQuestions ?? [] : []
}

export async function readWorldInfo(directory: string): Promise<WorldInfo> {
  const { text, document } = await readDocument(directory)
  return infoOf(document, questionsOf(text))
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
export function editWorldInfo(directory: string, edit: WorldInfoEdit): Promise<WorldInfo> {
  return serialized(directory, () => changeWorldInfo(directory, edit))
}

async function changeWorldInfo(directory: string, edit: WorldInfoEdit): Promise<WorldInfo> {
  const { text, document } = await readDocument(directory)
  const before = infoOf(document)
  if (edit.startQuestions !== undefined) { if (edit.startQuestions.length === 0) delete document['start_questions']; else document['start_questions'] = startQuestionsToFile(edit.startQuestions) }
  if (edit.name !== undefined) document['name'] = edit.name
  if (edit.description !== undefined) document['description'] = edit.description
  if (edit.tags !== undefined) document['metadata'] = { ...(typeof document['metadata'] === 'object' && document['metadata'] !== null ? document['metadata'] as Json : {}), tags: edit.tags }
  if (edit.rules !== undefined) { if (edit.rules.length === 0) delete document['rules']; else document['rules'] = edit.rules }
  if (edit.opening !== undefined) setOrRemove(document, 'opening_message', edit.opening)
  if (edit.openingParts !== undefined) { if (edit.openingParts.length === 0) delete document['opening_message']; else document['opening_message'] = edit.openingParts }
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
  if (edit.language !== undefined) setOrRemove(document, 'language', edit.language)
  if (edit.preset !== undefined) setOrRemove(document, 'preset', edit.preset)
  if (edit.lorebooks !== undefined) { if (edit.lorebooks.length === 0) delete document['lorebooks']; else document['lorebooks'] = edit.lorebooks }
  if (edit.alternateOpenings !== undefined) { if (edit.alternateOpenings.length === 0) delete document['alternate_openings']; else document['alternate_openings'] = edit.alternateOpenings.map(entry => ({ title: entry.title === '' ? entry.text.slice(0, 40) : entry.title, ...(entry.parts === undefined ? { text: entry.text } : { parts: entry.parts }), ...(entry.character === undefined || entry.character === '' ? {} : { character: entry.character }) })) }
  if (edit.sampling !== undefined) { if (Object.keys(edit.sampling).length === 0) delete document['sampling']; else document['sampling'] = edit.sampling }
  if (edit.autonomy !== undefined) { if (edit.autonomy) document['autonomy'] = true; else delete document['autonomy'] }
  if (edit.tools !== undefined) { if (Object.keys(edit.tools).length === 0) delete document['tools']; else document['tools'] = edit.tools }
  const next = JSON.stringify(document, null, /^([ \t]+)"/m.exec(text)?.[1] ?? '  ') + (text.endsWith('\n') ? '\n' : '')
  const parsed = parseWorldFile(next)
  if (!parsed.ok) throw new InvalidEditProblems(parsed.issues.map(formatIssue))
  await atomicWrite(join(directory, WORLD_FILE_NAME), next)
  return infoOf(document, questionsOf(next))
}
