import {
  EXIT_STATES, MAX_LOCATION_FEATURES,
  type Exit, type ExitId, type ExitPatch, type ExitState, type Location, type LocationFeature, type LocationId, type LocationPatch, type NewExit, type NewLocation, type NewPlacement, type PlaceableKind, type Placement,
} from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase, SqlValue } from '../driver/types.ts'
import { ConflictError, CorruptDataError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { LocationRepository, PlacementRepository } from '../repositories.ts'
import { guard, toJson } from './support.ts'

interface LocationRow {
  id: number
  source_id: string | null
  name: string
  description: string
  parent_id: number | null
  features: string
  created_at: string
}

interface ExitRow {
  id: number
  from_id: number
  to_id: number
  description: string
  travel_seconds: number | null
  state: ExitState
  note: string
}

interface PlacementRow {
  kind: PlaceableKind
  entity_id: number
  location_id: number
  position: string
  feature_key: string | null
}

const FEATURE_KEY = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,59}$/u

function parseFeatures(text: string): LocationFeature[] {
  try {
    const value: unknown = JSON.parse(text)
    if (Array.isArray(value) && value.every(entry => typeof entry === 'object' && entry !== null && typeof (entry as LocationFeature).key === 'string' && typeof (entry as LocationFeature).name === 'string' && typeof (entry as LocationFeature).description === 'string')) return value as LocationFeature[]
  } catch {
    // reported below
  }
  throw new CorruptDataError('locations.features does not hold a list of features')
}

/** The features, or why they are not acceptable. */
function checkedFeatures(features: readonly LocationFeature[]): LocationFeature[] {
  if (features.length > MAX_LOCATION_FEATURES) throw new InvalidValueError(`a place has at most ${MAX_LOCATION_FEATURES} features`)
  const seen = new Set<string>()
  return features.map((feature) => {
    if (!FEATURE_KEY.test(feature.key)) throw new InvalidValueError(`feature key "${feature.key}" must be letters, digits, "-" or "_"`)
    if (seen.has(feature.key)) throw new ConflictError(`feature key "${feature.key}" is used twice`)
    seen.add(feature.key)
    if (feature.name.trim() === '') throw new InvalidValueError(`feature "${feature.key}" needs a name`)
    return { key: feature.key, name: feature.name.trim(), description: feature.description.trim() }
  })
}

const toLocation = (row: LocationRow): Location => ({
  id: row.id,
  ...(row.source_id === null ? {} : { sourceId: row.source_id }),
  name: row.name,
  description: row.description,
  ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
  features: parseFeatures(row.features),
  createdAt: row.created_at,
})

const toExit = (row: ExitRow): Exit => ({
  id: row.id,
  fromId: row.from_id,
  toId: row.to_id,
  description: row.description,
  ...(row.travel_seconds === null ? {} : { travelSeconds: row.travel_seconds }),
  state: row.state,
  note: row.note,
})

const toPlacement = (row: PlacementRow): Placement => ({
  kind: row.kind,
  entityId: row.entity_id,
  locationId: row.location_id,
  position: row.position,
  ...(row.feature_key === null ? {} : { featureKey: row.feature_key }),
})

