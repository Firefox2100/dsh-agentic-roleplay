import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayImport: RoleplayImport
  }
}

export interface ImportSettings {
  maxUploadBytes: number
  concurrency: number
  /** The thinking level of the helper agents; empty is the chat's own. */
  reasoning: string
  /** `provider/model` the helpers run on; empty is the chat's own. */
  model: string
  /** The most one request of a helper may write; 0 is a share of the model's context window. */
  maxTokens: number
  /** How many tracked values one request is asked to declare; a card with more is asked again for the rest. */
  variablesPerRequest: number
  /** `schema` asks a helper for its result as a reply constrained to the result's JSON schema, `tool` (the default) as a call of a tool; an endpoint that does not take `response_format` needs `tool`. */
  structured: 'tool' | 'schema'
  temperature: number
  /** Minutes a helper may work before it is stopped; 0 never stops it. */
  timeoutMinutes: number
  /** `decision` lets a decision model settle the pieces it is sure of before the language model is asked. */
  decisions: 'llm' | 'decision'
  confidence: number
  /** `auto` lets the world authoring chat change the world without asking; `ask` (the default when absent) puts every change to the person. */
  approval?: 'ask' | 'auto'
}

/** What an import is configured to do, for the parts of the plugin that run in other scopes (the authoring chat's tools). */
export class RoleplayImport extends Service {
  constructor(ctx: Context, private readonly read: () => ImportSettings) {
    super(ctx, 'roleplayImport')
  }

  /** The settings as they stand now: they are edited while the plugin runs. */
  get settings(): ImportSettings {
    return this.read()
  }
}
