export const COMMANDS_KEY = 'roleplay.commands'

/** A slash command a world defines, as a story keeps it. */
export interface StoryCommand {
  word: string
  key: string
  description: string
}

/** The name of the flag a command raises. */
export const commandFlagKey = (command: Pick<StoryCommand, 'key'>): string => `command_${command.key}`

/** The commands kept with a story, or none when the value is missing or is not a list of commands. */
export function commandsOf(value: unknown): StoryCommand[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is StoryCommand => typeof entry === 'object' && entry !== null && typeof (entry as StoryCommand).word === 'string' && typeof (entry as StoryCommand).key === 'string' && typeof (entry as StoryCommand).description === 'string')
}
