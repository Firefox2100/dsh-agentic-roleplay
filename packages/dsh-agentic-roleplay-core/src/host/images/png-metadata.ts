const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const KEYWORD = 'dsh-roleplay'

let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, start) => {
    let value = start
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    return value >>> 0
  })
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const result = Buffer.allocUnsafe(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  name.copy(result, 4)
  data.copy(result, 8)
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length)
  return result
}

interface PngChunk { type: string; data: Buffer; bytes: Buffer }

function chunks(png: Buffer): PngChunk[] {
  if (png.length < SIGNATURE.length || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error('image generation returned data that is not a PNG')
  const found: PngChunk[] = []
  let offset = SIGNATURE.length
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > png.length) throw new Error('the PNG is truncated')
    const type = png.toString('ascii', offset + 4, offset + 8)
    found.push({ type, data: png.subarray(offset + 8, offset + 8 + length), bytes: png.subarray(offset, end) })
    offset = end
    if (type === 'IEND') break
  }
  if (found.at(-1)?.type !== 'IEND') throw new Error('the PNG has no IEND chunk')
  return found
}

function isOurText(entry: PngChunk): boolean {
  return entry.type === 'iTXt' && entry.data.subarray(0, KEYWORD.length).toString('latin1') === KEYWORD && entry.data[KEYWORD.length] === 0
}

/** Put self-describing UTF-8 JSON in a PNG iTXt chunk, replacing older roleplay metadata. */
export function withPngMetadata(png: Uint8Array, metadata: unknown): Buffer {
  const source = Buffer.from(png)
  const entries = chunks(source).filter(entry => !isOurText(entry))
  const text = Buffer.concat([
    Buffer.from(KEYWORD, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(JSON.stringify(metadata), 'utf8'),
  ])
  const result: Buffer[] = [SIGNATURE]
  for (const entry of entries) {
    if (entry.type === 'IEND') result.push(chunk('iTXt', text))
    result.push(entry.bytes)
  }
  return Buffer.concat(result)
}

/** The roleplay metadata embedded by {@link withPngMetadata}, if present and valid JSON. */
export function readPngMetadata(png: Uint8Array): unknown | undefined {
  const entry = chunks(Buffer.from(png)).find(isOurText)
  if (entry === undefined) return undefined
  let offset = KEYWORD.length + 1
  if (entry.data[offset] !== 0 || entry.data[offset + 1] !== 0) return undefined
  offset += 2
  for (let fields = 0; fields < 2; fields += 1) {
    const end = entry.data.indexOf(0, offset)
    if (end < 0) return undefined
    offset = end + 1
  }
  try { return JSON.parse(entry.data.subarray(offset).toString('utf8')) as unknown } catch { return undefined }
}
