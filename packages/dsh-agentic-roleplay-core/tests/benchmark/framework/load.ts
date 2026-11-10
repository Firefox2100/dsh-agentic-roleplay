import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Files, Language } from '../language.ts'
import { LANGUAGES } from '../language.ts'
import type { BaseWorld, BenchData, Exclusion, Layer, Row, Script, WorldMeta } from './types.ts'

/** Where the data is, unless a test brings its own. */
export const DATA_ROOT = join(import.meta.dirname, '..', 'data')

const json = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T

function filesIn(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesIn(path) : [path]
  })
}

/** The files of a world folder by path: `.json` files as values, everything else as text. */
export function readWorldFiles(directory: string): Files {
  const files: Files = new Map()
  for (const path of filesIn(directory)) {
    const name = relative(directory, path).split('\\').join('/')
    files.set(name, name.endsWith('.json') ? json(path) : readFileSync(path, 'utf8'))
  }
  return files
}

const layerOf = (value: Partial<Layer> & { id: string }): Layer => ({ description: '', requires: [], conflicts: [], fits: [], add: {}, patch: {}, remove: [], ...value })

function readLayers(directory: string): Record<string, Layer> {
  if (!existsSync(directory)) return {}
  return Object.fromEntries(readdirSync(directory).filter(name => name.endsWith('.json')).sort().map((name) => {
    const layer = layerOf(json<Partial<Layer> & { id: string }>(join(directory, name)))
    return [layer.id, layer]
  }))
}

/** Reads every world, shared layer, row and exclusion under `root`. The data is not checked here: `validateData` does that. */
export function loadData(root: string = DATA_ROOT): BenchData {
  const worlds: Record<string, BaseWorld> = {}
  const worldsRoot = join(root, 'worlds')
  for (const id of existsSync(worldsRoot) ? readdirSync(worldsRoot).sort() : []) {
    const directory = join(worldsRoot, id)
    if (!statSync(directory).isDirectory()) continue
    const meta = json<WorldMeta>(join(directory, 'bench.json'))
    const world: BaseWorld = { meta, files: {}, layers: {} }
    for (const language of LANGUAGES) {
      if (existsSync(join(directory, language, 'world'))) world.files[language] = readWorldFiles(join(directory, language, 'world'))
      world.layers[language] = readLayers(join(directory, language, 'layers'))
    }
    worlds[id] = world
  }
  const sharedLayers: BenchData['sharedLayers'] = {}
  for (const language of LANGUAGES) sharedLayers[language] = readLayers(join(root, 'layers', language))
  const rowsRoot = join(root, 'rows')
  const rows = existsSync(rowsRoot) ? readdirSync(rowsRoot).filter(name => name.endsWith('.json')).sort().flatMap(name => json<Row | Row[]>(join(rowsRoot, name))) : []
  const excluded = existsSync(join(root, 'excluded.json')) ? json<Exclusion[]>(join(root, 'excluded.json')) : []
  const scriptsRoot = join(root, 'scripts')
  const scripts = existsSync(scriptsRoot) ? readdirSync(scriptsRoot).filter(name => name.endsWith('.json')).sort().map(name => json<Script>(join(scriptsRoot, name))) : []
  return { worlds, sharedLayers, rows, excluded, scripts }
}

/** The layers a world offers in a language: its own, over the shared ones. */
export function layersOf(data: BenchData, world: string, language: Language): Record<string, Layer> {
  return { ...data.sharedLayers[language], ...data.worlds[world]?.layers[language] }
}
