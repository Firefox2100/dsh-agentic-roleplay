import { crc32, deflateRawSync } from 'node:zlib'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const UTF8_NAMES = 0x0800
const VERSION = 20
/** Midnight, 1 January 1980: the earliest time a ZIP entry can carry, so an archive of the same files is the same bytes. */
const DOS_DATE = 0x21

/**
 * A ZIP archive of the given files, deflated, with names in UTF-8 and a fixed time. It is built in memory, so it suits what a person keeps (a story), not a
 * folder of unbounded size.
 * @throws {RangeError} when a file or the archive passes what a ZIP without ZIP64 can hold.
 */
export function writeZip(files: ReadonlyMap<string, Buffer>): Buffer {
  const parts: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  if (files.size >= 0xffff) throw new RangeError('too many files for a ZIP archive')
  for (const [name, content] of files) {
    const encoded = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(content)
    const useDeflate = packed.length < content.length
    const data = useDeflate ? packed : content
    if (content.length >= 0xffffffff || offset >= 0xffffffff) throw new RangeError('the archive is too large')
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(encoded.length, 26)
    parts.push(local, encoded, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(UTF8_NAMES, 8)
    central.writeUInt16LE(useDeflate ? 8 : 0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(encoded.length, 28)
    central.writeUInt32LE(offset, 42)
    directory.push(central, encoded)
    offset += local.length + encoded.length + data.length
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...directory, end])
}
