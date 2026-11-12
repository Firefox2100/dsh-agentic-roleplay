import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkOpeningSpeakers } from '../../../src/host/authoring/opening-speakers.ts'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'speakers-'))
  await mkdir(join(directory, 'characters', 'miller'), { recursive: true })
  await writeFile(join(directory, 'characters', 'miller', 'character.json'), JSON.stringify({ name: 'Hale the Miller', role: 'npc', summary: 'Runs the mill.' }))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('the speakers of an opening an edit writes', () => {
  it('must be characters of the world, and the refusal lists the ids there are', async () => {
    await expect(checkOpeningSpeakers(directory, { openingParts: [{ type: 'utterance', character: 'hale', text: 'Late.' }] })).rejects.toThrow(/"hale" is not a character of this world; the characters are miller \(Hale the Miller\)/)
    await expect(checkOpeningSpeakers(directory, { alternateOpenings: [{ title: 'A', text: 'x', parts: [{ type: 'utterance', character: 'nobody', text: 'x' }] }] })).rejects.toThrow(/alternateOpenings\[0\]\.parts/)
  })

  it('pass when every speaker is a character, and for plain text', async () => {
    await expect(checkOpeningSpeakers(directory, { openingParts: [{ type: 'narration', text: 'Fog.' }, { type: 'utterance', character: 'miller', text: 'Late.' }] })).resolves.toBeUndefined()
    await expect(checkOpeningSpeakers(directory, { opening: 'Fog.' })).resolves.toBeUndefined()
  })
})
