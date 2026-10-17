import { VARIABLE_KINDS, VARIABLE_SUBJECTS, VARIABLE_VISIBILITIES, type RoutineDefinition } from 'dsh-roleplay-model'
import { InvalidEditProblems } from './world-state.ts'

/** The characters of a world with the day each lives, and the places a window can name. */
export interface WorldRoutines {
  characters: { key: string; name: string; routine: RoutineDefinition[] }[]
  places: { key: string; name: string; features: { key: string; name: string }[] }[]
}

/** One declared variable as `variables.json` writes it. */
export interface VariableDeclaration {
  key: string
  name: string
  kind: (typeof VARIABLE_KINDS)[number]
  subject: (typeof VARIABLE_SUBJECTS)[number]
  visibility: (typeof VARIABLE_VISIBILITIES)[number]
  description?: string
  min?: number
  max?: number
  integer?: boolean
  baseline?: boolean
  always?: boolean
  default?: number | boolean | string
  only?: string[]
  options?: string[]
  bands?: { up_to: number; label: string }[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const ROUTINE_FIELDS = ['days', 'on', 'from', 'to', 'activity', 'location', 'feature', 'position', 'interruptible']

/**
 * The windows of a day as the browser sends them.
 * @throws {InvalidEditProblems} naming every field that has the wrong shape; whether the times and places are acceptable is checked when the file is read back.
 */
export function parseRoutineEdit(value: unknown): RoutineDefinition[] {
  const problems: string[] = []
  const list = isObject(value) && Array.isArray(value['windows']) ? value['windows'] : undefined
  if (list === undefined) throw new InvalidEditProblems(['the day must be { windows: [...] }'])
  const windows = list.map((entry, index): RoutineDefinition => {
    const at = `windows[${index}]`
    if (!isObject(entry)) { problems.push(`${at} must be an object`); return { days: [], from: '', to: '', activity: '', interruptible: true } }
    for (const key of Object.keys(entry)) if (!ROUTINE_FIELDS.includes(key)) problems.push(`${at}.${key} is not a field of a window`)
    for (const key of ['from', 'to', 'activity'] as const) if (typeof entry[key] !== 'string') problems.push(`${at}.${key} must be text`)
    for (const key of ['location', 'feature', 'position'] as const) if (entry[key] !== undefined && typeof entry[key] !== 'string') problems.push(`${at}.${key} must be text`)
    if (entry['days'] !== undefined && !(Array.isArray(entry['days']) && entry['days'].every(day => typeof day === 'string'))) problems.push(`${at}.days must be a list of days`)
    if (entry['interruptible'] !== undefined && typeof entry['interruptible'] !== 'boolean') problems.push(`${at}.interruptible must be true or false`)
    const text = (key: string): string => (typeof entry[key] === 'string' ? (entry[key] as string).trim() : '')
    return {
      days: Array.isArray(entry['days']) ? (entry['days'] as string[]).map(day => day.trim().toLowerCase()).filter(day => day !== '') : [],
      ...(Array.isArray(entry['on']) && entry['on'].length > 0 ? { on: (entry['on'] as string[]).map(day => String(day).trim()).filter(day => day !== '') } : {}),
      from: text('from'), to: text('to'), activity: text('activity'),
      ...(text('location') === '' ? {} : { location: text('location') }), ...(text('feature') === '' ? {} : { feature: text('feature') }), ...(text('position') === '' ? {} : { position: text('position') }),
      interruptible: entry['interruptible'] !== false,
    }
  })
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return windows
}

const VARIABLE_FIELDS = ['key', 'name', 'kind', 'subject', 'visibility', 'description', 'min', 'max', 'integer', 'baseline', 'always', 'default', 'only', 'options', 'bands']

/**
 * The declarations as the browser sends them, with empty fields left out. Whether they are acceptable together is checked against the world's files.
 * @throws {InvalidEditProblems} naming every field that has the wrong shape.
 */
export function parseVariablesEdit(value: unknown): VariableDeclaration[] {
  const problems: string[] = []
  const list = isObject(value) && Array.isArray(value['variables']) ? value['variables'] : undefined
  if (list === undefined) throw new InvalidEditProblems(['the variables must be { variables: [...] }'])
  const declarations = list.flatMap((entry, index): VariableDeclaration[] => {
    const at = `variables[${index}]`
    if (!isObject(entry)) { problems.push(`${at} must be an object`); return [] }
    for (const key of Object.keys(entry)) if (!VARIABLE_FIELDS.includes(key)) problems.push(`${at}.${key} is not a field of a variable`)
    const text = (key: string): string => (typeof entry[key] === 'string' ? (entry[key] as string).trim() : '')
    const number = (key: string): number | undefined => {
      if (entry[key] === undefined || entry[key] === null || entry[key] === '') return undefined
      if (typeof entry[key] !== 'number' || !Number.isFinite(entry[key])) { problems.push(`${at}.${key} must be a number`); return undefined }
      return entry[key] as number
    }
    const flag = (key: string): boolean | undefined => {
      if (entry[key] === undefined) return undefined
      if (typeof entry[key] !== 'boolean') { problems.push(`${at}.${key} must be true or false`); return undefined }
      return entry[key] as boolean
    }
    const strings = (key: string): string[] => {
      if (entry[key] === undefined) return []
      if (!(Array.isArray(entry[key]) && (entry[key] as unknown[]).every(item => typeof item === 'string'))) { problems.push(`${at}.${key} must be a list of text`); return [] }
      return (entry[key] as string[]).map(item => item.trim()).filter(item => item !== '')
    }
    const bands = Array.isArray(entry['bands']) ? entry['bands'].flatMap((band): { up_to: number; label: string }[] => (isObject(band) && typeof band['up_to'] === 'number' && typeof band['label'] === 'string' && band['label'].trim() !== '' ? [{ up_to: band['up_to'], label: band['label'].trim() }] : (problems.push(`${at}.bands needs { up_to, label } entries`), []))) : []
    const rawDefault = entry['default']
    if (rawDefault !== undefined && rawDefault !== null && rawDefault !== '' && typeof rawDefault !== 'number' && typeof rawDefault !== 'boolean' && typeof rawDefault !== 'string') problems.push(`${at}.default must be a number, true or false, or text`)
    for (const [key, allowed] of [['kind', VARIABLE_KINDS], ['subject', VARIABLE_SUBJECTS], ['visibility', VARIABLE_VISIBILITIES]] as const) if (!(allowed as readonly string[]).includes(text(key))) problems.push(`${at}.${key} must be one of: ${allowed.join(', ')}`)
    const [min, max] = [number('min'), number('max')]
    const [integer, baseline, always] = [flag('integer'), flag('baseline'), flag('always')]
    const only = strings('only'); const options = strings('options')
    return [{
      key: text('key'), name: text('name'), kind: text('kind') as VariableDeclaration['kind'], subject: text('subject') as VariableDeclaration['subject'], visibility: text('visibility') as VariableDeclaration['visibility'],
      ...(text('description') === '' ? {} : { description: text('description') }),
      ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }),
      ...(integer === true ? { integer } : {}), ...(baseline === true ? { baseline } : {}), ...(always === true ? { always } : {}),
      ...(rawDefault === undefined || rawDefault === null || rawDefault === '' ? {} : { default: rawDefault as number | boolean | string }),
      ...(only.length === 0 ? {} : { only }), ...(options.length === 0 ? {} : { options }), ...(bands.length === 0 ? {} : { bands }),
    }]
  })
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return declarations
}

