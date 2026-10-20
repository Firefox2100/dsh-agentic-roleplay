import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Root used when the profile configures none. */
export const DEFAULT_ROOT_PATH = '~/dsh-roleplay'

/** Where DSH keeps its sessions when the profile configures none. */
export const DEFAULT_STORE_PATH = '~/.dsh/sessions'

export interface CatalogueEntry {
  /** What the person calls the catalogue; unique. */
  name: string
  /** The catalogue's API root, for example `https://catalogue.example/api`. */
  baseUrl: string
  /** Sent as a Bearer token to this catalogue's site only; empty for public worlds only. Kept in the profile's configuration. */
  apiKey: string
}

export interface Config {
  /** Directory holding roleplay content: characters, sessions and their data. */
  rootPath: Volatile<string>
  /** The folder DSH keeps its sessions in, which deleting a session removes its chat from. */
  sessionStorePath: string
  /** The catalogues worlds can be browsed and installed from. */
  catalogues: Volatile<CatalogueEntry[]>
  /** The most a downloaded world may be, in bytes, compressed and again unpacked. */
  catalogueMaxBytes: number
  /** Days the files an update replaced are kept in the trash folder before they are deleted; 0 keeps them for good. */
  catalogueTrashDays: number
  /** The most a character card upload may be, in bytes. Big cards with lorebooks and scripts reach tens of megabytes. */
  importMaxUploadBytes: number
  /** How many calls of an import run at once. A local model serves few at a time: raise it only with a server that can. */
  importConcurrency: number
  /** How hard the agents of an import think, as a level the model offers (for example `off`); empty is the model's own level. */
  importReasoning: string
  /** The thinking level the helpers of a roleplay chat (characters, record keeper, authors, suggestions) get when the chat's own setting is empty, as a level the model offers (for example `off`); empty is the game master's own level. Thinking made them minutes slower and the record keeper gave up before answering. */
  childReasoning: string
  /** The most tokens one model request of an import may produce. */
  importMaxTokens: number
  /** How freely the agents of an import write; low, because they copy and sort what the card says. */
  importTemperature: number
}

export const Config = z.object({
  rootPath: z.string().default(DEFAULT_ROOT_PATH).volatile(),
  sessionStorePath: z.string().default(DEFAULT_STORE_PATH),
  catalogues: z.array(z.object({ name: z.string().required(), baseUrl: z.string().required(), apiKey: z.string().default('') })).default([]).volatile(),
  catalogueMaxBytes: z.number().min(1024).default(256 * 1024 * 1024),
  catalogueTrashDays: z.number().min(0).default(30),
  importMaxUploadBytes: z.number().min(1024).default(100 * 1024 * 1024),
  importConcurrency: z.number().min(1).max(16).default(4),
  importReasoning: z.string().default(''),
  childReasoning: z.string().default(''),
  importMaxTokens: z.number().min(1000).max(200000).default(16000),
  importTemperature: z.number().min(0).max(2).default(0.2),
})
