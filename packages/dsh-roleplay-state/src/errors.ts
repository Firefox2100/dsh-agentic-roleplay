export class StateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** The requested row does not exist. */
export class NotFoundError extends StateError {}

/** The change clashes with existing data, such as a repeated id or a stale version. */
export class ConflictError extends StateError {}

/** A value is outside what the schema allows. */
export class InvalidValueError extends StateError {}

/** The file is not a session database, or was written by a newer version. */
export class SchemaError extends StateError {}

/** Stored data cannot be read back as a canonical model. */
export class CorruptDataError extends StateError {}
