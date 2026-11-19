import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const ENTITY_GUIDES: Record<string, string> = {
  character: 'world-characters',
  location: 'world-places',
  item: 'world-items',
  faction: 'world-factions',
  lore: 'world-lore',
}

const FILE_GUIDES: Record<string, string> = {
  variables: 'world-variables',
  dice: 'world-dice',
  commands: 'world-commands',
  calendar: 'world-calendar',
}

/** The format guide (a skill) that says what the document a world-writing tool takes must look like, or nothing for a tool no guide covers. */
export function guideOf(exec: Pick<ToolExecution, 'name' | 'arguments'>): string | undefined {
  const args = (exec.arguments ?? {}) as Record<string, unknown>
  const kind = typeof args['kind'] === 'string' ? args['kind'] : ''
  switch (exec.name) {
    case 'create_world_element':
    case 'replace_world_element':
    case 'update_world_element': return ENTITY_GUIDES[kind]
    case 'write_world_file':
    case 'update_world_file': return FILE_GUIDES[kind]
    case 'write_world_trigger':
    case 'update_world_trigger': return 'world-triggers'
    case 'replace_world_plots':
    case 'update_world_plot': return 'world-plots'
    case 'edit_world_info':
    case 'reshape_opening': return 'world-info'
    default: return undefined
  }
}
