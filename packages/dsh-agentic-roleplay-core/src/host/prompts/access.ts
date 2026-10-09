import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptLibrary, PromptVariables } from './library.ts'

/** The prompt `id` in `language`, from the library of the agent's own context. */
export function promptFor(agent: Agent, id: string, language: string, variables?: PromptVariables): string {
  const library = (agent.ctx as unknown as { get(name: 'roleplayPrompts'): PromptLibrary | undefined }).get('roleplayPrompts')
  if (library === undefined) throw new Error('the prompt library is not running')
  return library.text(id, language, variables)
}
