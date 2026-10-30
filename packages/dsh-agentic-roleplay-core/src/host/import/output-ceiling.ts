import type { Agent } from '@deepseek-ai/dsh-agent'

/** A share of the model's context window, and the least and the fallback when the window is not known: the default of what one helper request may write. */
export const AUTO_OUTPUT_SHARE = 0.1
export const AUTO_OUTPUT_MIN = 16_000
export const AUTO_OUTPUT_UNKNOWN = 32_000

const windows = new Map<string, number>()

/** The most one request may write when the setting is automatic (0): a tenth of the window, at least 16 000 tokens. */
export function autoOutputCeiling(window?: number): number {
  return window === undefined ? AUTO_OUTPUT_UNKNOWN : Math.max(AUTO_OUTPUT_MIN, Math.round(window * AUTO_OUTPUT_SHARE))
}

/** The ceiling for requests that cannot wait for the window to be looked up: what was learned from an earlier lookup of the model, or the fallback. */
export function knownOutputCeiling(configured: number, model?: { provider: string; model: string }): number {
  if (configured > 0) return configured
  return autoOutputCeiling(model === undefined ? undefined : windows.get(`${model.provider}/${model.model}`))
}

/** The most one request of a helper may write: the setting when it names a number, else a share of the context window of the model the helper runs on (the chat's own unless one is named). */
export async function outputCeiling(configured: number, agent: Agent, named: { provider: string; model: string } | undefined, signal: AbortSignal): Promise<number> {
  if (configured > 0) return configured
  const config = agent.session.requestHeader()?.config
  const model = named ?? (config?.provider === undefined || config.model === undefined ? undefined : { provider: config.provider, model: config.model })
  if (model === undefined) return autoOutputCeiling()
  const key = `${model.provider}/${model.model}`
  let window = windows.get(key)
  if (window === undefined) {
    try { window = (await agent.ctx.llm.resolveModelInfo(model.provider, model.model, signal)).context?.contextWindow } catch { window = undefined }
    if (window !== undefined) windows.set(key, window)
  }
  return autoOutputCeiling(window)
}
