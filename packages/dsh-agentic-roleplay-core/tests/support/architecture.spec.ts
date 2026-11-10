import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { areaOf, importsOf, portable } from './imports.ts'

const src = fileURLToPath(new URL('../../src', import.meta.url))
const edges = importsOf(src)

const offenders = (found: typeof edges): string[] => found.map(edge => `${edge.from} imports ${edge.specifier}`)
const outsideNode = (edge: (typeof edges)[number]): boolean => edge.specifier.startsWith('node:')

/** The shell's modules the browser half may load at run time; types from other client packages are erased by the build and stay allowed. */
const RUNTIME_SHELL = new Set(['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])
/** Packages the browser half carries in its own bundle: the model, and the AI providers package whose route names and option types it shares. */
const BUNDLED = new Set(['dsh-roleplay-model', '@dsh-ai-providers/core'])

describe('how the bundle is layered', () => {
  it('looks at the sources it is about', () => {
    expect(edges.length).toBeGreaterThan(1000)
    expect(edges.some(edge => areaOf(edge.from) === 'client')).toBe(true)
    expect(edges.some(edge => areaOf(edge.from) === 'host')).toBe(true)
  })

  it('has the code both halves use know neither half: it imports only itself and the model, and nothing of Node', () => {
    const shared = edges.filter(edge => areaOf(edge.from) === 'shared')
    expect(offenders(shared.filter(edge => edge.relative && areaOf(edge.target) !== 'shared'))).toEqual([])
    expect(offenders(shared.filter(edge => !edge.relative && edge.specifier !== 'dsh-roleplay-model'))).toEqual([])
  })

  it('has the browser half reach the host through its HTTP API only: no host code, no Node, no state package, and at run time only the modules the shell hands it', () => {
    const client = edges.filter(edge => areaOf(edge.from) === 'client')
    expect(offenders(client.filter(edge => edge.relative && areaOf(edge.target) === 'host'))).toEqual([])
    expect(offenders(client.filter(outsideNode))).toEqual([])
    const outside = client.filter(edge => !edge.relative && !edge.typeOnly && !RUNTIME_SHELL.has(edge.specifier) && !BUNDLED.has(edge.specifier))
    expect(offenders(outside)).toEqual([])
    // a Harness client package is not a module the plugin may load (its own copy of a control or a store stands in); naming its types is fine
    const loaded = client.filter(edge => !edge.typeOnly && /^@deepseek-ai\/dsh-client-/.test(edge.specifier) && !RUNTIME_SHELL.has(edge.specifier))
    expect(offenders(loaded)).toEqual([])
  })

  it('has the host know nothing of the browser half', () => {
    const host = edges.filter(edge => areaOf(edge.from) !== 'client')
    expect(offenders(host.filter(edge => edge.relative && areaOf(edge.target) === 'client' && areaOf(edge.from) !== 'index'))).toEqual([])
    expect(offenders(host.filter(edge => !edge.relative && (edge.specifier === 'react' || edge.specifier.startsWith('react/') || edge.specifier.startsWith('react-dom') || edge.specifier.startsWith('@deepseek-ai/dsh-client-'))))).toEqual([])
  })

  it('uses DSH and the other packages only by what they export at the root', () => {
    const deep = edges.filter(edge => !edge.relative && /^@[^/]+\/[^/]+\/./.test(edge.specifier) && !/^@deepseek-ai\/dsh-client-[a-z-]+\/client$/.test(edge.specifier))
    expect(offenders(deep)).toEqual([])
  })
})

describe('how files are replaced', () => {
  const sources = (directory: string): string[] => readdirSync(directory).flatMap(name => (statSync(join(directory, name)).isDirectory() ? sources(join(directory, name)) : name.endsWith('.ts') ? [join(directory, name)] : []))

  // files that still keep a hand-written temporary-file-and-rename (or rename a whole folder, as the trash moves in `authoring/documents.ts` do); the list only shrinks: a new writer uses `atomicWrite` (host/atomic-write.ts)
  const STILL_HAND_WRITTEN = new Set([
    'host/authoring/documents.ts', 'host/catalogue/install.ts',
    'host/images/storage.ts', 'host/import/store.ts', 'host/sync/service.ts',
  ])

  it('goes through atomicWrite in every file that is not on the list of those not moved yet', () => {
    const found = sources(src).map(file => portable(relative(src, file))).filter((file) => {
      if (file === 'host/atomic-write.ts') return false
      const text = readFileSync(join(src, file), 'utf8')
      // the file system's rename (imported from node:fs), not a method that a DSH service happens to call rename
      const fileRename = /import\s*(?:type\s*)?\{[^}]*\brename(?:Sync)?\b[^}]*\}\s*from\s*'node:fs(?:\/promises)?'/.test(text) && /(?<![.\w])rename(?:Sync)?\(/.test(text)
      return fileRename && /randomUUID|process\.pid/.test(text)
    })
    expect(found.filter(file => !STILL_HAND_WRITTEN.has(file))).toEqual([])
    expect([...STILL_HAND_WRITTEN].filter(file => !found.includes(file))).toEqual([])
  })
})
