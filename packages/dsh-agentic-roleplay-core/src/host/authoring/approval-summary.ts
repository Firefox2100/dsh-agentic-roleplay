import { isDeepStrictEqual } from 'node:util'

export type Summary = { readonly en: string; readonly zh: string; readonly [locale: string]: string }

const MAX_FIELDS = 5

function clip(value: unknown, max: number): string {
  const text = typeof value === 'string' ? `“${value}”` : JSON.stringify(value) ?? ''
  const flat = text.replace(/\s+/g, ' ')
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const records = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What a replacement changes, field by field at the top level: the person sees the edit, not just that there is one. */
export function changedFields(before: unknown, after: unknown): Summary {
  if (!records(before) || !records(after)) return { en: '', zh: '' }
  const parts: string[] = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isDeepStrictEqual(before[key], after[key])) continue
    if (!(key in before)) parts.push(`+${key} ${clip(after[key], 60)}`)
    else if (!(key in after)) parts.push(`-${key}`)
    else parts.push(`${key} ${clip(before[key], 40)} → ${clip(after[key], 40)}`)
  }
  if (parts.length === 0) return { en: 'no field changes', zh: '没有字段变化' }
  const shown = parts.slice(0, MAX_FIELDS).join('; ')
  const more = parts.length - MAX_FIELDS
  return { en: more > 0 ? `${shown}; and ${more} more` : shown, zh: more > 0 ? `${shown}；另有 ${more} 项` : shown }
}

/** A newly made document: its name and which fields it fills. */
export function createdFields(document: unknown): Summary {
  if (!records(document)) return { en: '', zh: '' }
  const keys = Object.keys(document)
  if (keys.length === 0) return { en: '', zh: '' }
  const name = typeof document['name'] === 'string' ? `named ${clip(document['name'], 60)}, ` : ''
  const zhName = typeof document['name'] === 'string' ? `名为${clip(document['name'], 60)}，` : ''
  const listed = keys.slice(0, 8).join(', ') + (keys.length > 8 ? ', …' : '')
  return { en: `${name}fields: ${listed}`, zh: `${zhName}字段：${listed}` }
}

export function sizeOf(text: unknown): Summary {
  if (typeof text !== 'string') return { en: '', zh: '' }
  return { en: `${text.length} characters, starting ${clip(text, 70)}`, zh: `${text.length} 个字符，开头：${clip(text, 70)}` }
}

export function plain(value: unknown, max = 220): Summary {
  const text = clip(value, max)
  return { en: text, zh: text }
}