/** `calendar.json` as the editor shows it: the hemisphere its seasons follow and the holidays the world names. */
export interface CalendarDocument {
  hemisphere: 'north' | 'south'
  holidays: { id: string; name: string; on: string[] }[]
}

/**
 * The calendar as the browser sends it.
 * @throws {InvalidEditProblems} naming every field that has the wrong shape; whether the days and ids are acceptable is checked as the file is read.
 */
export function parseCalendarEdit(value: unknown): CalendarDocument {
  const problems: string[] = []
  if (!isObject(value)) throw new InvalidEditProblems(['the calendar must be { hemisphere, holidays: [...] }'])
  if (value['hemisphere'] !== 'north' && value['hemisphere'] !== 'south') problems.push('hemisphere must be "north" or "south"')
  const list = Array.isArray(value['holidays']) ? value['holidays'] : undefined
  if (list === undefined) problems.push('holidays must be a list')
  const holidays = (list ?? []).map((entry, index): CalendarDocument['holidays'][number] => {
    const at = `holidays[${index}]`
    if (!isObject(entry)) { problems.push(`${at} must be an object`); return { id: '', name: '', on: [] } }
    for (const key of Object.keys(entry)) if (!['id', 'name', 'on'].includes(key)) problems.push(`${at}.${key} is not a field of a holiday`)
    for (const key of ['id', 'name'] as const) if (typeof entry[key] !== 'string') problems.push(`${at}.${key} must be text`)
    if (!(Array.isArray(entry['on']) && entry['on'].every(day => typeof day === 'string'))) problems.push(`${at}.on must be a list of days`)
    return {
      id: typeof entry['id'] === 'string' ? entry['id'].trim() : '', name: typeof entry['name'] === 'string' ? entry['name'].trim() : '',
      on: Array.isArray(entry['on']) ? (entry['on'] as string[]).map(day => String(day).trim()).filter(day => day !== '') : [],
    }
  })
  if (problems.length > 0) throw new InvalidEditProblems(problems)
  return { hemisphere: value['hemisphere'] as 'north' | 'south', holidays }
}
