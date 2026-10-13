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
