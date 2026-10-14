import { join, relative } from 'node:path'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PACKS_FOLDER, PACK_ACTIONS, PACK_API, PACK_LIMITS, SURFACE_NAMES } from '../../shared/interface-pack.ts'
import { checkWorldPack, deleteWorldPackFile, listWorldPacks } from '../interface/world-packs.ts'
import type { AuthoredWorldReader } from './read-tools.ts'

export const PACK_MUTATION_TOOLS = ['delete_world_pack_file'] as const

const output = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const jsonOutput = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => output(value) }
/** A path as the file tools take it: relative to the chat's folder when it has one, which is short and hard to mistype. */
function relativeTo(exec: { agent?: { session: { header: { cwd?: string } } } }, path: string): string {
  const cwd = exec.agent?.session.header.cwd
  return cwd === undefined ? path : relative(cwd, path)
}

const packParameter = { type: 'string' as const, required: true as const, description: 'The pack name (its folder under ui/), such as atlas.' }
const pathParameter = { type: 'string' as const, required: true as const, description: 'A path inside the pack with "/", such as pack.json or img/map.svg.' }

/** What an assistant needs to write a pack; the same facts the author docs give a person. */
export const PACK_GUIDE = `Write and read the files of a pack with the file tools write, edit and read, at the path <world folder>/ui/<pack>/<file>. Use the short relative path given with this guide (such as my-world/ui/atlas/pack.json), not the long absolute one, which is easy to mistype; in this chat they reach nothing else, only text files, and every change asks the person first. Delete a file with delete_world_pack_file.

An interface pack changes how a story looks and adds small pieces of interface. It is a folder ui/<pack>/ of the world with a pack.json and the files it names. Sessions started from the world copy it; a pack with problems stops the session from starting, so check it with check_world_pack after writing.

pack.json (api ${PACK_API}): { "name", "version", "description", "api": ${PACK_API}, "theme": { "--dsw-alias-<token>": { "light": "#...", "dark": "#..." } }, "skin": "skin.css", "actions": [${PACK_ACTIONS.map(action => `"${action}"`).join(', ')}], "surfaces": { "hud": { "file": "hud.html", "height": 48 }, "tab": { "file": "map.html", "title": "Map" } } }. Surfaces: ${SURFACE_NAMES.join(', ')} (hud is a strip above the input box and its controls, dock a strip just above the input box for buttons, opening a card shown only until the first turn is played, backdrop a layer behind the story's text that takes no clicks, tab a page beside Chat; the strips hud, dock and opening ask for their height with rp.resize). actions lists what the pages may do for the player: say (send words as the player), fill (put words in the input box), choose (take a suggested action as the input); leave out what is not needed.

skin.css restyles the story's own elements and nothing else: every part of every selector must name one with [data-rp="..."], and url() may point only to files of the pack. Elements: narration (a turn), prose (a narration paragraph), utterance (a spoken line) with avatar, speaker and words inside, ooc, suggestions and suggestion, turns, and the frames hud, dock, opening and backdrop. Only style rules, @media, @supports, @keyframes and @font-face are allowed; no @import, nesting or escapes outside strings.

A surface is an HTML file with its own css and js files beside it (relative addresses). It runs in a sandbox: no network, cookies, storage or access to the page. The page gives it an rp object: rp.state() (a promise of the player view: use await or .then) and rp.watch(fn) (calls fn(view) at once and after every change; the usual way to draw a surface). The view is story {name, turn}, player {key, name, summary, publicState}, place {key, name, description, features, exits [{name, open}], items [{name, quantity}], here [{key, name, publicState}]}, time {iso, zone, text}, carried [{name, quantity, where}], variables [{subject, name, value}], map {places [{key, name, parent?, here}], routes [{from, to}]}, suggestions []), rp.on('turn' | 'suggestions' | 'theme', fn), rp.say(text), rp.fill(text), rp.choose(index), rp.history(n) (the last turns as the story stands: {turn, player, segments [{type, name?, text}], note?}), rp.storage.get/set/remove (JSON, 64 KB), rp.resize(height) (24 to 320; the opening card 120 to 640), rp.theme(). The frame has the DSH colours as CSS variables such as var(--dsw-alias-label-primary), var(--dsw-alias-bg-layer-1), var(--dsw-alias-border-l3), var(--dsw-alias-brand-primary); use them so the page fits light and dark.

Limits: ${PACK_LIMITS.files} files, ${PACK_LIMITS.bytes / 1024 / 1024} MB, ${PACK_LIMITS.fileBytes / 1024} KB per file, ${PACK_LIMITS.depth} folders deep; names use letters, digits, "-", "_" and "."; only text files (html, css, js, json, txt, svg) can be written; pictures and fonts are added by hand.`

/**
 * Read, write and check the interface packs a world carries. The files are the ones session start copies,
 * so they are checked as it checks them.
 */
export function worldPackTools(reader: AuthoredWorldReader): ToolDefinition[] {
  return [
    defineTool({
      name: 'world_pack_guide',
      description: 'How to write an interface pack: where its files go (the folder is returned with the guide), the manifest, the skin, the surfaces, the rp object a surface gets, what it is told, and the limits. Read it before writing a pack.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { record } = await reader.read(exec)
        return { folder: join(record.directory, PACKS_FOLDER), relative: relativeTo(exec, join(record.directory, PACKS_FOLDER)), guide: PACK_GUIDE } as never
      },
    }),
    defineTool({
      name: 'list_world_packs',
      description: 'List the interface packs the world carries, their files and what is wrong with each. Each pack has a path: the folder its files go in, as the file tools take it.',
      parameters: {},
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { record } = await reader.read(exec)
        return listWorldPacks(record.directory).map(entry => ({ ...entry, path: relativeTo(exec, join(record.directory, PACKS_FOLDER, entry.id)) })) as never
      },
    }),
    defineTool({
      name: 'check_world_pack',
      description: 'Check a pack of this world as session start will: the manifest, the theme, the skin, the surfaces and every file. An empty list of problems means it can be used.',
      parameters: { pack: packParameter },
      output: jsonOutput,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        return { pack: args.pack, problems: checkWorldPack(record.directory, args.pack) } as never
      },
    }),
    defineTool({
      name: 'delete_world_pack_file',
      description: 'Remove a file of a pack of this world; it is moved into the world\'s .trash directory. Requires user approval.',
      parameters: { pack: packParameter, path: pathParameter },
      output: jsonOutput,
      async execute(args, exec) {
        const { record } = await reader.read(exec)
        const { trashPath, problems } = await deleteWorldPackFile(record.directory, args.pack, args.path)
        return { action: 'deleted', pack: args.pack, path: args.path, trashPath, problems } as never
      },
    }),
  ]
}
