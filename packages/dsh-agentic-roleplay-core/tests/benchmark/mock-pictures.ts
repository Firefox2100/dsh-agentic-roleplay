import { crc32, deflateSync } from 'node:zlib'
import type { ImportChoices, NormalizedCard } from '../../src/shared/import-card.ts'
import { urlsOf } from '../../src/host/import/card.ts'
import { pieceFinder } from '../../src/host/import/card-tools.ts'
import { addToLibraryOnce } from '../../src/host/images/library.ts'
import type { Language } from './language.ts'
import { pick } from './language.ts'

/** A solid-colour PNG, the stand-in for a picture: nothing in it is anyone's work, and two colours are two different pictures. */
export function solidPng(red: number, green: number, blue: number, size = 32): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const check = Buffer.alloc(4); check.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [red, green, blue]).flat())])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

/** One picture of the case: the address the card holds, the name it is saved under, its colour, and who the card's text makes it a picture of (the world's names). */
export interface MockPicture {
  url: string
  name: string
  color: [number, number, number]
  /** The characters the card text says are in the picture; `loose` says any of them, all of them or none is a fair answer. */
  characters: string[]
  loose?: boolean
  /** The pieces of the card that hold the address. */
  pieces: string[]
}

/** An invented card for the seed world of the authoring benchmark (Brindle Mill): each address sits in a piece of it that says who is in the picture, one says nothing of the kind, one is a group. */
export function pictureCard(language: Language): { card: NormalizedCard; choices: ImportChoices; pictures: MockPicture[] } {
  const p = pick(language)
  const miller = p('Hale the Miller', '老葛')
  const visitor = p('Visitor', '过客')
  const card: NormalizedCard = {
    sourceSpec: 'chara_card_v3', name: p('Brindle Mill', '溪磨坊'),
    description: p(`Brindle Mill stands on a small river. Hale the Miller is a broad man with a grey beard and flour in his eyebrows. His portrait: https://mock.invalid/art/miller.png`, `溪磨坊坐落在一条小河边。老葛是个身材宽厚的人，灰胡子，眉毛上沾着面粉。他的画像：https://mock.invalid/art/miller.png`),
    personality: '', scenario: p('On market days the yard fills with carts and sacks. A view of the yard: https://mock.invalid/art/yard.png', '赶集的日子，院子里挤满了大车和麻袋。院子的景象：https://mock.invalid/art/yard.png'),
    firstMessage: p('Water turns the wheel.', '流水推着水轮转动。'), alternateGreetings: [], messageExample: '',
    creatorNotes: p('A group scene of the people of the mill, with nobody labelled: https://mock.invalid/art/group.png', '磨坊里众人的合影，没有标注谁是谁：https://mock.invalid/art/group.png'),
    systemPrompt: '', postHistoryInstructions: '', tags: [], creator: 'benchmark', characterVersion: '1',
    book: { name: 'book', description: '', entries: [{
      id: 'entry:0', title: p('The visitor', '过客'), keys: [p('visitor', '过客')], secondaryKeys: [],
      content: p('A stranger in a green coat who stops at the mill on the road to the coast. Portrait: https://mock.invalid/art/visitor.png', '一个穿绿外套的陌生人，在去海边的路上经过磨坊。画像：https://mock.invalid/art/visitor.png'),
      enabled: true, constant: false, selective: false, position: 'before_char',
    }] },
    ignored: { scripts: 0, extensions: [] },
  }
  card.urls = urlsOf(card)
  const choices: ImportChoices = { name: card.name, disabledEntries: [], opening: { kind: 'first' } }
  return {
    card, choices,
    pictures: [
      { url: 'https://mock.invalid/art/miller.png', name: 'miller.png', color: [150, 110, 70], characters: [miller], pieces: ['field:description'] },
      { url: 'https://mock.invalid/art/visitor.png', name: 'visitor.png', color: [60, 130, 80], characters: [visitor], pieces: ['entry:0'] },
      { url: 'https://mock.invalid/art/yard.png', name: 'yard.png', color: [190, 170, 120], characters: [], pieces: ['field:scenario'] },
      { url: 'https://mock.invalid/art/group.png', name: 'group.png', color: [120, 120, 160], characters: [miller, visitor], loose: true, pieces: ['field:creator-notes'] },
    ],
  }
}

/** Puts the pictures of the case into a world folder's library the way a card import does: each with the address and the pieces that hold it. */
export async function seedPictures(directory: string, language: Language): Promise<void> {
  const { card, choices, pictures } = pictureCard(language)
  const piecesOf = pieceFinder(card, choices)
  const hashes = new Map<string, string>()
  for (const picture of pictures) await addToLibraryOnce(directory, solidPng(...picture.color), picture.name, hashes, { url: picture.url, pieces: piecesOf(picture.url) })
}
