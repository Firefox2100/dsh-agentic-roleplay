import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface ImportEdge {
  /** The file that imports, relative to the source root. */
  from: string
  /** The specifier as written. */
  specifier: string
  /** For a relative specifier, the module it names relative to the source root; otherwise the specifier. */
  target: string
  relative: boolean
}

const SPECIFIER = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

function sourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

/** Every import and re-export of the sources under a folder. */
export function importsOf(root: string): ImportEdge[] {
  return sourceFiles(root).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return [...text.matchAll(SPECIFIER)].map((match): ImportEdge => {
      const specifier = (match[1] ?? match[2] ?? match[3])!
      const isRelative = specifier.startsWith('.')
      return { from: relative(root, file), specifier, target: isRelative ? relative(root, resolve(dirname(file), specifier)) : specifier, relative: isRelative }
    })
  })
}

/** The top-level folder or file a path in the source root belongs to. */
export const areaOf = (path: string): string => path.split('/')[0]!.replace(/\.(ts|tsx)$/, '')
