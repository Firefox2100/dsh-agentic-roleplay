export interface Migration {
  /** Becomes the database's `user_version` once applied. Versions are consecutive from 1. */
  version: number
  sql: string
}

/**
 * Migrations are applied in order and never edited once released (0.1.0 released
 * versions 1 to 6; tests/sqlite/migrate.spec.ts pins them): a change to the schema
 * is a new entry. Enumerations are spelled out so that a later change to the model
 * cannot alter what an old migration did.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE characters (
        id INTEGER PRIMARY KEY,
        source_id TEXT UNIQUE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        age TEXT,
        gender TEXT,
        pronouns TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('person', 'group')),
        tier TEXT NOT NULL CHECK (tier IN ('principal', 'supporting', 'background')),
        role TEXT NOT NULL CHECK (role IN ('playable', 'npc')),
        control TEXT NOT NULL CHECK (control IN ('player', 'agent')),
        summary TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        background TEXT NOT NULL DEFAULT '',
        appearance TEXT NOT NULL DEFAULT '',
        speech_style TEXT NOT NULL DEFAULT '',
        speech_examples TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX characters_name_key ON characters (name_key);

      CREATE TABLE character_aliases (
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        alias TEXT NOT NULL,
        alias_key TEXT NOT NULL,
        PRIMARY KEY (character_id, position),
        UNIQUE (character_id, alias_key)
      ) STRICT;
      CREATE INDEX character_aliases_key ON character_aliases (alias_key);

      CREATE TABLE character_state (
        character_id INTEGER PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
        public_state TEXT NOT NULL DEFAULT '',
        inner_state TEXT NOT NULL DEFAULT '',
        activity TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE variable_defs (
        key TEXT PRIMARY KEY,
        ordinal INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK (kind IN ('number', 'flag', 'choice')),
        subject TEXT NOT NULL CHECK (subject IN ('character', 'item', 'location', 'world')),
        only_keys TEXT NOT NULL DEFAULT '[]',
        min_value REAL,
        max_value REAL,
        is_integer INTEGER NOT NULL DEFAULT 0 CHECK (is_integer IN (0, 1)),
        options TEXT NOT NULL DEFAULT '[]',
        default_value TEXT NOT NULL,
        has_baseline INTEGER NOT NULL DEFAULT 0 CHECK (has_baseline IN (0, 1)),
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'hidden')),
        bands TEXT NOT NULL DEFAULT '[]',
        always_shown INTEGER NOT NULL DEFAULT 0 CHECK (always_shown IN (0, 1)),
        builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1))
      ) STRICT;

      CREATE TABLE variable_values (
        variable TEXT NOT NULL REFERENCES variable_defs (key) ON DELETE CASCADE,
        subject TEXT NOT NULL CHECK (subject IN ('character', 'item', 'location', 'world')),
        subject_id INTEGER NOT NULL,
        value TEXT NOT NULL,
        baseline TEXT,
        updated_turn INTEGER NOT NULL,
        PRIMARY KEY (variable, subject, subject_id)
      ) STRICT;
      CREATE INDEX variable_values_subject ON variable_values (subject, subject_id);

      CREATE TABLE intents (
        id INTEGER PRIMARY KEY,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('need', 'obligation', 'quest', 'agenda', 'aspiration', 'relationship', 'habit', 'reaction')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'failed', 'abandoned')),
        horizon TEXT NOT NULL CHECK (horizon IN ('immediate', 'short', 'day', 'long', 'open_ended')),
        priority REAL NOT NULL CHECK (priority BETWEEN 0 AND 1),
        urgency REAL NOT NULL CHECK (urgency BETWEEN 0 AND 1),
        plan TEXT NOT NULL DEFAULT '[]',
        open_threads TEXT NOT NULL DEFAULT '[]',
        constraints TEXT NOT NULL DEFAULT '[]',
        deadline TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX intents_character ON intents (character_id, status);

      CREATE TABLE locations (
        id INTEGER PRIMARY KEY,
        source_id TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        parent_id INTEGER REFERENCES locations (id) ON DELETE RESTRICT,
        features TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX locations_parent ON locations (parent_id);

      CREATE TABLE exits (
        id INTEGER PRIMARY KEY,
        from_id INTEGER NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
        to_id INTEGER NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
        description TEXT NOT NULL DEFAULT '',
        travel_seconds INTEGER CHECK (travel_seconds IS NULL OR travel_seconds >= 0),
        state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'locked', 'blocked')),
        note TEXT NOT NULL DEFAULT '',
        UNIQUE (from_id, to_id),
        CHECK (from_id <> to_id)
      ) STRICT;

      CREATE TABLE placements (
        kind TEXT NOT NULL CHECK (kind IN ('character')),
        entity_id INTEGER NOT NULL,
        location_id INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
        position TEXT NOT NULL DEFAULT '',
        feature_key TEXT,
        PRIMARY KEY (kind, entity_id)
      ) STRICT;
      CREATE INDEX placements_location ON placements (location_id, kind);

      CREATE TABLE relationships (
        id INTEGER PRIMARY KEY,
        from_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        to_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        familiarity REAL NOT NULL DEFAULT 0 CHECK (familiarity BETWEEN 0 AND 1),
        trust REAL NOT NULL DEFAULT 0 CHECK (trust BETWEEN -1 AND 1),
        affinity REAL NOT NULL DEFAULT 0 CHECK (affinity BETWEEN -1 AND 1),
        tension REAL NOT NULL DEFAULT 0 CHECK (tension BETWEEN 0 AND 1),
        updated_turn INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (from_id, to_id),
        CHECK (from_id <> to_id)
      ) STRICT;
      CREATE INDEX relationships_to ON relationships (to_id);

      CREATE TABLE consolidation_items (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('character', 'location', 'item')),
        subject_id INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_turn INTEGER NOT NULL,
        resolved_turn INTEGER,
        resolution TEXT
      ) STRICT;
      CREATE INDEX consolidation_pending ON consolidation_items (resolved_turn, id);

      CREATE TABLE clock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('simulated', 'real')),
        now_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE time_log (
        id INTEGER PRIMARY KEY,
        turn INTEGER NOT NULL,
        round INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('start', 'elapsed', 'real', 'skip', 'resync')),
        from_ms INTEGER NOT NULL,
        to_ms INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX time_log_turn ON time_log (turn, round, id);

      CREATE TABLE routine_windows (
        id INTEGER PRIMARY KEY,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        days TEXT NOT NULL DEFAULT '[]',
        start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
        end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1439 AND end_minute <> start_minute),
        activity TEXT NOT NULL,
        location_id INTEGER REFERENCES locations (id) ON DELETE SET NULL,
        feature_key TEXT,
        position TEXT NOT NULL DEFAULT '',
        interruptible INTEGER NOT NULL DEFAULT 1 CHECK (interruptible IN (0, 1))
      ) STRICT;
      CREATE INDEX routine_windows_character ON routine_windows (character_id, ordinal);

      CREATE TABLE engagements (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        at_ms INTEGER NOT NULL,
        until_ms INTEGER,
        location_id INTEGER REFERENCES locations (id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'kept', 'missed', 'cancelled')),
        note TEXT NOT NULL DEFAULT '',
        created_turn INTEGER NOT NULL,
        updated_turn INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX engagements_due ON engagements (status, at_ms);
      CREATE TABLE engagement_participants (
        engagement_id INTEGER NOT NULL REFERENCES engagements (id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        PRIMARY KEY (engagement_id, character_id)
      ) STRICT;
      CREATE INDEX engagement_participants_character ON engagement_participants (character_id);

      CREATE TABLE slots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity >= 1)
      ) STRICT;

      CREATE TABLE items (
        id INTEGER PRIMARY KEY,
        source_id TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        unique_item INTEGER NOT NULL DEFAULT 0 CHECK (unique_item IN (0, 1)),
        quality TEXT NOT NULL DEFAULT '',
        notable INTEGER NOT NULL DEFAULT 0 CHECK (notable IN (0, 1)),
        hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
        wearable_slot TEXT REFERENCES slots (id),
        container_state TEXT CHECK (container_state IS NULL OR container_state IN ('open', 'closed', 'locked')),
        owner_id INTEGER REFERENCES characters (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE item_holdings (
        item_id INTEGER PRIMARY KEY REFERENCES items (id) ON DELETE CASCADE,
        holder_kind TEXT NOT NULL CHECK (holder_kind IN ('location', 'character', 'item')),
        holder_id INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('at', 'held', 'worn', 'inside')),
        slot TEXT REFERENCES slots (id),
        position TEXT NOT NULL DEFAULT '',
        feature_key TEXT
      ) STRICT;
      CREATE INDEX item_holdings_holder ON item_holdings (holder_kind, holder_id);

      CREATE TABLE openers (
        target_kind TEXT NOT NULL CHECK (target_kind IN ('item', 'exit')),
        target_id INTEGER NOT NULL,
        key_item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        PRIMARY KEY (target_kind, target_id, key_item_id)
      ) STRICT;

      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        turn INTEGER NOT NULL,
        round INTEGER NOT NULL,
        text TEXT NOT NULL,
        importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
        tags TEXT NOT NULL DEFAULT '[]',
        sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
        location_id INTEGER REFERENCES locations (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX events_turn ON events (turn, round, id);
      CREATE INDEX events_location ON events (location_id);

      CREATE TABLE event_involves (
        event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        PRIMARY KEY (event_id, character_id)
      ) STRICT;
      CREATE INDEX event_involves_character ON event_involves (character_id);

      CREATE TABLE event_items (
        event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        PRIMARY KEY (event_id, item_id)
      ) STRICT;

      CREATE TABLE perceptions (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('witnessed', 'heard', 'told', 'inferred')),
        content TEXT NOT NULL,
        gist TEXT NOT NULL,
        accuracy TEXT NOT NULL CHECK (accuracy IN ('accurate', 'partial', 'mistaken')),
        recalls INTEGER NOT NULL DEFAULT 0,
        last_recalled_turn INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE (event_id, character_id)
      ) STRICT;
      CREATE INDEX perceptions_character ON perceptions (character_id, event_id);

      CREATE TABLE memories (
        id INTEGER PRIMARY KEY,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('belief', 'relationship', 'knowledge')),
        text TEXT NOT NULL,
        about TEXT NOT NULL DEFAULT '[]',
        importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
        turn INTEGER NOT NULL,
        recalls INTEGER NOT NULL DEFAULT 0,
        last_recalled_turn INTEGER,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX memories_character ON memories (character_id, id);

      CREATE TABLE story_threads (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        opened_turn INTEGER NOT NULL,
        resolved_turn INTEGER,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE summaries (
        id INTEGER PRIMARY KEY,
        level TEXT NOT NULL CHECK (level IN ('digest', 'chapter')),
        from_turn INTEGER NOT NULL,
        to_turn INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX summaries_range ON summaries (level, from_turn);

      CREATE TABLE recall_items (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('perception', 'memory', 'event')),
        ref_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        embedded INTEGER NOT NULL DEFAULT 0 CHECK (embedded IN (0, 1)),
        UNIQUE (kind, ref_id)
      ) STRICT;
      CREATE INDEX recall_items_character ON recall_items (character_id, kind);
      CREATE INDEX recall_items_pending ON recall_items (embedded, id);

      CREATE VIRTUAL TABLE recall_fts USING fts5(tokens, tokenize = 'unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE recall_vocab USING fts5vocab(recall_fts, 'row');

      CREATE TABLE pending_commits (
        turn INTEGER NOT NULL,
        round INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (turn, round)
      ) STRICT;

      CREATE TABLE triggers (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        condition TEXT NOT NULL,
        effects TEXT NOT NULL,
        repeat INTEGER NOT NULL DEFAULT 0 CHECK (repeat IN (0, 1)),
        cooldown_seconds INTEGER,
        chance REAL CHECK (chance IS NULL OR (chance >= 0 AND chance <= 1)),
        priority INTEGER NOT NULL DEFAULT 0,
        expires TEXT,
        announce TEXT,
        status TEXT NOT NULL DEFAULT 'dormant' CHECK (status IN ('dormant', 'fired', 'failed', 'expired')),
        fire_count INTEGER NOT NULL DEFAULT 0,
        last_fired_ms INTEGER,
        last_result INTEGER NOT NULL DEFAULT 0 CHECK (last_result IN (0, 1)),
        problem TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('world', 'story')),
        created_turn INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX triggers_open ON triggers (status, priority DESC, id);

      CREATE TABLE trigger_notes (
        id INTEGER PRIMARY KEY,
        trigger_id INTEGER NOT NULL REFERENCES triggers (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('beat', 'cue')),
        text TEXT NOT NULL,
        character_ids TEXT NOT NULL DEFAULT '[]',
        turn INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'lapsed'))
      ) STRICT;
      CREATE INDEX trigger_notes_pending ON trigger_notes (status, kind, id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE visual_identities (
        subject_kind TEXT NOT NULL CHECK (subject_kind IN ('character', 'location', 'item')),
        subject_id INTEGER NOT NULL,
        global_id TEXT UNIQUE,
        description TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        negative_tags TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (subject_kind, subject_id)
      ) STRICT;
      CREATE INDEX visual_identities_subject ON visual_identities (subject_kind, subject_id);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE entity_knowledge (
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        subject_kind TEXT NOT NULL CHECK (subject_kind IN ('location', 'item', 'exit')),
        subject_id INTEGER NOT NULL,
        learned_turn INTEGER NOT NULL,
        last_observed_turn INTEGER,
        PRIMARY KEY (character_id, subject_kind, subject_id)
      ) STRICT;
      CREATE INDEX entity_knowledge_subject ON entity_knowledge (subject_kind, subject_id);

      INSERT OR IGNORE INTO entity_knowledge (character_id, subject_kind, subject_id, learned_turn)
        SELECT perceptions.character_id, 'location', events.location_id, events.turn
        FROM perceptions JOIN events ON events.id = perceptions.event_id
        WHERE events.location_id IS NOT NULL;
      INSERT OR IGNORE INTO entity_knowledge (character_id, subject_kind, subject_id, learned_turn)
        SELECT perceptions.character_id, 'item', event_items.item_id, events.turn
        FROM perceptions JOIN events ON events.id = perceptions.event_id JOIN event_items ON event_items.event_id = events.id;
      INSERT OR IGNORE INTO relationships (from_id, to_id, label, summary, familiarity, trust, affinity, tension, updated_turn, created_at)
        SELECT perceptions.character_id, event_involves.character_id, 'acquaintance', '', 0, 0, 0, 0, min(events.turn), min(perceptions.created_at)
        FROM perceptions JOIN events ON events.id = perceptions.event_id JOIN event_involves ON event_involves.event_id = events.id
        WHERE perceptions.character_id <> event_involves.character_id
        GROUP BY perceptions.character_id, event_involves.character_id;
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE factions (
        id INTEGER PRIMARY KEY,
        source_id TEXT UNIQUE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        values_json TEXT NOT NULL DEFAULT '[]',
        structure TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX factions_name_key ON factions (name_key);

      CREATE TABLE faction_aliases (
        faction_id INTEGER NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        alias TEXT NOT NULL,
        alias_key TEXT NOT NULL,
        PRIMARY KEY (faction_id, position),
        UNIQUE (faction_id, alias_key)
      ) STRICT;
      CREATE INDEX faction_aliases_key ON faction_aliases (alias_key);

      CREATE TABLE faction_state (
        faction_id INTEGER PRIMARY KEY REFERENCES factions (id) ON DELETE CASCADE,
        public_state TEXT NOT NULL DEFAULT '',
        inner_state TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE faction_memberships (
        faction_id INTEGER NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT '',
        rank TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'former')),
        is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
        commitment REAL NOT NULL DEFAULT 0 CHECK (commitment BETWEEN 0 AND 1),
        joined_turn INTEGER NOT NULL,
        left_turn INTEGER,
        PRIMARY KEY (faction_id, character_id)
      ) STRICT;
      CREATE INDEX faction_memberships_character ON faction_memberships (character_id, status);

      CREATE TABLE faction_relationships (
        id INTEGER PRIMARY KEY,
        from_kind TEXT NOT NULL CHECK (from_kind IN ('character', 'faction')),
        from_id INTEGER NOT NULL,
        to_kind TEXT NOT NULL CHECK (to_kind IN ('character', 'faction')),
        to_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        familiarity REAL NOT NULL DEFAULT 0 CHECK (familiarity BETWEEN 0 AND 1),
        trust REAL NOT NULL DEFAULT 0 CHECK (trust BETWEEN -1 AND 1),
        affinity REAL NOT NULL DEFAULT 0 CHECK (affinity BETWEEN -1 AND 1),
        tension REAL NOT NULL DEFAULT 0 CHECK (tension BETWEEN 0 AND 1),
        updated_turn INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (from_kind, from_id, to_kind, to_id),
        CHECK (from_kind <> to_kind OR from_id <> to_id)
      ) STRICT;
      CREATE INDEX faction_relationships_to ON faction_relationships (to_kind, to_id);

      CREATE TABLE faction_intents (
        id INTEGER PRIMARY KEY,
        faction_id INTEGER NOT NULL REFERENCES factions (id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('need', 'obligation', 'quest', 'agenda', 'aspiration', 'relationship', 'habit', 'reaction')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'failed', 'abandoned')),
        horizon TEXT NOT NULL CHECK (horizon IN ('immediate', 'short', 'day', 'long', 'open_ended')),
        priority REAL NOT NULL CHECK (priority BETWEEN 0 AND 1),
        urgency REAL NOT NULL CHECK (urgency BETWEEN 0 AND 1),
        plan TEXT NOT NULL DEFAULT '[]',
        open_threads TEXT NOT NULL DEFAULT '[]',
        constraints TEXT NOT NULL DEFAULT '[]',
        deadline TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX faction_intents_faction ON faction_intents (faction_id, status);
    `,
  },
  {
    version: 5,
    sql: `ALTER TABLE characters ADD COLUMN voice TEXT;`,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE lore (
        id INTEGER PRIMARY KEY,
        source_id TEXT UNIQUE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('history', 'culture', 'religion', 'politics', 'geography', 'science', 'custom', 'legend', 'other')),
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        starts_at INTEGER,
        ends_at INTEGER,
        sources_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE lore_subjects (
        lore_id INTEGER NOT NULL REFERENCES lore (id) ON DELETE CASCADE,
        subject_kind TEXT NOT NULL CHECK (subject_kind IN ('character', 'faction', 'location', 'item', 'lore')),
        subject_id INTEGER NOT NULL,
        PRIMARY KEY (lore_id, subject_kind, subject_id)
      ) STRICT;
      CREATE INDEX lore_subjects_subject ON lore_subjects (subject_kind, subject_id);
      CREATE TABLE lore_relations (
        lore_id INTEGER NOT NULL REFERENCES lore (id) ON DELETE CASCADE,
        related_lore_id INTEGER NOT NULL REFERENCES lore (id) ON DELETE CASCADE,
        PRIMARY KEY (lore_id, related_lore_id),
        CHECK (lore_id <> related_lore_id)
      ) STRICT;

      ALTER TABLE entity_knowledge RENAME TO old_entity_knowledge;
      CREATE TABLE entity_knowledge (
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        subject_kind TEXT NOT NULL CHECK (subject_kind IN ('location', 'item', 'exit', 'lore')),
        subject_id INTEGER NOT NULL,
        learned_turn INTEGER NOT NULL,
        last_observed_turn INTEGER,
        PRIMARY KEY (character_id, subject_kind, subject_id)
      ) STRICT;
      INSERT INTO entity_knowledge SELECT * FROM old_entity_knowledge;
      DROP TABLE old_entity_knowledge;
      CREATE INDEX entity_knowledge_subject ON entity_knowledge (subject_kind, subject_id);
    `,
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

/** Marks the file as a roleplay session database ("DRSS"). */
export const APPLICATION_ID = 0x44525353
