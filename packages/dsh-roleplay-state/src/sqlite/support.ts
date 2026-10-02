import { ConflictError, CorruptDataError, InvalidValueError, NotFoundError } from '../errors.ts'

/** Keys for case-insensitive lookup; they fold compatibility forms, which SQLite's own NOCASE does not. */
export function lookupKey(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase()
}

/** Run a statement, turning constraint failures into the errors callers know. */
export function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('UNIQUE constraint failed')) throw new ConflictError(message, { cause: error })
    if (message.includes('FOREIGN KEY constraint failed')) throw new NotFoundError('a referenced row does not exist', { cause: error })
    if (message.includes('CHECK constraint failed')) throw new InvalidValueError(message, { cause: error })
    throw error
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

export function parseStringList(text: string, column: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    if (Array.isArray(value) && value.every(entry => typeof entry === 'string')) return value as string[]
  } catch {
    // reported below
  }
  throw new CorruptDataError(`${column} does not hold a list of strings`)
}
