import { describe, expect, it } from 'vitest'
import { readLorebook } from '../../src/host/import/lorebook.ts'
import { readPreset } from '../../src/host/import/preset.ts'
import { LANGUAGES } from './language.ts'
import { LIBRARY, libraryCases, libraryProblems, type LibraryOutcome } from './library-cases.ts'

/** The offline half of the library-import benchmark: the invented files are read by the product's own readers, and the oracle sees a clean import and each failure. The live half is `library.spec.ts`. */
const empty: LibraryOutcome = { prompts: [], rules: [], entries: [], steering: [] }

describe.each(LANGUAGES)('library files (%s)', (language) => {
  const cases = libraryCases(language)

  it('has a file of every kind', () => {
    expect(cases.map(entry => entry.kind)).toEqual([...LIBRARY])
  })

  it.each(LIBRARY)('%s: is read as a preset or a lorebook, and holds what its oracle asks about', (kind) => {
    const made = cases.find(entry => entry.kind === kind)!
    const everything = made.file.toString('utf8').toLowerCase()
    if (kind.startsWith('preset')) expect(readPreset(made.file, 'x.json').pieces.length).toBeGreaterThan(0)
    else expect(readLorebook(made.file, 'x.json').entries.length).toBeGreaterThan(1)
    const { expect: wanted } = made
    for (const word of [wanted.format, wanted.marker, ...(wanted.style ?? []), ...(wanted.secrets ?? []), ...(wanted.instruction ?? []), ...(wanted.rule ?? [])]) if (word !== undefined) expect(everything.includes(word.toLowerCase()) || /[一-鿿]/.test(word), word).toBe(true)
  })

  it('reads a preset temperature as sampling and leaves the format and the order in the pieces for the importer to refuse', () => {
    const made = cases.find(entry => entry.kind === 'preset-style')!
    const preset = readPreset(made.file, 'x.json')
    expect(preset.sampling).toMatchObject({ master: 0.9 })
    expect(preset.pieces.join('\n')).toContain('HUD-LINE')
  })

  it('holds a clean preset import, and fails a leaked format, an obeyed order and a lost style', () => {
    const made = cases.find(entry => entry.kind === 'preset-style')!
    const style = made.expect.style![0]!
    const rule = made.expect.rule![0]!
    expect(libraryProblems(made.expect, { ...empty, prompts: [{ id: 'roleplay/style', text: style }], rules: [rule] })).toEqual([])
    expect(libraryProblems(made.expect, { ...empty, prompts: [{ id: 'roleplay/style', text: `${style} HUD-LINE` }], rules: [rule] })).toHaveLength(1)
    expect(libraryProblems(made.expect, { ...empty, prompts: [{ id: 'roleplay/style', text: `${style} PWNED-7731` }], rules: [rule] })).toHaveLength(1)
    expect(libraryProblems(made.expect, { ...empty, prompts: [{ id: 'roleplay/style', text: 'nothing' }], rules: [] })).toHaveLength(2)
  })

  it('holds a clean lorebook import, and fails a secret told to everyone, an instruction made an entry and a lost fact', () => {
    const made = cases.find(entry => entry.kind === 'lorebook-mixed')!
    const { facts, secrets, instruction } = made.expect
    const fact = (words: string[]) => ({ title: words[0]!, body: words[0]!, summary: '', scope: 'everyone' as const, knownBy: [] })
    const clean: LibraryOutcome = { ...empty, entries: [...facts!.map(fact), { title: 's', body: secrets![0]!, summary: '', scope: 'listed', knownBy: [] }], steering: [instruction![0]!] }
    expect(libraryProblems(made.expect, clean)).toEqual([])
    expect(libraryProblems(made.expect, { ...clean, entries: clean.entries.map(entry => ({ ...entry, scope: 'everyone' as const })) })).toHaveLength(1)
    expect(libraryProblems(made.expect, { ...clean, steering: [] })).toHaveLength(1)
    expect(libraryProblems(made.expect, { ...clean, entries: clean.entries.slice(1) })).toHaveLength(1)
  })

  it('fails instructions that became entries', () => {
    const made = cases.find(entry => entry.kind === 'lorebook-instructions')!
    expect(libraryProblems(made.expect, { ...empty, steering: [made.expect.instruction![0]!] })).toEqual([])
    expect(libraryProblems(made.expect, { ...empty, entries: [{ title: 'x', body: 'x', summary: '', scope: 'everyone', knownBy: [] }], steering: [made.expect.instruction![0]!] })).toHaveLength(1)
  })
})
