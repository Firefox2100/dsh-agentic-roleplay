import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Root used when the profile configures none. */
export const DEFAULT_ROOT_PATH = '~/dsh-roleplay'

/** Where DSH keeps its sessions when the profile configures none. */
export const DEFAULT_STORE_PATH = '~/.dsh/sessions'

export interface Config {
  /** Directory holding roleplay content: characters, sessions and their data. */
  rootPath: Volatile<string>
  /** The folder DSH keeps its sessions in, which deleting a session removes its chat from. */
  sessionStorePath: string
}

export const Config = z.object({
  rootPath: z.string().default(DEFAULT_ROOT_PATH).volatile(),
  sessionStorePath: z.string().default(DEFAULT_STORE_PATH),
})
