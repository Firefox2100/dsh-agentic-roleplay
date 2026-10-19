import { crc32, deflateRawSync } from 'node:zlib'

export interface ZipEntry {
  name: string
  content?: string | Buffer
  /** Stored instead of deflated. */
  stored?: boolean
  /** Unix mode in the upper half of the external attributes. */
  mode?: number
  encrypted?: boolean
  /** What the directory says the unpacked size is, when it should differ from the truth. */
  declaredSize?: number
}

/** A ZIP archive built the way a normal tool writes one, with knobs for the malformed ones. */
export function makeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content ?? '')
    const data = entry.stored === true ? content : deflateRawSync(content)
    const method = entry.stored === true ? 0 : 8
    const flags = entry.encrypted === true ? 1 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc32(content), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(entry.declaredSize ?? content.length, 24); central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    directory.push(central, name)
    offset += local.length + name.length + data.length
  }
  const body = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(body.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, body, end])
}

/** A world archive: its folder with a `world.json` and any other files. */
export function worldZip(folder: string, world: Record<string, unknown>, files: Record<string, string> = {}): Buffer {
  return makeZip([{ name: `${folder}/world.json`, content: JSON.stringify(world) }, ...Object.entries(files).map(([name, content]) => ({ name: `${folder}/${name}`, content }))])
}
