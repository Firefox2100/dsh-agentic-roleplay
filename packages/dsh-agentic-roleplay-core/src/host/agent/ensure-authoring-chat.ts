import { join } from 'node:path'
import { AgentUnavailableError } from '../sessions/errors.ts'
import type { PromptLibrary } from '../prompts/library.ts'
import type { AuthoringLanguages } from '../worlds/authoring-language.ts'
import { ensureAgentChat, isStored, type AgentServices } from './agent-sessions.ts'
import { storeAuthoringOpening } from './opening.ts'

/** What tells one kind of authoring chat (a world's, a preset's, a lorebook's) from another: where its project lives, its preset, and how it is named. */
export interface AuthoringKind {
  /** The folder of the roleplay root the kind's project is made in. */
  folder: string
  projectTitle: string
  agentPreset: string
  /** The shipped prompt of the opening message. */
  welcome: string
  /** What the opening is recorded as coming from, when it is not the plain authoring opening. */
  openingSource?: { provider: string; model: string }
}

/** What one chat of a kind is about. */
export interface AuthoringSubject {
  chatId: string
  /** Where the chat's language is kept (the world's id, `preset:<name>`, `lorebook:<name>`); none when the language is given with every call. */
  languageKey?: string
  title: string
  language?: string | undefined
  /** The variables the welcome prompt is given. */
  welcome: Record<string, string>
  /** Whether a chat that exists is renamed to the title. */
  renameExisting: boolean
}

/**
 * Creates or reopens the authoring chat of a subject in the project of its kind: its language is kept, its opening is stored before the chat is made (a stored chat not yet in the project is adopted,
 * not made again), and the chat is made or adopted.
 * @throws {AgentUnavailableError} when the profile cannot store an opening.
 */
export async function ensureAuthoringChat(services: AgentServices, roleplayRoot: string, prompts: PromptLibrary, languages: AuthoringLanguages | undefined, kind: AuthoringKind, subject: AuthoringSubject): Promise<string> {
  if (subject.languageKey !== undefined) languages?.set(subject.languageKey, subject.language)
  const language = subject.languageKey === undefined ? subject.language : languages?.get(subject.languageKey)
  const projectPath = join(roleplayRoot, kind.folder)
  const project = await services.registry.create(projectPath, kind.projectTitle)
  const existed = project.sessionIds.includes(subject.chatId)
  const stored = !existed && await isStored(services.persistence, subject.chatId)
  if (!existed && !stored) {
    if (services.persistence === undefined) throw new AgentUnavailableError('this DSH profile cannot store the opening of an authoring chat')
    await storeAuthoringOpening(services.persistence, { id: subject.chatId, cwd: project.path, agentPreset: kind.agentPreset }, prompts.text(kind.welcome, language, subject.welcome), kind.openingSource)
  }
  return await ensureAgentChat(services, { projectPath, projectTitle: kind.projectTitle, sessionId: subject.chatId, agentPreset: kind.agentPreset, title: subject.title, renameExisting: subject.renameExisting }, project)
}