export class SqliteLocationRepository implements LocationRepository {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: Clock,
    /** Told when a place is renamed, so that what is indexed by its name can follow. */
    private readonly renamed: (id: LocationId) => void = () => undefined,
  ) {}

  add(location: NewLocation): Location {
    if (location.name.trim() === '') throw new InvalidValueError('a place needs a name')
    const features = checkedFeatures(location.features)
    return guard(() => {
      if (location.parentId !== undefined && this.get(location.parentId) === undefined) throw new NotFoundError(`the parent place ${location.parentId} does not exist`)
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO locations (source_id, name, description, parent_id, features, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [location.sourceId ?? null, location.name.trim(), location.description.trim(), location.parentId ?? null, toJson(features), this.clock().toISOString()],
      )
      return this.require(Number(lastInsertRowid))
    })
  }

  get(id: LocationId): Location | undefined {
    const row = this.db.get<LocationRow>('SELECT * FROM locations WHERE id = ?', [id])
    return row === undefined ? undefined : toLocation(row)
  }

  getBySourceId(sourceId: string): Location | undefined {
    const row = this.db.get<LocationRow>('SELECT * FROM locations WHERE source_id = ?', [sourceId])
    return row === undefined ? undefined : toLocation(row)
  }

  list(): Location[] {
    return this.db.all<LocationRow>('SELECT * FROM locations ORDER BY id').map(toLocation)
  }

  childrenOf(id: LocationId): Location[] {
    return this.db.all<LocationRow>('SELECT * FROM locations WHERE parent_id = ? ORDER BY id', [id]).map(toLocation)
  }

  update(id: LocationId, patch: LocationPatch): Location {
    return guard(() => this.db.transaction(() => {
      const current = this.require(id)
      const name = patch.name === undefined ? current.name : patch.name.trim()
      if (name === '') throw new InvalidValueError('a place needs a name')
      const features = patch.features === undefined ? current.features : checkedFeatures(patch.features)
      const removed = current.features.filter(feature => !features.some(kept => kept.key === feature.key))
      for (const feature of removed) {
        const standing = this.db.get('SELECT 1 FROM placements WHERE location_id = ? AND feature_key = ?', [id, feature.key])
        if (standing !== undefined) throw new ConflictError(`feature "${feature.key}" cannot be removed while someone is at it`)
      }
      const parentId = patch.parentId === undefined ? current.parentId ?? null : patch.parentId
      if (parentId !== null && parentId !== (current.parentId ?? null)) {
        if (this.get(parentId) === undefined) throw new NotFoundError(`the parent place ${parentId} does not exist`)
        for (let ancestor: number | null = parentId; ancestor !== null; ancestor = this.get(ancestor)?.parentId ?? null) {
          if (ancestor === id) throw new InvalidValueError(`${current.name} cannot be inside itself or a place within it`)
        }
      }
      this.db.run('UPDATE locations SET name = ?, description = ?, features = ?, parent_id = ? WHERE id = ?', [name, (patch.description ?? current.description).trim(), toJson(features), parentId, id])
      if (name !== current.name) this.renamed(id)
      return this.require(id)
    }))
  }

  addExit(exit: NewExit): Exit {
    return guard(() => {
      if (this.get(exit.fromId) === undefined) throw new NotFoundError(`place ${exit.fromId} does not exist`)
      if (this.get(exit.toId) === undefined) throw new NotFoundError(`place ${exit.toId} does not exist`)
      if (exit.fromId === exit.toId) throw new InvalidValueError('an exit must lead to another place')
      if (exit.state !== undefined && !EXIT_STATES.includes(exit.state)) throw new InvalidValueError(`unknown exit state "${String(exit.state)}"`)
      if (exit.travelSeconds !== undefined && (!Number.isInteger(exit.travelSeconds) || exit.travelSeconds < 0)) throw new InvalidValueError('travel time must be a whole number of seconds')
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO exits (from_id, to_id, description, travel_seconds, state, note) VALUES (?, ?, ?, ?, ?, ?)',
        [exit.fromId, exit.toId, exit.description.trim(), exit.travelSeconds ?? null, exit.state ?? 'open', (exit.note ?? '').trim()],
      )
      return this.requireExit(Number(lastInsertRowid))
    })
  }

  getExit(fromId: LocationId, toId: LocationId): Exit | undefined {
    const row = this.db.get<ExitRow>('SELECT * FROM exits WHERE from_id = ? AND to_id = ?', [fromId, toId])
    return row === undefined ? undefined : toExit(row)
  }

  exitsFrom(id: LocationId): Exit[] {
    return this.db.all<ExitRow>('SELECT * FROM exits WHERE from_id = ? ORDER BY id', [id]).map(toExit)
  }

  allExits(): Exit[] {
    return this.db.all<ExitRow>('SELECT * FROM exits ORDER BY id').map(toExit)
  }

  updateExit(id: ExitId, patch: ExitPatch): Exit {
    return guard(() => {
      const current = this.requireExit(id)
      if (patch.state !== undefined && !EXIT_STATES.includes(patch.state)) throw new InvalidValueError(`unknown exit state "${String(patch.state)}"`)
      if (patch.travelSeconds !== undefined && patch.travelSeconds !== null && (!Number.isInteger(patch.travelSeconds) || patch.travelSeconds < 0)) throw new InvalidValueError('travel time must be a whole number of seconds')
      this.db.run('UPDATE exits SET description = ?, travel_seconds = ?, state = ?, note = ? WHERE id = ?', [
        (patch.description ?? current.description).trim(), patch.travelSeconds === undefined ? current.travelSeconds ?? null : patch.travelSeconds, patch.state ?? current.state, (patch.note ?? current.note).trim(), id,
      ])
      return this.requireExit(id)
    })
  }

  removeExit(id: ExitId): boolean {
    return this.db.run('DELETE FROM exits WHERE id = ?', [id]).changes > 0
  }

  private require(id: LocationId): Location {
    const found = this.get(id)
    if (found === undefined) throw new NotFoundError(`place ${id} does not exist`)
    return found
  }

  private requireExit(id: ExitId): Exit {
    const row = this.db.get<ExitRow>('SELECT * FROM exits WHERE id = ?', [id])
    if (row === undefined) throw new NotFoundError(`exit ${id} does not exist`)
    return toExit(row)
  }
}

