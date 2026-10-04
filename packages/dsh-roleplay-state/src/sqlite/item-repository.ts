import {
  CONTAINER_STATES, DEFAULT_SLOTS, SLOT_ID,
  type CharacterId, type Holder, type Holding, type Item, type ItemId, type ItemPatch, type LocationId, type NewItem, type Slot,
} from 'dsh-roleplay-model'
import type { Clock } from '../clock.ts'
import type { SqlDatabase } from '../driver/types.ts'
import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts'
import type { ItemRepository, SlotRepository } from '../repositories.ts'
import { guard } from './support.ts'

interface ItemRow {
  id: number
  source_id: string | null
  name: string
  description: string
  quantity: number
  unique_item: number
  quality: string
  notable: number
  hidden: number
  wearable_slot: string | null
  container_state: Item['container'] extends infer C ? (C extends { state: infer S } ? S : never) | null : never
  owner_id: number | null
  created_at: string
}

interface HoldingRow {
  item_id: number
  holder_kind: 'location' | 'character' | 'item'
  holder_id: number
  mode: 'at' | 'held' | 'worn' | 'inside'
  slot: string | null
  position: string
  feature_key: string | null
}

const toItem = (row: ItemRow): Item => ({
  id: row.id,
  ...(row.source_id === null ? {} : { sourceId: row.source_id }),
  name: row.name,
  description: row.description,
  quantity: row.quantity,
  unique: row.unique_item === 1,
  quality: row.quality,
  notable: row.notable === 1,
  hidden: row.hidden === 1,
  ...(row.wearable_slot === null ? {} : { wearableSlot: row.wearable_slot }),
  ...(row.container_state === null ? {} : { container: { state: row.container_state } }),
  ...(row.owner_id === null ? {} : { ownerId: row.owner_id }),
  createdAt: row.created_at,
})

const toHolder = (row: HoldingRow): Holder => {
  switch (row.holder_kind) {
    case 'location': return { kind: 'location', locationId: row.holder_id, ...(row.position === '' ? {} : { position: row.position }), ...(row.feature_key === null ? {} : { featureKey: row.feature_key }) }
    case 'character': return row.mode === 'worn'
      ? { kind: 'character', characterId: row.holder_id, mode: 'worn', slot: row.slot!, ...(row.position === '' ? {} : { position: row.position }) }
      : { kind: 'character', characterId: row.holder_id, mode: 'held' }
    case 'item': return { kind: 'item', itemId: row.holder_id, ...(row.position === '' ? {} : { position: row.position }) }
  }
}

export class SqliteSlotRepository implements SlotRepository {
  constructor(private readonly db: SqlDatabase) {}

  ensureDefaults(): void {
    for (const slot of DEFAULT_SLOTS) this.db.run('INSERT OR IGNORE INTO slots (id, name, capacity) VALUES (?, ?, ?)', [slot.id, slot.name, slot.capacity])
  }

  list(): Slot[] {
    return this.db.all<Slot>('SELECT id, name, capacity FROM slots ORDER BY rowid')
  }

  get(id: string): Slot | undefined {
    return this.db.get<Slot>('SELECT id, name, capacity FROM slots WHERE id = ?', [id])
  }

  upsert(slot: Slot): Slot {
    if (!SLOT_ID.test(slot.id)) throw new InvalidValueError(`slot id "${slot.id}" must be lowercase letters, digits, "-" or "_"`)
    if (slot.name.trim() === '') throw new InvalidValueError(`slot "${slot.id}" needs a name`)
    if (!Number.isInteger(slot.capacity) || slot.capacity < 1) throw new InvalidValueError(`slot "${slot.id}" needs a capacity of at least 1`)
    const worn = this.db.get<{ n: number }>("SELECT MAX(c) AS n FROM (SELECT COUNT(*) AS c FROM item_holdings WHERE mode = 'worn' AND slot = ? GROUP BY holder_id)", [slot.id])?.n ?? 0
    if (slot.capacity < worn) throw new ConflictError(`slot "${slot.id}" already has ${worn} things worn in it, more than ${slot.capacity}`)
    this.db.run('INSERT INTO slots (id, name, capacity) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, capacity = excluded.capacity', [slot.id, slot.name.trim(), slot.capacity])
    return this.get(slot.id)!
  }
}

export class SqliteItemRepository implements ItemRepository {
  constructor(private readonly db: SqlDatabase, private readonly clock: Clock) {}

