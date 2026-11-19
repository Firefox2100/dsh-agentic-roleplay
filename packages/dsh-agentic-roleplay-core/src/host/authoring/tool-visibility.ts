import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { authoredWorldOf } from '../../shared/authoring-chat.ts'
import type { ToolHiding } from '../../shared/authoring-settings.ts'
import { CARD_FILE, IMPORT_FOLDER } from '../import/store.ts'
import { PRESET_FILE } from '../import/preset-tools.ts'
import { UPDATE_FOLDER } from '../import/card-tools.ts'
import { importPhase, isReviewing } from '../import/run-import.ts'
import type { Phase } from '../import/run-import.ts'

/** The kinds of tool the visibility of an authoring chat's tools follows; every other tool is always offered. */
export type ToolGroup = 'import' | 'card' | 'update' | 'preset' | 'write'

const IMPORT_TOOLS = ['import_survey', 'import_build', 'import_finish', 'import_status', 'import_stage', 'import_show', 'import_audit', 'import_survey_show', 'import_survey_edit']
const CARD_TOOLS = ['card_overview', 'card_search', 'card_read', 'card_origin']
const UPDATE_TOOLS = ['card_diff', 'card_update_finish']
const PRESET_TOOLS = ['import_preset']
const WRITE_TOOLS = ['create_world_element', 'replace_world_element', 'update_world_element', 'delete_world_element', 'edit_world_info', 'edit_world_relationship', 'replace_world_plots', 'update_world_plot', 'write_world_trigger', 'update_world_trigger', 'write_world_file', 'update_world_file', 'delete_world_trigger']

const GROUPS = new Map<string, ToolGroup>([
  ...IMPORT_TOOLS.map(name => [name, 'import'] as const),
  ...CARD_TOOLS.map(name => [name, 'card'] as const),
  ...UPDATE_TOOLS.map(name => [name, 'update'] as const),
  ...PRESET_TOOLS.map(name => [name, 'preset'] as const),
  ...WRITE_TOOLS.map(name => [name, 'write'] as const),
])

export const groupOf = (tool: string): ToolGroup | undefined => GROUPS.get(tool)

/** What a world holds that decides which tools are of use. */
export interface WorldFacts {
  card: boolean
  update: boolean
  preset: boolean
  phase: Phase | undefined
  reviewing: boolean
}

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function worldFacts(directory: string): Promise<WorldFacts> {
  const folder = join(directory, IMPORT_FOLDER)
  const [card, update, preset, phase, reviewing] = await Promise.all([
    exists(join(folder, CARD_FILE)), exists(join(folder, UPDATE_FOLDER, CARD_FILE)), exists(join(folder, PRESET_FILE)), importPhase(directory), isReviewing(directory),
  ])
  return { card, update, preset, phase, reviewing }
}

/**
 * Whether a tool of `group` is offered. By default only what no world without a card can use is left out. In `phase` mode the tools also follow the import: while a card is being
 * imported the world is still blank (everything is staged), so the writing tools wait until it is finished, except while a newer card is being brought in; the import's own tools go
 * once it is done and its review ended; the update tools are only there while a newer card waits.
 */
export function visible(group: ToolGroup, hiding: ToolHiding, facts: WorldFacts): boolean {
  if (hiding === 'off') return true
  const hasCard = facts.card || facts.update || facts.phase !== undefined
  if (group === 'preset') return facts.preset || hasCard
  if (group === 'import' || group === 'card' || group === 'update') { if (!hasCard) return false }
  if (hiding === 'card') return true
  if (group === 'import') return facts.phase === 'ready' || facts.phase === 'surveyed' || facts.phase === 'built' || facts.phase === 'repair' || (facts.phase === 'done' && facts.reviewing)
  if (group === 'update') return facts.update
  if (group === 'write') return facts.update || !(facts.phase === 'ready' || facts.phase === 'surveyed' || facts.phase === 'built')
  return true
}

const FACTS_FOR_MS = 400

/**
 * Gives each tool of an authoring chat the step-time condition that follows `visible`. DSH asks every tool at every step, so the facts of a world are read once and shared for a moment
 * rather than once per tool.
 */
export function registerWithVisibility(ctx: Context, tools: readonly ToolDefinition[], deps: { worldDirectory: (world: string) => Promise<string | undefined>; hiding: (world: string) => ToolHiding }): void {
  const recent = new Map<string, { at: number; facts: Promise<WorldFacts> }>()
  const factsOf = (directory: string): Promise<WorldFacts> => {
    const found = recent.get(directory)
    if (found !== undefined && Date.now() - found.at < FACTS_FOR_MS) return found.facts
    const facts = worldFacts(directory)
    recent.set(directory, { at: Date.now(), facts })
    return facts
  }
  for (const tool of tools) {
    const group = groupOf(tool.name)
    if (group === undefined) { ctx.tools.register(tool); continue }
    ctx.tools.register(tool, {
      when: async ({ agent }: { agent: Agent }) => {
        if (agent.session.header.origin === 'subagent') return true
        const world = authoredWorldOf(agent.session.id)
        if (world === undefined) return true
        const hiding = deps.hiding(world)
        if (hiding === 'off') return true
        const directory = await deps.worldDirectory(world)
        return directory === undefined ? true : visible(group, hiding, await factsOf(directory))
      },
    })
  }
}