export class SqlitePlacementRepository implements PlacementRepository {
  constructor(private readonly db: SqlDatabase, private readonly locations: Pick<LocationRepository, 'get'>) {}

  place(kind: PlaceableKind, entityId: number, placement: NewPlacement): Placement {
    return guard(() => this.db.transaction(() => {
      const location = this.locations.get(placement.locationId)
      if (location === undefined) throw new NotFoundError(`place ${placement.locationId} does not exist`)
      if (kind === 'character' && this.db.get('SELECT 1 FROM characters WHERE id = ?', [entityId]) === undefined) throw new NotFoundError(`character ${entityId} does not exist`)
      if (placement.featureKey !== undefined && !location.features.some(feature => feature.key === placement.featureKey)) {
        throw new InvalidValueError(`${location.name} has no feature "${placement.featureKey}" (it has: ${location.features.map(feature => feature.key).join(', ') || 'none'})`)
      }
      this.db.run(
        `INSERT INTO placements (kind, entity_id, location_id, position, feature_key) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kind, entity_id) DO UPDATE SET location_id = excluded.location_id, position = excluded.position, feature_key = excluded.feature_key`,
        [kind, entityId, placement.locationId, (placement.position ?? '').trim(), placement.featureKey ?? null],
      )
      return this.require(kind, entityId)
    }))
  }

  get(kind: PlaceableKind, entityId: number): Placement | undefined {
    const row = this.db.get<PlacementRow>('SELECT * FROM placements WHERE kind = ? AND entity_id = ?', [kind, entityId])
    return row === undefined ? undefined : toPlacement(row)
  }

  at(locationId: LocationId, kind?: PlaceableKind): Placement[] {
    const params: SqlValue[] = [locationId]
    if (kind !== undefined) params.push(kind)
    return this.db.all<PlacementRow>(`SELECT * FROM placements WHERE location_id = ?${kind === undefined ? '' : ' AND kind = ?'} ORDER BY kind, entity_id`, params).map(toPlacement)
  }

  list(kind?: PlaceableKind): Placement[] {
    return (kind === undefined
      ? this.db.all<PlacementRow>('SELECT * FROM placements ORDER BY kind, entity_id')
      : this.db.all<PlacementRow>('SELECT * FROM placements WHERE kind = ? ORDER BY entity_id', [kind])).map(toPlacement)
  }

  private require(kind: PlaceableKind, entityId: number): Placement {
    const found = this.get(kind, entityId)
    if (found === undefined) throw new NotFoundError(`${kind} ${entityId} is not placed`)
    return found
  }
}
