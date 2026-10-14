import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { packFile, readPack } from '../../../src/host/interface/pack.ts'

let directory: string
const address = (path: string): string => `/file/${path}`
const write = (path: string, text: string): void => { mkdirSync(join(directory, path, '..'), { recursive: true }); writeFileSync(join(directory, path), text) }
const manifest = (extra: Record<string, unknown> = {}): void => write('pack.json', JSON.stringify({ name: 'Gothic', version: '1.0', actions: ['say'], surfaces: { hud: { file: 'hud.html', height: 64 } }, ...extra }))
const read = (id = 'gothic') => readPack(directory, id, address)
const reasons = (): string[] => read().problems.map(problem => `${problem.file}: ${problem.message}`)

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'pack-')); write('hud.html', '<p>hi</p>') })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('reading a pack', () => {
  it('reads the manifest, the theme, the skin and the surfaces', () => {
    manifest({ theme: { '--dsw-alias-bg-base': { light: '#fff', dark: '#000' } }, skin: 'skin.css', surfaces: { hud: { file: 'hud.html', height: 64 }, tab: { file: 'map/map.html', title: 'Map' } } })
    write('skin.css', '[data-rp="utterance"] { background: url(paper.png) }')
    write('paper.png', 'x'); write('map/map.html', '<p>map</p>')
    const { pack, problems } = read()
    expect(problems).toEqual([])
    expect(pack?.manifest).toMatchObject({ id: 'gothic', name: 'Gothic', actions: ['say'], skin: 'skin.css', surfaces: { hud: { file: 'hud.html', height: 64 }, tab: { file: 'map/map.html', title: 'Map' } } })
    expect(pack?.skin).toContain('url("/file/paper.png")')
    expect(pack?.revision).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes its revision when a file changes', () => {
    manifest()
    const before = read().pack?.revision
    write('hud.html', '<p>a longer page</p>')
    expect(read().pack?.revision).not.toBe(before)
  })

  it('needs a pack.json', () => {
    expect(reasons()).toEqual(['pack.json: the pack has no pack.json'])
  })

  it('reports every problem with its file', () => {
    manifest({ api: 2, actions: ['say', 'delete'], theme: { '--other': { light: 'red', dark: 'blue' }, '--dsw-alias-x': { light: 'url(a)', dark: 'red' } }, skin: 'none.css', surfaces: { hud: { file: 'missing.html' }, sidebar: { file: 'hud.html' } } })
    expect(reasons()).toEqual(expect.arrayContaining([
      'pack.json: api: this version knows only api 1, the pack asks for 2',
      'pack.json: actions: "delete" is not an action (say, fill, choose)',
      'pack.json: theme.--other: only tokens named --dsw-alias-... can be set',
      'pack.json: theme.--dsw-alias-x: values must be plain CSS colours',
      'pack.json: skin: the pack has no file "none.css"',
      'pack.json: surfaces.hud.file: the pack has no file "missing.html"',
      'pack.json: surfaces.sidebar: there is no such place (hud, dock, opening, backdrop, tab)',
    ]))
  })

  it('reports the problems of the skin with the skin file and line', () => {
    manifest({ skin: 'skin.css' })
    write('skin.css', 'body { color: red }')
    expect(reasons()).toEqual(['skin.css: line 1: "body": every part of a selector must name one of our elements with [data-rp="..."]'])
  })

  it('refuses files that are not allowed', () => {
    manifest()
    write('run.sh', 'x'); write('big.png', 'x'.repeat(1024 * 1024 + 1)); write('.hidden.png', 'x'); write('odd name.png', 'x')
    symlinkSync('/etc/hostname', join(directory, 'link.txt'))
    const found = reasons()
    expect(found).toEqual(expect.arrayContaining([
      expect.stringContaining('run.sh: this kind of file is not allowed'),
      'big.png: the file is larger than 1024 KB',
      '.hidden.png: names may not start with a dot',
      'odd name.png: the name may hold only letters, digits, "-", "_" and "."',
      'link.txt: symbolic links are not allowed',
    ]))
  })

  it('refuses a name that is not a pack name', () => {
    manifest()
    expect(readPack(directory, '../x', address).problems[0]?.message).toContain('not a usable pack name')
  })
})

describe('finding a file of a pack', () => {
  it('finds files the pack has and nothing outside it', () => {
    manifest(); write('img/a.png', 'x')
    const { pack } = read()
    expect(packFile(pack!, 'img/a.png')).toMatchObject({ file: join(directory, 'img', 'a.png'), mediaType: 'image/png' })
    for (const path of ['../pack.json', '/etc/passwd', 'img/../../x', 'img\\a.png', 'none.png', '', 'img']) expect(packFile(pack!, path), path).toBeUndefined()
  })
})
