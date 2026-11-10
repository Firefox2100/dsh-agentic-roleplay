import { sep } from 'node:path'

/**
 * The same absolute path as this platform writes it. Tests name paths in POSIX form; the code builds them with
 * `node:path`, so on Windows every separator is a backslash.
 */
export const native = (path: string): string => path.split('/').join(sep)
