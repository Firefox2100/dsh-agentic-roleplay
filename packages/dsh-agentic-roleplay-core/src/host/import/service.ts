import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    roleplayImport: RoleplayImport
  }
}

export interface ImportSettings {
  maxUploadBytes: number
  concurrency: number
  reasoning: string
  maxTokens: number
  temperature: number
}

/** What an import is configured to do, for the parts of the plugin that run in other scopes (the authoring chat's tools). */
export class RoleplayImport extends Service {
  constructor(ctx: Context, readonly settings: ImportSettings) {
    super(ctx, 'roleplayImport')
  }
}
