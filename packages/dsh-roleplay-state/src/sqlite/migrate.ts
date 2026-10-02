import type { SqlDatabase } from '../driver/types.ts'
import { SchemaError } from '../errors.ts'
import { APPLICATION_ID, LATEST_VERSION, MIGRATIONS } from './schema.ts'

export interface DatabaseState {
  version: number
  applicationId: number
  /** Whether the file holds any tables at all. */
  empty: boolean
}

export function inspect(db: SqlDatabase): DatabaseState {
  const version = db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
  const applicationId = db.get<{ application_id: number }>('PRAGMA application_id')?.application_id ?? 0
  const tables = db.get<{ count: number }>("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'")?.count ?? 0
  return { version, applicationId, empty: tables === 0 }
}

/**
 * Bring the database up to the latest schema, applying each missing migration
 * in its own transaction.
 * @throws {SchemaError} when the file belongs to something else, or was written by a newer version.
 */
export function migrate(db: SqlDatabase): void {
  const state = inspect(db)
  if (state.version === 0 && !state.empty) throw new SchemaError('the file is not a session database')
  if (state.version > 0 && state.applicationId !== APPLICATION_ID) throw new SchemaError('the file is not a session database')
  if (state.version > LATEST_VERSION) {
    throw new SchemaError(`the database has schema version ${state.version}, but this version understands up to ${LATEST_VERSION}`)
  }
  for (const migration of MIGRATIONS.filter(candidate => candidate.version > state.version)) {
    db.transaction(() => {
      db.exec(migration.sql)
      if (migration.version === 1) db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${migration.version}`)
    })
  }
}
