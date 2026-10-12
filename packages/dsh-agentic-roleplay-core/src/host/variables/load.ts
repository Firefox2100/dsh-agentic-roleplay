import { join } from 'node:path'
import { VARIABLE_KINDS, VARIABLE_SUBJECTS, VARIABLE_VISIBILITIES, type CharacterDefinition, type ItemDefinition, type LocationDefinition, type VariableDefinitionInput, type VariableKind, type VariableSubject, type VariableValue, type VariableVisibility } from 'dsh-roleplay-model'
import { createSessionStore, valueIssue } from '@dsh-agentic-roleplay/state'
import type { WorldProblem } from '../../shared/worlds.ts'
import { errorMessage } from '../errors.ts'
import { readDocument } from '../read-document.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const VARIABLES_FILE_NAME = 'variables.json'

function readDefinition(reader: Reader): VariableDefinitionInput | undefined {
  const key = reader.string('key', { required: true })
  const name = reader.string('name', { required: true })
  const kind = reader.oneOf('kind', VARIABLE_KINDS, 'number') as VariableKind
  const subject = reader.oneOf('subject', VARIABLE_SUBJECTS, 'character') as VariableSubject
  const visibility = reader.oneOf('visibility', VARIABLE_VISIBILITIES, 'public') as VariableVisibility
  const min = reader.number('min')
  const max = reader.number('max')
  const defaultValue = reader.raw('default')
  if (defaultValue !== undefined && typeof defaultValue !== 'number' && typeof defaultValue !== 'boolean' && typeof defaultValue !== 'string') reader.fail('default', 'must be a number, true or false, or text')
  const flag = (field: string): boolean | undefined => {
    const value = reader.raw(field)
    if (value !== undefined && typeof value !== 'boolean') reader.fail(field, 'must be true or false')
    return typeof value === 'boolean' ? value : undefined
  }
  const integer = flag('integer')
  const baseline = flag('baseline')
  const always = flag('always')
  const bands = reader.objects('bands').flatMap((band) => {
    const upTo = band.number('up_to', { })
    const label = band.string('label', { required: true })
    return upTo === undefined || label === undefined ? [] : [{ upTo, label }]
  })
  if (key === undefined || name === undefined) return undefined
  const only = reader.strings('only')
  const options = reader.strings('options')
  return {
    key, name, kind, subject, visibility, ...(reader.raw('description') === undefined ? {} : { description: reader.text('description') }), only, options, bands,
    ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }),
    ...(integer === undefined ? {} : { integer }), ...(baseline === undefined ? {} : { baseline }), ...(always === undefined ? {} : { always }),
    ...(defaultValue === undefined || (typeof defaultValue === 'number' && !Number.isFinite(defaultValue)) ? {} : { default: defaultValue as VariableValue }),
  }
}

/** Read `variables.json`: a list of what the world tracks. */
export function parseVariablesFile(text: string): ParseResult<VariableDefinitionInput[]> {
  const issues: Issue[] = []
  let data: unknown
  try { data = JSON.parse(text.replace(/^﻿/, '')) } catch (error) { return { ok: false, issues: [{ path: '', message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }] } }
  if (!Array.isArray(data)) return { ok: false, issues: [{ path: '', message: 'expected a list of variables' }] }
  const reader = Reader.fromJson(JSON.stringify({ variables: data }), issues)
  if (reader === undefined) return { ok: false, issues }
  const defs = reader.objects('variables').flatMap(entry => readDefinition(entry) ?? [])
  return issues.length > 0 ? { ok: false, issues: issues.map(issue => ({ ...issue, path: issue.path.replace(/^variables/, '') })) } : { ok: true, value: defs }
}

export interface LoadedVariables {
  defs: VariableDefinitionInput[]
  problems: WorldProblem[]
}

/** Read the world's own variables: an optional `<world>/variables.json`. A world with none tracks only what every story does. */
export async function loadVariables(worldDir: string): Promise<LoadedVariables> {
  const result: LoadedVariables = { defs: [], problems: [] }
  const file = join(worldDir, VARIABLES_FILE_NAME)
  try {
    result.defs = (await readDocument(file, parseVariablesFile, result.problems)) ?? []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.problems.push({ path: file, message: errorMessage(error) })
  }
  return result
}

/**
 * What is wrong with the variables of a world and the values it starts with, found before anything is created: a
 * declaration that cannot be one, a repeated key, a subject a variable is limited to that does not exist, a value for a
 * variable that is not declared, does not apply to what has it, or is not one it can have.
 */
export function variableProblems(world: {
  defs: readonly VariableDefinitionInput[]
  characters: readonly CharacterDefinition[]
  items: readonly ItemDefinition[]
  locations: readonly LocationDefinition[]
  values: Record<string, VariableValue> | undefined
}): string[] {
  const problems: string[] = []
  const scratch = createSessionStore(':memory:', { id: 'scratch', name: 'scratch', world: { id: 'scratch', name: 'scratch' } }, { vectors: false })
  try {
    const seen = new Set<string>()
    world.defs.forEach((def, index) => {
      if (seen.has(def.key)) problems.push(`variables.json[${index}]: "${def.key}" is declared twice`)
      seen.add(def.key)
      try { scratch.variables.define(def) } catch (error) { problems.push(`variables.json[${index}]: ${errorMessage(error)}`) }
    })
    const keys: Record<Exclude<VariableSubject, 'world'>, Set<string>> = { character: new Set(world.characters.map(entry => entry.id)), item: new Set(world.items.map(entry => entry.id)), location: new Set(world.locations.map(entry => entry.id)) }
    for (const def of scratch.variables.defs()) for (const key of def.only) if (def.subject !== 'world' && !keys[def.subject].has(key)) problems.push(`variables.json: ${def.key}: "${key}" is not a ${def.subject} of this world`)
    const check = (kind: VariableSubject, who: string, values: Record<string, VariableValue> | undefined): void => {
      for (const [key, value] of Object.entries(values ?? {})) {
        const def = scratch.variables.def(key)
        if (def === undefined) { problems.push(`${who}: variables.${key}: no such variable is declared (variables.json)`); continue }
        if (def.subject !== kind) { problems.push(`${who}: variables.${key}: ${def.name} is about ${def.subject === 'world' ? 'the world' : `a ${def.subject}`}, not ${kind === 'world' ? 'the world' : `a ${kind}`}`); continue }
        if (kind !== 'world' && def.only.length > 0 && !def.only.includes(who.split(': ')[0]!)) problems.push(`${who}: variables.${key}: ${def.name} does not apply to it`)
        const issue = valueIssue(def, value)
        if (issue !== undefined) problems.push(`${who}: variables.${key}: ${issue}`)
      }
    }
    for (const entry of world.characters) check('character', `${entry.id}: character`, entry.variables)
    for (const entry of world.items) check('item', `${entry.id}: item`, entry.variables)
    for (const entry of world.locations) check('location', `${entry.id}: place`, entry.variables)
    check('world', 'world.json', world.values)
  } finally {
    scratch.close()
  }
  return problems
}
