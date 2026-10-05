import { EMOTION_VARIABLES, MAX_VARIABLES, VARIABLE_KEY, VARIABLE_KINDS, VARIABLE_SUBJECTS, VARIABLE_VISIBILITIES, type StoredVariable, type VariableBand, type VariableDefinition, type VariableDefinitionInput, type VariableSubject, type VariableValue } from 'dsh-roleplay-model'
import type { SqlDatabase } from '../driver/types.ts'
import { ConflictError, CorruptDataError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { VariableRepository } from '../repositories.ts'
import { guard, parseStringList, toJson } from './support.ts'

interface DefRow {
  key: string
  ordinal: number
  name: string
  description: string
  kind: VariableDefinition['kind']
  subject: VariableSubject
  only_keys: string
  min_value: number | null
  max_value: number | null
  is_integer: number
  options: string
  default_value: string
  has_baseline: number
  visibility: VariableDefinition['visibility']
  bands: string
  always_shown: number
  builtin: number
}

interface ValueRow {
  variable: string
  subject: VariableSubject
  subject_id: number
  value: string
  baseline: string | null
  updated_turn: number
}

const MAX_BANDS = 8
const MAX_OPTIONS = 12
const MAX_ONLY = 50

function parseValue(text: string, column: string): VariableValue {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
  } catch {
    // reported below
  }
  throw new CorruptDataError(`${column} does not hold a number, a yes or no, or text`)
}

function parseBands(text: string): VariableBand[] {
  try {
    const value: unknown = JSON.parse(text)
    if (Array.isArray(value) && value.every(band => typeof band === 'object' && band !== null && typeof (band as VariableBand).upTo === 'number' && typeof (band as VariableBand).label === 'string')) return value as VariableBand[]
  } catch {
    // reported below
  }
  throw new CorruptDataError('variable_defs.bands does not hold a list of bands')
}

const toDef = (row: DefRow): VariableDefinition => ({
  key: row.key, name: row.name, description: row.description, kind: row.kind, subject: row.subject, only: parseStringList(row.only_keys, 'variable_defs.only_keys'),
  ...(row.min_value === null ? {} : { min: row.min_value }), ...(row.max_value === null ? {} : { max: row.max_value }),
  integer: row.is_integer === 1, options: parseStringList(row.options, 'variable_defs.options'), default: parseValue(row.default_value, 'variable_defs.default_value'),
  baseline: row.has_baseline === 1, visibility: row.visibility, bands: parseBands(row.bands), always: row.always_shown === 1, builtin: row.builtin === 1,
})

const toStored = (row: ValueRow): StoredVariable => ({
  variable: row.variable, subject: row.subject, subjectId: row.subject_id, value: parseValue(row.value, 'variable_values.value'),
  ...(row.baseline === null ? {} : { baseline: parseValue(row.baseline, 'variable_values.baseline') }), updatedTurn: row.updated_turn,
})

