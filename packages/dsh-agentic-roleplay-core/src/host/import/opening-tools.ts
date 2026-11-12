import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { hasSpeech, partsText } from '../../shared/opening.ts'
import { loadCharacters } from '../characters/load.ts'
import type { WorldCatalog } from '../worlds/catalog.ts'
import { editWorldInfo, readWorldInfo } from '../worlds/world-info.ts'
import { shapeOpening } from './opening-parts.ts'
import { contextOf, worldOf, type Prompting } from './tools.ts'
import type { ImportSettings } from './service.ts'

export const OPENING_TOOL = 'reshape_opening'

/**
 * The tool that turns an opening of the world into parts (narration and lines of characters) or back into plain text, for a world imported before openings could have parts
 * or whose split was wrong. It keeps every word: a split that changes the text is refused. Every call asks the person first.
 */
export function openingTools(worlds: WorldCatalog, settings: () => ImportSettings, prompting: Prompting): ToolDefinition[] {
  return [defineTool({
    name: OPENING_TOOL,
    description: 'Change the form of an opening without changing its words. form "parts" splits plain text into narration and the lines that characters of this world speak (a speaker you are not sure of stays narration; an opening with no spoken line stays plain text); form "plain" joins parts that are only narration back into plain text and is refused when a character speaks. target is "opening" (the world\'s opening message) or "alternate:<position>" (an alternate opening, counting from 0). To correct who speaks a line, or to change words, use edit_world_info with openingParts instead. When the person asks to change the form of an opening, call this at once: the person approves the call itself, so do not ask first, and never retype the opening with edit_world_info to do it. Requires user approval.',
    parameters: {
      target: { type: 'string', required: true, description: '"opening" or "alternate:<position>".' },
      form: { type: 'string', required: true, enum: ['parts', 'plain'], description: 'The form to give it.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const world = await worldOf(worlds, exec)
      const info = await readWorldInfo(world.directory)
      const match = /^alternate:(\d+)$/.exec(args.target.trim())
      const position = match === null ? undefined : Number(match[1])
      if (args.target.trim() !== 'opening' && position === undefined) throw new Error('target is "opening" or "alternate:<position>"')
      const alternate = position === undefined ? undefined : info.alternateOpenings[position]
      if (position !== undefined && alternate === undefined) throw new Error(`the world has no alternate opening ${position}`)
      const current = alternate === undefined ? { text: info.opening, parts: info.openingParts } : { text: alternate.text, parts: alternate.parts }
      if (current.text.trim() === '') throw new Error('that opening is empty')
      const write = async (form: { opening: string } | { openingParts: NonNullable<typeof current.parts> }): Promise<void> => {
        if (alternate === undefined || position === undefined) { await editWorldInfo(world.directory, form); return }
        const { text: _text, parts: _parts, ...rest } = alternate
        const entry = 'opening' in form ? { ...rest, text: form.opening } : { ...rest, text: partsText(form.openingParts), parts: form.openingParts }
        await editWorldInfo(world.directory, { alternateOpenings: info.alternateOpenings.map((item, index) => (index === position ? entry : item)) })
      }
      if (args.form === 'plain') {
        if (current.parts === undefined) return { target: args.target, form: 'plain', changed: false, note: 'it is already plain text' } as never
        if (hasSpeech(current.parts)) throw new Error('characters speak in this opening, so it cannot be plain text; remove their lines first')
        await write({ opening: partsText(current.parts) })
        await worlds.list({ refresh: true })
        return { target: args.target, form: 'plain', changed: true } as never
      }
      if (current.parts !== undefined) return { target: args.target, form: 'parts', changed: false, note: 'it is already in parts' } as never
      const language = prompting.languages().get(world.id)
      const ctx = contextOf(exec, settings(), (id, variables) => prompting.prompts().text(id, language, variables), language)
      const cast = (await loadCharacters(world.directory)).characters.map(character => ({ id: character.id, name: character.name, aliases: character.aliases ?? [] }))
      const shaped = await shapeOpening(ctx, current.text, cast)
      if (shaped.parts === undefined) return { target: args.target, form: 'parts', changed: false, note: shaped.note ?? 'no character speaks in it, so it stays plain text' } as never
      await write({ openingParts: shaped.parts })
      await worlds.list({ refresh: true })
      return { target: args.target, form: 'parts', changed: true, parts: shaped.parts } as never
    },
  })]
}
