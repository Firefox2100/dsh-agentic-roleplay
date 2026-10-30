import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SYNC, type SyncConfig } from '../shared/sync.ts'

/** Root used when the profile configures none. */
export const DEFAULT_ROOT_PATH = '~/dsh-roleplay'

/** Where DSH keeps its sessions when the profile configures none. */
export const DEFAULT_STORE_PATH = '~/.dsh/sessions'

export interface CatalogueEntry {
  /** What the person calls the catalogue; unique. */
  name: string
  /** The catalogue's API root, for example `https://catalogue.example/api`. */
  baseUrl: string
  /** The credential in DSH's credential store that holds the API key, sent as a Bearer token to this catalogue's site only. Empty uses a name made from the catalogue's name. */
  apiKeyRef: string
  /** Deprecated: a key written here as text by an earlier version. It is still sent when the store holds no key for `apiKeyRef`, and settings removes it when saved. */
  apiKey: string
}

export interface Config {
  /** Directory holding roleplay content: characters, sessions and their data. */
  rootPath: Volatile<string>
  /** The folder DSH keeps its sessions in, which deleting a session removes its chat from. */
  sessionStorePath: string
  /** The catalogues worlds can be browsed and installed from. */
  catalogues: Volatile<CatalogueEntry[]>
  /**
   * The tools other plugins registered for everyone (a web search, MCP servers, files) that each assistant of authoring chats may use, as `{ worldAuthoring: { tool_name: true } }`
   * (`presetAuthoring` and `lorebookAuthoring` likewise). An assistant has none that it is not given here, whatever else the profile registers; the session doctor never has any.
   */
  authoringTools: Volatile<Record<string, Record<string, boolean>>>
  /** Syncing the root with other devices through rclone; off while `remote` is empty. */
  sync: Volatile<SyncConfig>
  /** The most a downloaded world may be, in bytes, compressed and again unpacked. */
  catalogueMaxBytes: Volatile<number>
  /** Days the files an update replaced are kept in the trash folder before they are deleted; 0 keeps them for good. */
  catalogueTrashDays: Volatile<number>
  /** The most a character card upload may be, in bytes. Big cards with lorebooks and scripts reach tens of megabytes. */
  importMaxUploadBytes: Volatile<number>
  /** How many calls of an import run at once. A local model serves few at a time: raise it only with a server that can. */
  importConcurrency: Volatile<number>
  /** How hard the helper agents of imports and authoring think, as a level the model offers (for example `off`); empty uses `childReasoning`, then the chat's own level. */
  importReasoning: Volatile<string>
  /** The thinking level the helpers of a roleplay chat (characters, record keeper, authors, suggestions) get when the chat's own setting is empty, as a level the model offers (for example `off`); empty is the game master's own level. Thinking made them minutes slower and the record keeper gave up before answering. */
  childReasoning: Volatile<string>
  /** The model the helper agents of imports and authoring run on, as `provider/model`; empty is the chat's own model. */
  importModel: Volatile<string>
  /** The most tokens one model request of an import may produce. */
  importMaxTokens: Volatile<number>
  importStructuredOutput: Volatile<'tool' | 'schema'>
  importVariablesPerRequest: Volatile<number>
  /** How freely the agents of an import write; low, because they copy and sort what the card says. */
  importTemperature: Volatile<number>
  /** Minutes one helper agent of an import or authoring job may work before it is stopped; 0 never stops it. */
  importTimeoutMinutes: Volatile<number>
  /** Who sorts the pieces of a card that are only instructions or notes: `llm` asks the language model about every piece, `decision` lets the decision model (when one is selected) settle the pieces it is sure of first. */
  importDecisions: Volatile<string>
  /** How sure the decision model must be for `importDecisions: decision` to take its answer, from 0 to 1. */
  importConfidence: Volatile<number>
  /** Whether the world authoring chat asks before each change to the world: `ask` shows each change and waits, `auto` makes them at once (the files it replaces are kept in the world's `.trash`). */
  authoringApproval: Volatile<string>
}

export const Config = z.object({
  rootPath: z.string().default(DEFAULT_ROOT_PATH).volatile(),
  sessionStorePath: z.string().default(DEFAULT_STORE_PATH),
  catalogues: z.array(z.object({ name: z.string().required(), baseUrl: z.string().required(), apiKeyRef: z.string().default(''), apiKey: z.string().default('') })).default([]).volatile(),
  authoringTools: z.dict(z.dict(z.boolean())).default({}).volatile(),
  sync: z.object({ remote: z.string().default(''), rclone: z.string().default(''), configFile: z.string().default(''), passwordRef: z.string().default(''), intervalMinutes: z.number().min(0).default(0) }).default({ ...DEFAULT_SYNC }).volatile(),
  catalogueMaxBytes: z.number().min(1024).default(256 * 1024 * 1024).volatile(),
  catalogueTrashDays: z.number().min(0).default(30).volatile(),
  importMaxUploadBytes: z.number().min(1024).default(100 * 1024 * 1024).volatile(),
  importConcurrency: z.number().min(1).max(16).default(4).volatile(),
  importReasoning: z.string().default('').volatile(),
  childReasoning: z.string().default('').volatile(),
  importModel: z.string().default('').volatile(),
  importStructuredOutput: z.union(['tool', 'schema'] as const).default('tool').volatile(),
  importMaxTokens: z.number().min(0).max(1000000).default(0).volatile(),
  importVariablesPerRequest: z.number().min(5).max(500).default(25).volatile(),
  importTemperature: z.number().min(0).max(2).default(0.2).volatile(),
  importTimeoutMinutes: z.number().min(0).max(240).default(15).volatile(),
  importDecisions: z.union([z.const('llm'), z.const('decision')]).default('llm').volatile(),
  importConfidence: z.number().min(0).max(1).default(0.7).volatile(),
  authoringApproval: z.union([z.const('ask'), z.const('auto')]).default('ask').volatile(),
})
