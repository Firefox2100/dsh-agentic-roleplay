import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * What the Web bundle's `harness-dev-context` plugin says to every agent: where the DSH checkout is, that
 * the harness may be inspected and extended, and what "this page" is. It orients an agent working on DSH
 * itself. A game master, a character, an author or a doctor works on a story: the text is noise in every
 * prompt, it names this machine's paths, and it points at the browser tab instead of the scene.
 *
 * `SystemPrompt` resolves a contribution by name at the nearest scope, so a registration made here — in
 * a preset's scope — shadows the profile's registration for that preset's agents and leaves every other
 * session in the profile as DSH made it. Only the name and order have to match; empty text contributes
 * nothing.
 */
const SILENCED = [
  { name: 'harness:source', section: 'HARNESS_SOURCE', context: 'HARNESS_SOURCE' },
  { name: 'app:web-surface', section: 'WEB_SURFACE', context: 'WEB_SURFACE' },
] as const

export function silenceHarnessDevContext(ctx: Context): void {
  for (const entry of SILENCED) {
    ctx.systemPrompt.section({ name: entry.name, order: ctx.systemPrompt.getSectionOrder(entry.section), interpolate: false, text: '' })
    ctx.systemPrompt.context({ name: entry.name, order: ctx.systemPrompt.getContextOrder(entry.context), interpolate: false, text: '' })
  }
}

/** Removes DSH runtime facts from agents that receive their working context elsewhere. */
export function silenceRuntimeContext(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.suppressRuntimeContext(), 'roleplay: runtime context')
  ctx.systemPrompt.context({ name: 'working-directory:current', order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'), interpolate: false, text: '' })
}
