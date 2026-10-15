import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { firstPartyDirectory, installFirstPartyPacks } from '../../../src/host/interface/first-party.ts'
import { readPack } from '../../../src/host/interface/pack.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'first-party-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('the interface packs that ship with the package', () => {
  it('are all usable: nothing wrong with any of them, and a surface for each place they claim', () => {
    const shipped = readdirSync(firstPartyDirectory(), { withFileTypes: true }).filter(entry => entry.isDirectory())
    expect(shipped.map(entry => entry.name)).toContain('scene')
    for (const entry of shipped) {
      const { pack, problems } = readPack(join(firstPartyDirectory(), entry.name), entry.name, file => file)
      expect(problems, entry.name).toEqual([])
      expect(Object.keys(pack!.manifest.surfaces).length, entry.name).toBeGreaterThan(0)
    }
  })

  it('go into the root\'s own ui folder, and an edited one is left alone while a deleted one comes back', () => {
    expect(installFirstPartyPacks(root)).toContain('scene')
    expect(existsSync(join(root, 'ui', 'scene', 'pack.json'))).toBe(true)
    writeFileSync(join(root, 'ui', 'scene', 'style.css'), '/* mine */')
    expect(installFirstPartyPacks(root)).toEqual([])
    expect(readFileSync(join(root, 'ui', 'scene', 'style.css'), 'utf8')).toBe('/* mine */')
    rmSync(join(root, 'ui', 'scene'), { recursive: true })
    expect(installFirstPartyPacks(root)).toContain('scene')
    expect(readFileSync(join(root, 'ui', 'scene', 'style.css'), 'utf8')).not.toBe('/* mine */')
  })
})
