import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { areaOf, importsOf } from './support-imports.ts'

const src = fileURLToPath(new URL('../src', import.meta.url))
const model = fileURLToPath(new URL('../../dsh-roleplay-model/src', import.meta.url))
const edges = importsOf(src)

const offenders = (found: typeof edges): string[] => found.map(edge => `${edge.from} imports ${edge.specifier}`)

describe('how the state package is layered', () => {
  it('looks at the sources it is about', () => {
    expect(edges.length).toBeGreaterThan(200)
    expect(edges.some(edge => edge.specifier === 'node:sqlite' && edge.from === 'driver/node-sqlite.ts')).toBe(true)
  })

  it('reaches SQLite through the driver alone', () => {
    expect(offenders(edges.filter(edge => edge.specifier === 'node:sqlite' && edge.from !== 'driver/node-sqlite.ts'))).toEqual([])
  })

  it('has the implementation of the repositories know nothing of what uses them', () => {
    const users = new Set(['records', 'tools', 'plugin', 'store', 'sessions', 'index'])
    expect(offenders(edges.filter(edge => areaOf(edge.from) === 'sqlite' && edge.relative && users.has(areaOf(edge.target))))).toEqual([])
  })

  it('keeps SQL out of what the models see: the tools, the records and the memory use the repositories, never the driver', () => {
    expect(offenders(edges.filter(edge => ['tools', 'records', 'memory'].includes(areaOf(edge.from)) && edge.relative && areaOf(edge.target) === 'driver'))).toEqual([])
    expect(offenders(edges.filter(edge => areaOf(edge.from) === 'tools' && edge.relative && areaOf(edge.target) === 'sqlite'))).toEqual([])
  })

  it('has the contracts, the clock and the errors depend on no implementation', () => {
    expect(offenders(edges.filter(edge => ['repositories', 'clock', 'errors'].includes(areaOf(edge.from)) && edge.relative && ['sqlite', 'driver', 'store', 'plugin'].includes(areaOf(edge.target))))).toEqual([])
  })

  it('uses the host and its packages only by what they export at the root', () => {
    expect(offenders(edges.filter(edge => /^@deepseek-ai\/[^/]+\/./.test(edge.specifier)))).toEqual([])
  })
})

describe('how the model package is kept', () => {
  const own = importsOf(model)

  it('is plain data and types: it imports nothing but itself, so that it can be bundled into whatever uses it', () => {
    expect(offenders(own.filter(edge => !edge.relative))).toEqual([])
  })
})
