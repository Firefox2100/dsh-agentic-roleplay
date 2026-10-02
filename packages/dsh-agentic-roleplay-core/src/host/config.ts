import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Root used when the profile configures none. */
export const DEFAULT_ROOT_PATH = '~/dsh-roleplay'

export interface Config {
  /** Directory holding roleplay content: characters, sessions and their data. */
  rootPath: Volatile<string>
}

export const Config = z.object({
  rootPath: z.string().default(DEFAULT_ROOT_PATH).volatile(),
})
