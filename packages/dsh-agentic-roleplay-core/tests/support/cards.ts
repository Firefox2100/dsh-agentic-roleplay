import { crc32, deflateSync } from 'node:zlib'

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** A one-pixel picture. */
const PIXEL = deflateSync(Buffer.from([0, 255, 0, 0]))

/** A PNG made up for a test, with text chunks of the given keywords holding the base64 of the given JSON. */
export function pngWithCard(cards: Record<string, unknown>, extra: Buffer[] = []): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const texts = Object.entries(cards).map(([keyword, card]) => chunk('tEXt', Buffer.concat([Buffer.from(`${keyword}\0`, 'latin1'), Buffer.from(Buffer.from(JSON.stringify(card)).toString('base64'), 'latin1')])))
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), ...texts, ...extra, chunk('IDAT', PIXEL), chunk('IEND', Buffer.alloc(0))])
}

/** A card made up for a test: invented people and places only. */
export function v3Card(data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Test Harbour', description: 'A fishing town where a lighthouse keeper keeps a ledger.', personality: '', scenario: 'Autumn in the town.', first_mes: 'The fog lifts from the pier.',
      mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: ['harbour'], creator: '', character_version: '', alternate_greetings: ['A second morning.'],
      extensions: {}, character_book: { name: 'Harbour book', entries: [{ id: 0, keys: ['Old Tam'], comment: 'Old Tam', content: 'Old Tam keeps the lighthouse.', enabled: true, constant: false, selective: false, position: 'before_char', insertion_order: 100 }] },
      ...data,
    },
  }
}

export const chunkOf = chunk
