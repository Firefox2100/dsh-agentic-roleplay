export interface Issue {
  /** Location of the problem inside the document, such as `start.intents[0].priority`; empty for the document itself. */
  path: string
  message: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] }

export function formatIssue({ path, message }: Issue): string {
  return path === '' ? message : `${path}: ${message}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads a JSON object field by field. Problems are collected with their path
 * instead of stopping at the first one, so an author sees everything wrong in
 * a file at once. A missing field, `null` and a blank string all mean "absent".
 */
export class Reader {
  private constructor(
    private readonly data: Record<string, unknown>,
    private readonly path: string,
    private readonly issues: Issue[],
  ) {}

  /** Parse JSON text whose top level must be an object; reports why when it is not. */
  static fromJson(text: string, issues: Issue[]): Reader | undefined {
    let data: unknown
    try {
      data = JSON.parse(text.replace(/^﻿/, ''))
    } catch (error) {
      issues.push({ path: '', message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` })
      return undefined
    }
    if (!isRecord(data)) {
      issues.push({ path: '', message: 'expected a JSON object' })
      return undefined
    }
    return new Reader(data, '', issues)
  }

  fail(key: string, message: string): void {
    this.issues.push({ path: this.child(key), message })
  }

  /** The value as written, with `null` read as absent. */
  raw(key: string): unknown {
    const value = this.data[key]
    return value === null ? undefined : value
  }

  string(key: string, options: { required?: boolean } = {}): string | undefined {
    const value = this.raw(key)
    if (value !== undefined && typeof value !== 'string') {
      this.fail(key, 'must be a string')
      return undefined
    }
    const text = value?.trim()
    if (text === undefined || text === '') {
      if (options.required === true) this.fail(key, 'is required')
      return undefined
    }
    return text
  }

  /** A string that is empty when absent. */
  text(key: string): string {
    return this.string(key) ?? ''
  }

  number(key: string, range: { min?: number; max?: number } = {}): number | undefined {
    const value = this.raw(key)
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(key, 'must be a number')
      return undefined
    }
    if ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max)) {
      this.fail(key, `must be between ${range.min ?? '-∞'} and ${range.max ?? '∞'}`)
      return undefined
    }
    return value
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const value = this.string(key)
    if (value === undefined) return fallback
    const match = allowed.find(candidate => candidate === value)
    if (match === undefined) {
      this.fail(key, `must be one of: ${allowed.join(', ')}`)
      return fallback
    }
    return match
  }

  /** An array of strings, trimmed, without blanks or repeats. */
  strings(key: string): string[] {
    const value = this.raw(key)
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      this.fail(key, 'must be an array of strings')
      return []
    }
    const result = new Set<string>()
    value.forEach((entry: unknown, index) => {
      if (typeof entry !== 'string') this.fail(`${key}[${index}]`, 'must be a string')
      else if (entry.trim() !== '') result.add(entry.trim())
    })
    return [...result]
  }

  object(key: string): Reader | undefined {
    const value = this.raw(key)
    if (value === undefined) return undefined
    if (!isRecord(value)) {
      this.fail(key, 'must be an object')
      return undefined
    }
    return new Reader(value, this.child(key), this.issues)
  }

  objects(key: string): Reader[] {
    const value = this.raw(key)
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      this.fail(key, 'must be an array of objects')
      return []
    }
    return value.flatMap((entry: unknown, index): Reader[] => {
      if (isRecord(entry)) return [new Reader(entry, this.child(`${key}[${index}]`), this.issues)]
      this.fail(`${key}[${index}]`, 'must be an object')
      return []
    })
  }

  private child(key: string): string {
    return this.path === '' ? key : key === '' ? this.path : `${this.path}.${key}`
  }
}