/** Why a value is not one the variable can have, or nothing when it is. */
export function valueIssue(def: Pick<VariableDefinition, 'key' | 'kind' | 'min' | 'max' | 'integer' | 'options'>, value: unknown): string | undefined {
  if (def.kind === 'flag') return typeof value === 'boolean' ? undefined : `${def.key} is a yes or no`
  if (def.kind === 'choice') return typeof value === 'string' && def.options.includes(value) ? undefined : `${def.key} is one of: ${def.options.join(', ')}`
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${def.key} is a number`
  if (def.integer && !Number.isInteger(value)) return `${def.key} is a whole number`
  if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) return `${def.key} is a number ${def.min === undefined ? '' : `from ${def.min} `}${def.max === undefined ? '' : `up to ${def.max}`}`.trim()
  return undefined
}

const SUBJECT_TABLES: Record<Exclude<VariableSubject, 'world'>, string> = { character: 'characters', item: 'items', location: 'locations' }

export class SqliteVariableRepository implements VariableRepository {
  constructor(private readonly db: SqlDatabase) {}

  ensureDefaults(): void {
    for (const def of EMOTION_VARIABLES) if (this.def(def.key) === undefined) this.write(def)
  }

  defs(): VariableDefinition[] {
    return this.db.all<DefRow>('SELECT * FROM variable_defs ORDER BY ordinal').map(toDef)
  }

  def(key: string): VariableDefinition | undefined {
    const row = this.db.get<DefRow>('SELECT * FROM variable_defs WHERE key = ?', [key])
    return row === undefined ? undefined : toDef(row)
  }

  define(input: VariableDefinitionInput): VariableDefinition {
    const existing = this.def(input.key)
    if (existing?.builtin === true) {
      const kept: VariableDefinition = { ...existing, name: input.name, description: input.description ?? existing.description, only: input.only ?? existing.only, visibility: input.visibility ?? existing.visibility, bands: input.bands ?? existing.bands, always: input.always ?? existing.always }
      return this.write(this.checked(kept))
    }
    if (existing === undefined && this.defs().length >= MAX_VARIABLES) throw new InvalidValueError(`a story tracks at most ${MAX_VARIABLES} variables`)
    return this.write(this.checked({
      key: input.key, name: input.name, description: input.description ?? '', kind: input.kind, subject: input.subject, only: input.only ?? [],
      ...(input.min === undefined ? {} : { min: input.min }), ...(input.max === undefined ? {} : { max: input.max }),
      integer: input.integer ?? false, options: input.options ?? [], default: input.default ?? (input.kind === 'flag' ? false : input.kind === 'choice' ? input.options?.[0] ?? '' : (input.min ?? 0)),
      baseline: input.baseline ?? false, visibility: input.visibility ?? 'public', bands: input.bands ?? [], always: input.always ?? false, builtin: false,
    }))
  }

  remove(key: string): boolean {
    const found = this.def(key)
    if (found?.builtin === true) throw new ConflictError(`${key} is built in and cannot be removed`)
    return this.db.run('DELETE FROM variable_defs WHERE key = ?', [key]).changes > 0
  }

  get(variable: string, subject: VariableSubject, subjectId: number): StoredVariable | undefined {
    const row = this.db.get<ValueRow>('SELECT * FROM variable_values WHERE variable = ? AND subject = ? AND subject_id = ?', [variable, subject, subjectId])
    return row === undefined ? undefined : toStored(row)
  }

  value(variable: string, subject: VariableSubject, subjectId: number): VariableValue {
    const stored = this.get(variable, subject, subjectId)
    if (stored !== undefined) return stored.value
    const def = this.def(variable)
    if (def === undefined) throw new NotFoundError(`there is no variable "${variable}"`)
    return def.default
  }

  set(variable: string, subject: VariableSubject, subjectId: number, change: { value?: VariableValue; baseline?: VariableValue }, turn: number): StoredVariable {
    return guard(() => this.db.transaction(() => {
      const def = this.def(variable)
      if (def === undefined) throw new NotFoundError(`there is no variable "${variable}"`)
      if (!this.applies(def, subject, subjectId)) throw new InvalidValueError(`${def.name} does not apply to this ${subject}`)
      for (const [what, given] of [['value', change.value], ['baseline', change.baseline]] as const) {
        if (given === undefined) continue
        if (what === 'baseline' && !def.baseline) throw new InvalidValueError(`${def.name} has no baseline`)
        const issue = valueIssue(def, given)
        if (issue !== undefined) throw new InvalidValueError(issue)
      }
      const current = this.get(variable, subject, subjectId)
      const baseline = !def.baseline ? undefined : change.baseline ?? current?.baseline ?? change.value ?? def.default
      const value = change.value ?? current?.value ?? baseline ?? def.default
      this.db.run(
        `INSERT INTO variable_values (variable, subject, subject_id, value, baseline, updated_turn) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (variable, subject, subject_id) DO UPDATE SET value = excluded.value, baseline = excluded.baseline, updated_turn = excluded.updated_turn`,
        [variable, subject, subjectId, toJson(value), baseline === undefined ? null : toJson(baseline), turn],
      )
      return this.get(variable, subject, subjectId)!
    }))
  }

  list(subject: VariableSubject, subjectId: number): StoredVariable[] {
    return this.db.all<ValueRow>('SELECT * FROM variable_values WHERE subject = ? AND subject_id = ? ORDER BY variable', [subject, subjectId]).map(toStored)
  }

  all(): StoredVariable[] {
    return this.db.all<ValueRow>('SELECT * FROM variable_values ORDER BY updated_turn DESC, variable').map(toStored)
  }

  applies(def: VariableDefinition, subject: VariableSubject, subjectId: number): boolean {
    if (def.subject !== subject) return false
    if (def.only.length === 0 || subject === 'world') return true
    const row = this.db.get<{ source_id: string | null }>(`SELECT source_id FROM ${SUBJECT_TABLES[subject]} WHERE id = ?`, [subjectId])
    if (row === undefined) return false
    return def.only.includes(row.source_id ?? String(subjectId))
  }

  private checked(def: VariableDefinition): VariableDefinition {
    const bad = (message: string): never => { throw new InvalidValueError(`${def.key}: ${message}`) }
    if (!VARIABLE_KEY.test(def.key)) bad('the key is lowercase letters, digits and underscores, starting with a letter, at most 40 characters')
    if (def.name.trim() === '' || def.name.length > 80) bad('give it a name of at most 80 characters')
    if (def.description.length > 400) bad('the description is at most 400 characters')
    if (!VARIABLE_KINDS.includes(def.kind)) bad(`unknown kind "${String(def.kind)}"`)
    if (!VARIABLE_SUBJECTS.includes(def.subject)) bad(`unknown subject "${String(def.subject)}"`)
    if (!VARIABLE_VISIBILITIES.includes(def.visibility)) bad(`unknown visibility "${String(def.visibility)}"`)
    if (def.visibility === 'private' && def.subject !== 'character') bad('only what belongs to a character can be private')
    if (def.only.length > MAX_ONLY || def.only.some(key => key.trim() === '')) bad(`it applies to at most ${MAX_ONLY} named subjects`)
    if (def.subject === 'world' && def.only.length > 0) bad('there is only one world')
    if (def.kind === 'number') {
      if ((def.min !== undefined && !Number.isFinite(def.min)) || (def.max !== undefined && !Number.isFinite(def.max)) || (def.min !== undefined && def.max !== undefined && def.min > def.max)) bad('its bounds are not acceptable')
      if (def.options.length > 0) bad('a number has no options')
    } else {
      if (def.min !== undefined || def.max !== undefined || def.integer || def.bands.length > 0) bad('only a number has bounds, whole numbers or bands')
      if (def.baseline && def.kind === 'flag') bad('a yes or no has no baseline')
    }
    if (def.kind === 'choice' && (def.options.length < 2 || def.options.length > MAX_OPTIONS || new Set(def.options).size !== def.options.length || def.options.some(option => option.trim() === ''))) bad(`a choice has from 2 to ${MAX_OPTIONS} different options`)
    if (def.kind !== 'choice' && def.options.length > 0) bad('only a choice has options')
    const issue = valueIssue(def, def.default)
    if (issue !== undefined) bad(`the default is not acceptable: ${issue}`)
    if (def.bands.length > MAX_BANDS || def.bands.some((band, index) => !Number.isFinite(band.upTo) || band.label.trim() === '' || (index > 0 && band.upTo <= def.bands[index - 1]!.upTo))) bad(`bands are from 1 to ${MAX_BANDS} words for rising bounds`)
    return def
  }

  private write(def: VariableDefinition): VariableDefinition {
    return guard(() => this.db.transaction(() => {
      const ordinal = this.db.get<{ ordinal: number }>('SELECT ordinal FROM variable_defs WHERE key = ?', [def.key])?.ordinal ?? (this.db.get<{ next: number | null }>('SELECT MAX(ordinal) + 1 AS next FROM variable_defs')?.next ?? 0)
      this.db.run(
        `INSERT INTO variable_defs (key, ordinal, name, description, kind, subject, only_keys, min_value, max_value, is_integer, options, default_value, has_baseline, visibility, bands, always_shown, builtin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET name = excluded.name, description = excluded.description, kind = excluded.kind, subject = excluded.subject, only_keys = excluded.only_keys,
           min_value = excluded.min_value, max_value = excluded.max_value, is_integer = excluded.is_integer, options = excluded.options, default_value = excluded.default_value,
           has_baseline = excluded.has_baseline, visibility = excluded.visibility, bands = excluded.bands, always_shown = excluded.always_shown`,
        [def.key, ordinal, def.name.trim(), def.description.trim(), def.kind, def.subject, toJson(def.only), def.min ?? null, def.max ?? null, def.integer ? 1 : 0, toJson(def.options), toJson(def.default), def.baseline ? 1 : 0, def.visibility, toJson(def.bands), def.always ? 1 : 0, def.builtin ? 1 : 0],
      )
      return this.def(def.key)!
    }))
  }
}
