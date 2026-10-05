import { join } from 'node:path'
import type { TriggerDefinition } from 'dsh-roleplay-model'
import { readTriggerDefinition } from 'dsh-roleplay-state'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { readDocument } from '../read-document.ts'
import type { Issue, ParseResult } from '../validation.ts'

export const TRIGGERS_FILE_NAME = 'triggers.json'

/** Read `triggers.json`: a list of what the world does by itself when something comes true (docs/world-format.md). */
export function parseTriggersFile(text: string): ParseResult<TriggerDefinition[]> {
  let data: unknown
  try { data = JSON.parse(text.replace(/^﻿/, '')) } catch (error) { return { ok: false, issues: [{ path: '', message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }] } }
  if (!Array.isArray(data)) return { ok: false, issues: [{ path: '', message: 'expected a list of triggers' }] }
  const issues: Issue[] = []
  const definitions: TriggerDefinition[] = []
  data.forEach((entry, index) => {
    const parsed = readTriggerDefinition(entry, `[${index}]`)
    if ('problems' in parsed) {
      for (const problem of parsed.problems) {
        const split = problem.indexOf(': ')
        issues.push({ path: split < 0 ? `[${index}]` : problem.slice(0, split), message: split < 0 ? problem : problem.slice(split + 2) })
      }
    } else {
      definitions.push(parsed.definition)
    }
  })
  const keys = definitions.map(definition => definition.key)
  keys.forEach((key, index) => { if (keys.indexOf(key) !== index) issues.push({ path: '', message: `the trigger "${key}" is defined twice` }) })
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: definitions }
}

export interface LoadedTriggers {
  triggers: TriggerDefinition[]
  problems: WorldProblem[]
}

/** Read the world's triggers: an optional `<world>/triggers.json`. A world with none only has what the story makes. */
export async function loadTriggers(worldDir: string): Promise<LoadedTriggers> {
  const result: LoadedTriggers = { triggers: [], problems: [] }
  const file = join(worldDir, TRIGGERS_FILE_NAME)
  try {
    result.triggers = (await readDocument(file, parseTriggersFile, result.problems)) ?? []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
  }
  return result
}
