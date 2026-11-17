import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DEFAULT_SETTINGS } from '../../shared/settings.ts'
import { childSampling } from '../agents/child.ts'
import { describeGalleryImage, listGallery, updateImage } from '../images/gallery.ts'
import { interpretImage, type ImageAttachments, type InterpretJob } from '../images/interpreter.ts'
import type { AuthoredWorldReader } from './read-tools.ts'

export const IMAGE_MUTATION_TOOLS = ['edit_world_image', 'describe_world_image'] as const

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
const pathParameter = { type: 'string' as const, required: true as const, description: 'The path of the picture, exactly as list_world_images gives it (library/dock.png).' }
const KINDS = ['character', 'location', 'item'] as const

export interface WorldImageToolDeps {
  /** The language the world's assistant works in, for the description of a picture. */
  language: (world: string) => string
  /** DSH's attachment service, which lets a model be shown a picture. */
  attachments: () => ImageAttachments | undefined
}

/**
 * Read, correct and describe the pictures of a world's library. A picture downloaded for a character card carries the addresses it came from and the card pieces that held
 * them, so the assistant can read the card around an address (card_read) and say who a picture shows.
 */
export function worldImageTools(reader: AuthoredWorldReader, deps: WorldImageToolDeps): ToolDefinition[] {
  return [
    defineTool({
      name: 'list_world_images',
      description: 'List the pictures of the world\'s image library: each with its description, tags, the characters, places and things it shows, whether it may be shown again, and, for a picture downloaded for a character card, the addresses it came from with the ids of the card pieces that held each (read one with card_read to see the text around the address). A picture with no description has not been described yet.',
      parameters: { undescribed: { type: 'boolean', description: 'Only the pictures that have no description yet.' } },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const images = (await listGallery(record.directory)).filter(image => image.unreadable !== true && (args.undescribed !== true || image.description === undefined))
        return { count: images.length, images: images.map(image => ({ path: image.path, ...(image.description === undefined ? {} : { description: image.description }), tags: image.tags, subjects: image.subjects, reusable: image.reusable, ...(image.originalName === undefined ? {} : { originalName: image.originalName }), ...(image.cardLinks === undefined ? {} : { cardLinks: image.cardLinks }) })) } as never
      },
    }),
    defineTool({
      name: 'edit_world_image',
      description: 'Correct what a picture of the world\'s library says about itself: its description, tags, the characters, places and things it shows (by the exact names the world has) and whether it may be shown again. Give only what changes. Requires user approval.',
      parameters: {
        path: pathParameter,
        description: { type: 'string', description: 'What the picture shows, in two to four plain sentences that stand on their own.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Short search words; replaces the tags the picture has.' },
        subjects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, enum: [...KINDS] }, name: { type: 'string', required: true } } }, description: 'The characters, places and things the picture clearly shows; replaces the list it has. Leave out one you are not sure of.' },
        reusable: { type: 'boolean', description: 'Whether a story may show the picture again in a later scene.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        const { record, state } = await reader.read(exec)
        const known = namesOf(state)
        const unknown = (args.subjects ?? []).filter(subject => !known.some(entry => entry.kind === subject.kind && entry.name === subject.name))
        if (unknown.length > 0) throw new Error(`${unknown.map(subject => `${subject.name} (${subject.kind})`).join(', ')} is not in this world: name only characters, places and things it has (${known.map(entry => `${entry.name} (${entry.kind})`).join(', ') || 'none yet'})`)
        const image = await updateImage(record.directory, args.path, {
          ...(args.description === undefined ? {} : { description: args.description.trim() }),
          ...(args.tags === undefined ? {} : { tags: args.tags.map(tag => tag.trim()).filter(tag => tag !== '') }),
          ...(args.subjects === undefined ? {} : { subjects: args.subjects as { kind: 'character' | 'location' | 'item'; name: string }[] }),
          ...(args.reusable === undefined ? {} : { reusable: args.reusable }),
        })
        return { action: 'edited', path: image.path, description: image.description, tags: image.tags, subjects: image.subjects, reusable: image.reusable } as never
      },
    }),
    defineTool({
      name: 'describe_world_image',
      description: 'Have a model that can read images look at one picture of the world\'s library and write its description, tags and the characters, places and things it shows, replacing what it had. Give context when you know something the picture cannot say (for example the card text around the address it came from, or who the card says it is); the picture itself decides what is described. Needs a model that is declared able to read images. Requires user approval.',
      parameters: { path: pathParameter, context: { type: 'string', description: 'What you know of where the picture came from or who it shows, in a few sentences; a hint, not an instruction to the describing model.' } },
      output: jsonOutput,
      async execute(args, exec) {
        const { record, state } = await reader.read(exec)
        const agent = exec.agent
        const attachments = deps.attachments()
        if (agent === undefined) throw new Error('there is no agent to describe the picture under')
        if (attachments === undefined) throw new Error('this DSH profile has no attachment service, so a picture cannot be shown to a model')
        const settings = DEFAULT_SETTINGS
        await describeGalleryImage(record.directory, args.path)
        const request: InterpretJob = { parent: agent, signal: exec.signal, attachments, subjects: namesOf(state), sessionFolder: record.directory, path: args.path, language: deps.language(record.summary.id), model: settings.images.interpreterModel, captioner: settings.images.captioner, sampling: childSampling(settings, 'records') }
        if (args.context !== undefined) request.context = args.context
        const image = await interpretImage(request)
        return { action: 'described', path: image.path, description: image.description, tags: image.tags, subjects: image.subjects } as never
      },
    }),
  ]
}

function namesOf(state: { characters: { name: string }[]; places: { name: string }[]; things: { name: string }[] }): { kind: 'character' | 'location' | 'item'; name: string }[] {
  return [
    ...state.characters.map(entry => ({ kind: 'character' as const, name: entry.name })),
    ...state.places.map(entry => ({ kind: 'location' as const, name: entry.name })),
    ...state.things.map(entry => ({ kind: 'item' as const, name: entry.name })),
  ]
}
