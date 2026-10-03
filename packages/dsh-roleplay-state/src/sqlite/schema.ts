export interface Migration {
  /** Becomes the database's `user_version` once applied. Versions are consecutive from 1. */
  version: number
  sql: string
}

/**
 * Migrations are applied in order and never edited once released: a change to
 * the schema is a new entry. Until the first release the schema is still being
 * shaped, so migration 1 is edited in place. Enumerations are spelled out so that
 * a later change to the model cannot alter what an old migration did.
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

      CREATE TABLE character_emotion (
        character_id INTEGER PRIMARY KEY REFERENCES character_state (character_id) ON DELETE CASCADE,
        baseline_valence REAL NOT NULL CHECK (baseline_valence BETWEEN -1 AND 1),
        baseline_arousal REAL NOT NULL CHECK (baseline_arousal BETWEEN -1 AND 1),
        baseline_dominance REAL NOT NULL CHECK (baseline_dominance BETWEEN -1 AND 1),
        immediate_valence REAL NOT NULL CHECK (immediate_valence BETWEEN -1 AND 1),
        immediate_arousal REAL NOT NULL CHECK (immediate_arousal BETWEEN -1 AND 1),
        immediate_dominance REAL NOT NULL CHECK (immediate_dominance BETWEEN -1 AND 1)
      ) STRICT;

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

      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        turn INTEGER NOT NULL,
        round INTEGER NOT NULL,
        text TEXT NOT NULL,
        importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
        tags TEXT NOT NULL DEFAULT '[]',
        sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX events_turn ON events (turn, round, id);

      CREATE TABLE event_involves (
        event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
        PRIMARY KEY (event_id, character_id)
      ) STRICT;
      CREATE INDEX event_involves_character ON event_involves (character_id);

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
    `,
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

/** Marks the file as a roleplay session database ("DRSS"). */
export const APPLICATION_ID = 0x44525353