  add(item: NewItem, holder: Holder): Item {
    if (item.name.trim() === '') throw new InvalidValueError('an item needs a name')
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new InvalidValueError('the quantity must be a whole number from 1')
    if (item.container !== undefined && !CONTAINER_STATES.includes(item.container.state)) throw new InvalidValueError(`unknown container state "${String(item.container.state)}"`)
    return guard(() => this.db.transaction(() => {
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO items (source_id, name, description, quantity, unique_item, quality, notable, hidden, wearable_slot, container_state, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.sourceId ?? null, item.name.trim(), item.description.trim(), item.quantity, item.unique ? 1 : 0, item.quality.trim(), item.notable ? 1 : 0, item.hidden ? 1 : 0, item.wearableSlot ?? null, item.container?.state ?? null, item.ownerId ?? null, this.clock().toISOString()],
      )
      const id = Number(lastInsertRowid)
      this.place(id, holder)
      return this.require(id)
    }))
  }

  get(id: ItemId): Item | undefined {
    const row = this.db.get<ItemRow>('SELECT * FROM items WHERE id = ?', [id])
    return row === undefined ? undefined : toItem(row)
  }

  getBySourceId(sourceId: string): Item | undefined {
    const row = this.db.get<ItemRow>('SELECT * FROM items WHERE source_id = ?', [sourceId])
    return row === undefined ? undefined : toItem(row)
  }

  list(): Item[] {
    return this.db.all<ItemRow>('SELECT * FROM items ORDER BY id').map(toItem)
  }

  update(id: ItemId, patch: ItemPatch): Item {
    return guard(() => this.db.transaction(() => {
      const current = this.require(id)
      const name = patch.name === undefined ? current.name : patch.name.trim()
      if (name === '') throw new InvalidValueError('an item needs a name')
      const quantity = patch.quantity ?? current.quantity
      if (!Number.isInteger(quantity) || quantity < 1) throw new InvalidValueError('the quantity must be a whole number from 1')
      if (patch.container !== undefined && current.container === undefined) throw new InvalidValueError(`${current.name} is not a container`)
      if (patch.container !== undefined && !CONTAINER_STATES.includes(patch.container.state)) throw new InvalidValueError(`unknown container state "${String(patch.container.state)}"`)
      this.db.run('UPDATE items SET name = ?, description = ?, quantity = ?, quality = ?, notable = ?, hidden = ?, container_state = ?, owner_id = ? WHERE id = ?', [
        name, (patch.description ?? current.description).trim(), quantity, (patch.quality ?? current.quality).trim(), (patch.notable ?? current.notable) ? 1 : 0, (patch.hidden ?? current.hidden) ? 1 : 0,
        patch.container?.state ?? current.container?.state ?? null, patch.ownerId ?? current.ownerId ?? null, id,
      ])
      return this.require(id)
    }))
  }

  remove(id: ItemId): boolean {
    return this.db.transaction(() => {
      if (this.contents({ kind: 'item', id }).length > 0) throw new ConflictError(`${this.get(id)?.name ?? id} still holds things: take them out first`)
      this.db.run("DELETE FROM openers WHERE target_kind = 'item' AND target_id = ?", [id])
      return this.db.run('DELETE FROM items WHERE id = ?', [id]).changes > 0
    })
  }

  holding(id: ItemId): Holding | undefined {
    const row = this.db.get<HoldingRow>('SELECT * FROM item_holdings WHERE item_id = ?', [id])
    return row === undefined ? undefined : { itemId: id, holder: toHolder(row) }
  }

  place(id: ItemId, holder: Holder): Holding {
    return guard(() => this.db.transaction(() => {
      const item = this.require(id)
      let slot: string | null = null
      let mode: HoldingRow['mode'] = 'at'
      let holderId: number
      let position = ''
      let feature: string | null = null
      switch (holder.kind) {
        case 'location':
          if (this.db.get('SELECT 1 FROM locations WHERE id = ?', [holder.locationId]) === undefined) throw new NotFoundError(`place ${holder.locationId} does not exist`)
          if (holder.featureKey !== undefined) {
            const features = this.db.get<{ features: string }>('SELECT features FROM locations WHERE id = ?', [holder.locationId])!.features
            if (!(JSON.parse(features) as { key: string }[]).some(feature => feature.key === holder.featureKey)) throw new InvalidValueError(`that place has no feature "${holder.featureKey}"`)
            feature = holder.featureKey
          }
          holderId = holder.locationId
          position = holder.position ?? ''
          break
        case 'character':
          if (this.db.get('SELECT 1 FROM characters WHERE id = ?', [holder.characterId]) === undefined) throw new NotFoundError(`character ${holder.characterId} does not exist`)
          holderId = holder.characterId
          mode = holder.mode
          if (holder.mode === 'worn') {
            if (item.wearableSlot === undefined) throw new InvalidValueError(`${item.name} cannot be worn`)
            if (holder.slot !== item.wearableSlot) throw new InvalidValueError(`${item.name} is worn on the ${item.wearableSlot}, not the ${holder.slot}`)
            const place = this.db.get<{ capacity: number }>('SELECT capacity FROM slots WHERE id = ?', [holder.slot])
            if (place === undefined) throw new NotFoundError(`there is no slot "${holder.slot}"`)
            const taken = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM item_holdings WHERE mode = 'worn' AND holder_id = ? AND slot = ? AND item_id <> ?", [holder.characterId, holder.slot, id])!.n
            if (taken >= place.capacity) throw new ConflictError(`the ${holder.slot} is full (${place.capacity} worn there already)`)
            slot = holder.slot
            position = holder.position ?? ''
          }
          break
        case 'item': {
          const container = this.get(holder.itemId)
          if (container === undefined) throw new NotFoundError(`item ${holder.itemId} does not exist`)
          if (container.container === undefined) throw new InvalidValueError(`${container.name} cannot hold things`)
          if (holder.itemId === id || this.ancestors(holder.itemId).includes(id)) throw new InvalidValueError(`${item.name} cannot be put inside itself`)
          holderId = holder.itemId
          mode = 'inside'
          position = holder.position ?? ''
          break
        }
      }
      this.db.run(
        `INSERT INTO item_holdings (item_id, holder_kind, holder_id, mode, slot, position, feature_key) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET holder_kind = excluded.holder_kind, holder_id = excluded.holder_id, mode = excluded.mode, slot = excluded.slot, position = excluded.position, feature_key = excluded.feature_key`,
        [id, holder.kind, holderId, mode, slot, position.trim(), feature],
      )
      return this.holding(id)!
    }))
  }

  contents(holder: { kind: 'location' | 'character' | 'item'; id: number }): { item: Item; holding: Holding }[] {
    const rows = this.db.all<HoldingRow>('SELECT * FROM item_holdings WHERE holder_kind = ? AND holder_id = ? ORDER BY item_id', [holder.kind, holder.id])
    return rows.flatMap((row) => {
      const item = this.get(row.item_id)
      return item === undefined ? [] : [{ item, holding: { itemId: row.item_id, holder: toHolder(row) } }]
    })
  }

  ancestors(id: ItemId): ItemId[] {
    const chain: ItemId[] = []
    for (let holding = this.holding(id); holding?.holder.kind === 'item'; holding = this.holding(holding.holder.itemId)) {
      if (chain.includes(holding.holder.itemId)) break
      chain.push(holding.holder.itemId)
    }
    return chain
  }

  where(id: ItemId): { locationId?: LocationId; characterId?: CharacterId } {
    let holding = this.holding(id)
    for (let guardCount = 0; holding !== undefined && guardCount < 64; guardCount++) {
      const { holder } = holding
      if (holder.kind === 'location') return { locationId: holder.locationId }
      if (holder.kind === 'character') {
        const placement = this.db.get<{ location_id: number }>("SELECT location_id FROM placements WHERE kind = 'character' AND entity_id = ?", [holder.characterId])
        return { characterId: holder.characterId, ...(placement === undefined ? {} : { locationId: placement.location_id }) }
      }
      holding = this.holding(holder.itemId)
    }
    return {}
  }

  openers(target: { kind: 'item' | 'exit'; id: number }): ItemId[] {
    return this.db.all<{ key_item_id: number }>('SELECT key_item_id FROM openers WHERE target_kind = ? AND target_id = ? ORDER BY key_item_id', [target.kind, target.id]).map(row => row.key_item_id)
  }

  setOpeners(target: { kind: 'item' | 'exit'; id: number }, items: readonly ItemId[]): void {
    this.db.transaction(() => {
      if (target.kind === 'item' && this.get(target.id)?.container === undefined) throw new InvalidValueError(`item ${target.id} is not a container`)
      this.db.run('DELETE FROM openers WHERE target_kind = ? AND target_id = ?', [target.kind, target.id])
      for (const item of new Set(items)) {
        if (this.get(item) === undefined) throw new NotFoundError(`item ${item} does not exist`)
        this.db.run('INSERT INTO openers (target_kind, target_id, key_item_id) VALUES (?, ?, ?)', [target.kind, target.id, item])
      }
    })
  }

  private require(id: ItemId): Item {
    const found = this.get(id)
    if (found === undefined) throw new NotFoundError(`item ${id} does not exist`)
    return found
  }
}
