/** A run, or a choice, cannot be made now. */
export class SyncRefusedError extends Error {}

/** rclone could not be started or reported a failure. */
export class RcloneError extends Error {
  constructor(message: string, readonly code: number | undefined) {
    super(message)
  }
}

/** The unit is being synced: nothing may write to it or read from it until the run is over. */
export class UnitLockedError extends Error {}
