import type { Files } from '../language.ts'
import type { Layer } from './types.ts'

export class ComposeError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** RFC 7386: an object merges into the target, `null` removes a key, anything else (arrays included) replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return structuredClone(patch)
  const result: Record<string, unknown> = isObject(target) ? structuredClone(target) : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key]
    else result[key] = mergePatch(result[key], value)
  }
  return result
}

/** The files of a bare world with the layers applied in the order given: each layer removes, then adds, then patches. The bare world is not changed. */
export function compose(base: Files, layers: readonly Layer[]): Files {
  const files: Files = new Map([...base].map(([path, value]) => [path, structuredClone(value)]))
  for (const layer of layers) {
    for (const path of layer.remove) {
      const matched = [...files.keys()].filter(key => key === path || key.startsWith(`${path}/`))
      if (matched.length === 0) throw new ComposeError(`layer ${layer.id} removes ${path}, which the world does not have`)
      for (const key of matched) files.delete(key)
    }
    for (const [path, value] of Object.entries(layer.add)) files.set(path, structuredClone(value))
    for (const [path, patch] of Object.entries(layer.patch)) {
      if (!files.has(path)) throw new ComposeError(`layer ${layer.id} patches ${path}, which the world does not have`)
      files.set(path, mergePatch(files.get(path), patch))
    }
  }
  return files
}
