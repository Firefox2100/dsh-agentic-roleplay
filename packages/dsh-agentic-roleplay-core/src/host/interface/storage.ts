import type { Session } from '@dsh-agentic-roleplay/state'
import { PACK_LIMITS } from '../../shared/interface-pack.ts'

type StorageSession = Pick<Session, 'metadata'>

const keyOf = (pack: string): string => `roleplay.interface.${pack}`

type Store = Record<string, unknown>

function read(session: StorageSession, pack: string): Store {
  const stored = session.metadata.getValue(keyOf(pack))
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored as Store : {}
}

/** What a pack keeps in a session: small JSON values by name. */
export class PackStorage {
  constructor(private readonly session: StorageSession, private readonly pack: string) {}

  get(key: string): unknown {
    return read(this.session, this.pack)[key] ?? null
  }

  /** @throws {RangeError} when the store would pass its limit. */
  set(key: string, value: unknown): void {
    if (key === '' || key.length > 100) throw new RangeError('a key is 1 to 100 characters')
    const next: Store = { ...read(this.session, this.pack), [key]: value === undefined ? null : value }
    if (JSON.stringify(next).length > PACK_LIMITS.storageBytes) throw new RangeError(`a pack keeps at most ${PACK_LIMITS.storageBytes / 1024} KB in a story`)
    this.session.metadata.setValue(keyOf(this.pack), next as never)
  }

  remove(key: string): void {
    const { [key]: _removed, ...rest } = read(this.session, this.pack)
    this.session.metadata.setValue(keyOf(this.pack), rest as never)
  }
}
