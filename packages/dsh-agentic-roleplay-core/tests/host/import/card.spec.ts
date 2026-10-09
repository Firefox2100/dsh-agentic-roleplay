import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ImportCardError, isPng, pictureOf, readCard } from '../../../src/host/import/card.ts'
import { chunkOf, pngWithCard, v3Card } from '../../support/cards.ts'

describe('reading a character card', () => {
  it('reads a V3 card from a PNG, with its lorebook entries named by their position, and carries the card over as it is', () => {
    const card = readCard(pngWithCard({ ccv3: v3Card() }), 'harbour.png')
    expect(card).toMatchObject({ sourceSpec: 'chara_card_v3', name: 'Test Harbour', scenario: 'Autumn in the town.', firstMessage: 'The fog lifts from the pier.', alternateGreetings: ['A second morning.'], tags: ['harbour'] })
    expect(card.book?.entries).toEqual([{ id: 'entry:0', title: 'Old Tam', keys: ['Old Tam'], secondaryKeys: [], content: 'Old Tam keeps the lighthouse.', enabled: true, constant: false, selective: false, position: 'before_char' }])
  })

  it('prefers the newer chunk over the legacy copy, and reads the legacy one when it is alone', () => {
    expect(readCard(pngWithCard({ chara: v3Card({ name: 'Old copy' }), ccv3: v3Card({ name: 'New copy' }) }), 'x.png').name).toBe('New copy')
    expect(readCard(pngWithCard({ chara: v3Card({ name: 'Only copy' }) }), 'x.png').name).toBe('Only copy')
  })

  it('carries a V2 card over into the same shape, and says which it was', () => {
    const v2 = { ...v3Card(), spec: 'chara_card_v2', spec_version: '2.0' }
    expect(readCard(Buffer.from(JSON.stringify(v2)), 'card.json')).toMatchObject({ sourceSpec: 'chara_card_v2', name: 'Test Harbour', book: { entries: [{ id: 'entry:0' }] } })
  })

  it('reads a compressed text chunk and a JSON file with a byte order mark', () => {
    const compressed = chunkOf('zTXt', Buffer.concat([Buffer.from('chara\0\0', 'latin1'), deflateSync(Buffer.from(Buffer.from(JSON.stringify(v3Card({ name: 'Packed' }))).toString('base64')))]))
    expect(readCard(pngWithCard({}, [compressed]), 'x.png').name).toBe('Packed')
    expect(readCard(Buffer.from(`﻿${JSON.stringify(v3Card())}`), 'x.json').name).toBe('Test Harbour')
  })

  it('counts the scripts and settings of the tool that made the card instead of keeping them, and takes the title of an entry from its comment or its name', () => {
    const card = readCard(Buffer.from(JSON.stringify(v3Card({
      extensions: { regex_scripts: [{}, {}], tavern_helper: { scripts: [{}] }, talkativeness: '0.5', other_tool: { x: 1 } },
      character_book: { entries: [{ comment: '', name: 'By name', content: 'a', keys: [] }, { comment: 'By comment', name: 'ignored', content: 'b', keys: [], enabled: false, constant: true, position: 4 }, 'not an entry'] },
    }))), 'x.json')
    expect(card.ignored).toEqual({ scripts: 3, extensions: ['regex_scripts', 'tavern_helper', 'other_tool'] })
    expect(card.book?.entries.map(entry => [entry.id, entry.title, entry.enabled, entry.constant, entry.position])).toEqual([['entry:0', 'By name', true, false, ''], ['entry:1', 'By comment', false, true, '4']])
  })

  it('refuses what is not a V2 or V3 card, with the reason', () => {
    const refusal = (file: Buffer): string => { try { readCard(file, 'x'); return '' } catch (error) { if (error instanceof ImportCardError) return error.message; throw error } }
    expect(refusal(Buffer.from('not json'))).toMatch(/neither a PNG/)
    expect(refusal(pngWithCard({ other: v3Card() }))).toMatch(/no character card in it/)
    expect(refusal(Buffer.from(JSON.stringify({ name: 'flat card', description: 'V1' })))).toMatch(/no "spec"/)
    expect(refusal(Buffer.from(JSON.stringify({ spec: 'chara_card_v9', data: {} })))).toMatch(/only V2 and V3/)
    expect(refusal(Buffer.from(JSON.stringify({ spec: 'chara_card_v3' })))).toMatch(/no card data/)
    expect(refusal(Buffer.from(JSON.stringify(v3Card({ name: '  ' }))))).toMatch(/no name/)
    expect(refusal(pngWithCard({ chara: v3Card() }).subarray(0, 60))).toMatch(/cut off/)
    expect(refusal(Buffer.concat([pngWithCard({}).subarray(0, 33), chunkOf('tEXt', Buffer.from('chara\0!!!not base64 json', 'latin1'))]))).toMatch(/not readable/)
  })

  it('keeps the picture of a PNG card without the card in it', () => {
    const png = pngWithCard({ ccv3: v3Card(), chara: v3Card() })
    const picture = pictureOf(png)
    expect(isPng(picture)).toBe(true)
    expect(picture.length).toBeLessThan(png.length)
    expect(picture.includes(Buffer.from('ccv3'))).toBe(false)
    expect(picture.includes(Buffer.from('IDAT'))).toBe(true)
    expect(() => readCard(picture, 'x.png')).toThrow(/no character card in it/)
    expect(isPng(Buffer.from('{}'))).toBe(false)
  })
})
