import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export const SKILLS_FOLDER = 'skills'
const SKILL_FILE = 'SKILL.md'
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** What a skill the package ships holds: its name, the one line the catalog shows, when to load it, and the text. */
export interface ShippedSkill {
  name: string
  description: string
  whenToUse?: string
  content: string
}

/** The part of DSH's skill registry this uses. */
interface SkillRegistry {
  register(skill: { name: string; description: string; whenToUse?: string; content: string; source: string; invocation: { modelInvocable: boolean; userInvocable: boolean } }): () => void
}

/** The folder of the skills that ship with the package, found from this module so that it works from source and from the build. */
export function shippedSkillsDirectory(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, SKILLS_FOLDER)
    if (existsSync(join(directory, 'package.json')) && existsSync(candidate)) return candidate
    if (dirname(directory) === directory) throw new Error('the skills shipped with the package were not found')
  }
}

/** Reads one `SKILL.md`: a front matter of `name`, `description` and `when_to_use`, then the text. @throws {Error} when the front matter is missing or incomplete. */
export function readSkill(text: string, where: string): ShippedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (match === null) throw new Error(`${where} has no front matter`)
  const fields = new Map<string, string>()
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  if (!SKILL_NAME.test(name)) throw new Error(`${where}: the name "${name}" is not kebab-case`)
  if (description === '') throw new Error(`${where} has no description`)
  const whenToUse = fields.get('when_to_use')
  return { name, description, ...(whenToUse === undefined || whenToUse === '' ? {} : { whenToUse }), content: match[2]!.replace(/\r\n/g, '\n').trim() }
}

/** Every skill the package ships: one folder each, holding a `SKILL.md`. */
export function loadShippedSkills(directory: string = shippedSkillsDirectory()): ShippedSkill[] {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
    const file = join(directory, entry.name, SKILL_FILE)
    const skill = readSkill(readFileSync(file, 'utf8'), file)
    if (skill.name !== entry.name) throw new Error(`${file}: the name "${skill.name}" is not the name of its folder`)
    return skill
  })
}

/**
 * Offers the skills to the agents of the plugin's scope when DSH's skill registry is there (a profile without it has no skills and the assistant works from its tools).
 * They are for the model alone: a person does not run them as commands.
 */
export function registerAuthoringSkills(ctx: Context, skills: readonly ShippedSkill[] = loadShippedSkills()): void {
  ctx.inject(['skills' as never], (scope: Context) => {
    const registry = (scope as unknown as { skills: SkillRegistry }).skills
    for (const skill of skills) registry.register({ ...skill, source: 'bundled', invocation: { modelInvocable: true, userInvocable: false } })
  })
}
