import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { areaOf, importsOf } from './imports.ts'

const src = fileURLToPath(new URL('../../src', import.meta.url))
const edges = importsOf(src)

const offenders = (found: typeof edges): string[] => found.map(edge => `${edge.from} imports ${edge.specifier}`)
const outsideNode = (edge: (typeof edges)[number]): boolean => edge.specifier.startsWith('node:')

/** What the browser half may load from the shell and from the page's own libraries; the build refuses the rest at run time, this refuses it earlier. */
const SHELL = /^(@deepseek-ai\/(cordis|dsh-client-[a-z-]+)(\/client)?|react|react\/jsx-runtime|react-dom|react-dom\/client)$/

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

  it('has the browser half reach the host through its HTTP API only: no host code, no Node, no state package, only what the shell provides', () => {
    const client = edges.filter(edge => areaOf(edge.from) === 'client')
    expect(offenders(client.filter(edge => edge.relative && areaOf(edge.target) === 'host'))).toEqual([])
    expect(offenders(client.filter(outsideNode))).toEqual([])
    const outside = client.filter(edge => !edge.relative && edge.specifier !== 'dsh-roleplay-model' && edge.specifier !== '@dsh-ai-providers/core' && !SHELL.test(edge.specifier))
    expect(offenders(outside)).toEqual([])
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
    'host/agent/agent-sessions.ts', 'host/authoring/documents.ts', 'host/catalogue/install.ts',
    'host/images/gallery.ts', 'host/images/image-files.ts', 'host/images/image-vectors.ts', 'host/images/library.ts', 'host/images/presented.ts', 'host/images/storage.ts',
    'host/import/store.ts', 'host/sync/service.ts', 'host/sync/state.ts',
  ])

  it('goes through atomicWrite in every file that is not on the list of those not moved yet', () => {
    const found = sources(src).map(file => relative(src, file)).filter((file) => {
      if (file === 'host/atomic-write.ts') return false
      const text = readFileSync(join(src, file), 'utf8')
      return /\brename(Sync)?\(/.test(text) && /randomUUID|process\.pid/.test(text)
    })
    expect(found.filter(file => !STILL_HAND_WRITTEN.has(file))).toEqual([])
    expect([...STILL_HAND_WRITTEN].filter(file => !found.includes(file))).toEqual([])
  })
})
