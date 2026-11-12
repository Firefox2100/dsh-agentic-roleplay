import type { Files, Language } from '../language.ts'

/**
 * The data of the benchmark framework. Everything here is read from files under `tests/benchmark/data`; adding a world, a layer or a row is adding files.
 * The shapes are closed on purpose: no conditions and no loops in data (a row that needs logic names a module, see `Row.scorer`).
 */

/** The parts of a world a row may use or lack; `featuresOf` finds them in the files, so a row's claim is checked against the world itself. */
export const FEATURES = ['places', 'items', 'factions', 'lore', 'variables', 'triggers', 'dice', 'routines', 'calendar', 'plots', 'rules', 'start-questions', 'tools', 'packs', 'prompts'] as const
export type Feature = (typeof FEATURES)[number]

/** What one language of a base world is. */
export interface WorldLanguage {
  /** Written in this language from the start, not translated from another. */
  native: boolean
  /** The language this one carries the same facts as, for like-for-like comparison. */
  pairedWith?: Language
}

/** `data/worlds/<id>/bench.json`. */
export interface WorldMeta {
  id: string
  name: string
  /** What the world is about (mystery, daily, fantasy, ...): the unit a feature must be seen in twice. */
  theme: string
  languages: Partial<Record<Language, WorldLanguage>>
  /** What the world is for in the benchmark, in a sentence. */
  purpose: string
  /** For a world taken from existing fiction: what it is derived from and why that is allowed; required for the theme `fan`. */
  source?: { derivedFrom: string; note: string }
}

/**
 * `data/worlds/<id>/<language>/layers/<layer>.json` (or `data/layers/<language>/<layer>.json` when shared by worlds): a change a row may ask for on top of the bare world.
 * Changes are applied in this order: `remove`, `add`, `patch`.
 */
export interface Layer {
  id: string
  /** What it changes and why, for the person who maintains the data. */
  description: string
  /** Layers that must be in the row as well. */
  requires: string[]
  /** Layers that cannot be in the row with it. */
  conflicts: string[]
  /** Themes it makes sense in; empty means any. A row may use it elsewhere only as a declared `probe`. */
  fits: string[]
  /** Files to put in, by path under the world folder: JSON values or text. A path that exists is replaced. */
  add: Record<string, unknown>
  /** JSON merge patches by path: an object merges into the file, `null` removes a key, anything else replaces. */
  patch: Record<string, unknown>
  /** Paths to delete first. */
  remove: string[]
}

export interface RowCast {
  /** The character the player plays. */
  player: string
  /** How many other characters the story can ask; checked against the world. */
  npcs: number
}

/** `data/rows/*.json`: one configuration, chosen by hand. */
export interface Row {
  id: string
  world: string
  language: Language
  /** Layers on top of the bare world, in order. */
  layers: string[]
  cast: RowCast
  /** The features the composed world must have, and no other: checked against its files. */
  features: Feature[]
  /** Why this combination exists, and what it is meant to show. */
  why: string
  /** The player's turns (a file under `data/scripts`, in the language the chat is played in); a row without one is only started and inspected, offline. */
  script?: string
  /** Layers used outside the themes they fit, on purpose, to see what the model does. */
  probe?: string[]
  /** A module (under `tests/benchmark`) that exports a scorer, for what the closed expectations cannot say. Listed in the coverage report. */
  scorer?: string
  /** The slices the live results are reported by. */
  report: string[]
  /** Chat settings the story is started with (the same shape as the start request's), over the defaults. The prompt language is the row's unless given here. */
  settings?: Record<string, unknown>
  /** The answers the start dialog is given, by question id and option id: what the world's start questions then choose. */
  answers?: Record<string, string>
  /** Folders of the computer given to the story for its file tools, made for the run: by name, each read-only or read and write. A script writes `{workspace}`, `{folder:<name>}` and `{outside}` (a folder the story was not given) for their paths. */
  folders?: { name: string; access: 'read' | 'write' }[]
  /** Words after a slash that the row's script types on purpose as plain text, because the world has no such command in this row (the control that shows what the command adds). */
  typedAsText?: string[]
  /** Text files put in a folder (`workspace` or one of the row's folders) before the story begins: a brief the task depends on. */
  files?: { in: string; name: string; text: string }[]
  /** A fault planted on purpose, to show the benchmark can see it: the result is reported apart, and an expectation of these kinds that fails means it was caught. */
  plant?: { what: string; caught: string[]; /** A check of the program that must flag the planted world. */ finds?: string }
}

/** `data/excluded.json`: combinations left out on purpose, with the reason, so a gap in the coverage is either filled or explained. */
export interface Exclusion {
  /** A theme, a world id, or `any`. */
  where: string
  features: Feature[]
  reason: string
}

export interface BaseWorld {
  meta: WorldMeta
  /** The bare world of each language, as the files of a world folder. */
  files: Partial<Record<Language, Files>>
  /** The layers of each language by id. */
  layers: Partial<Record<Language, Record<string, Layer>>>
}

export interface BenchData {
  worlds: Record<string, BaseWorld>
  sharedLayers: Partial<Record<Language, Record<string, Layer>>>
  rows: Row[]
  excluded: Exclusion[]
  scripts: Script[]
}

/**
 * What a script may expect: a closed vocabulary, no conditions and no loops. An expectation in a turn is judged on that turn's narration; one at the end of the script on the story.
 * A kind that needs something the run did not observe (the story's characters in a run that only read the chat) is reported not applicable, never as held.
 */
export type Expectation =
  /** The narration holds no status bar, panel or block of tags. */
  | { type: 'narration-clean' }
  /** The narration is written in the row's language. */
  | { type: 'narration-language' }
  /** The narration holds the text (case does not matter). */
  | { type: 'narration-has'; text: string }
  /** The turn was an out-of-character command and was ruled on as one (`/ooc`, or with `question` true `/ask`): its output carries the ruling's note, which a move never does. Turns only. */
  | { type: 'command-ruled'; question?: boolean }
  /** The game master was given this part of the scene in the turn: `roll`, `wait`, `dream` (a command that was played as itself: the player's roll, the time moved on, a dream entered) or `command` (a command of the world). It is the program's own record, in no language. Turns only. */
  | { type: 'scene-has'; section: 'roll' | 'wait' | 'dream' | 'command' }
  /** The narration does not hold the text: a secret, a name the player has not been told. */
  | { type: 'narration-lacks'; text: string }
  /** The named character speaks (an utterance of its own). */
  | { type: 'speaks'; character: string }
  /** At least `share` (0.7 when absent) of the named character's lines fit how its sheet says it speaks, as the decision model judges them; not judged when there is no decision model or the character never speaks. */
  | { type: 'speaks-in-voice'; character: string; share?: number }
  /** The named character says nothing: no utterance of its own in the turn (or, at the end, in the whole story). */
  | { type: 'character-silent'; character: string }
  /** What the story says the character is doing now has this text in it (case does not matter), or, with `not`, does not: a sleeper is doing what its day says, a woken one is not. */
  | { type: 'character-doing'; character: string; text: string; not?: true }
  /** The player's character is given no words of its own. */
  | { type: 'player-silent' }
  /** The story has at least this many turns. */
  | { type: 'turns'; count: number }
  /** The character is in the story, and placed when the world has places. */
  | { type: 'character-exists'; character: string }
  /** A tracked value the player may read is not what it was when the story began; `of` narrows it to a subject (`world`, `player`, or a person's key or name). */
  | { type: 'value-changed'; name: string; of?: string }
  /** A tracked value the player may read shows this text now. */
  | { type: 'value-is'; name: string; value: string; of?: string }
  /** The world's trigger has fired. */
  | { type: 'trigger-fired'; key: string }
  /** The character stands in the place (by keys). */
  | { type: 'character-at'; character: string; place: string; not?: boolean }
  /** The character holds the thing (by keys). */
  | { type: 'item-held-by'; item: string; holder: string }
  /** The story has this many more characters than it began with: people the world author made up. */
  | { type: 'cast-grew'; by: number }
  /** No two characters of the story share a name (case does not matter): the people the world author made up are distinct from each other and from those who were there. */
  | { type: 'cast-distinct' }
  /** Every character of the story stands in a place, when the world has places. */
  | { type: 'cast-placed' }
  /** No sentence of narration or speech longer than a few words is delivered twice. */
  | { type: 'no-repeats' }
  /** A character wrote to the player while they were away (a message note beside the story), the named one or any. */
  | { type: 'message-arrived'; character?: string }
  /** The story's opening message holds the text: what a start question's answer chose. */
  | { type: 'opening-has'; text: string }
  /** A setting of the story has this value (`clock.mode`, `autonomy.enabled`): what a start question's answer or a world's flag set. Written as the text of the value. */
  | { type: 'setting-is'; path: string; value: string }
  /** The interface pack the story plays with is this one (the world's pack was copied into the story and can be used). */
  | { type: 'pack-active'; id: string }
  /** The text file holds the text (case does not matter). */
  | { type: 'file-has'; in: string; name: string; text: string }
  /** The HTML file is a page: it has a title, a body and a closing tag, and every local stylesheet, script or image it names is in the same folder. */
  | { type: 'html-sane'; in: string; name: string }
  /** A file of this name is in the folder: `workspace`, one of the row's folders by name, or `outside` (a folder the story was not given). */
  | { type: 'file-exists'; in: string; name: string }
  /** No file of this name is in the folder. */
  | { type: 'file-lacks'; in: string; name: string }

export const EXPECTATION_TYPES = ['narration-clean', 'narration-language', 'narration-has', 'command-ruled', 'scene-has', 'narration-lacks', 'speaks', 'speaks-in-voice', 'character-silent', 'character-doing', 'player-silent', 'turns', 'character-exists', 'value-changed', 'value-is', 'trigger-fired', 'character-at', 'item-held-by', 'cast-grew', 'cast-distinct', 'cast-placed', 'no-repeats', 'message-arrived', 'opening-has', 'setting-is', 'pack-active', 'file-has', 'html-sane', 'file-exists', 'file-lacks'] as const

export interface ScriptTurn {
  /** What the player writes: a command such as `/ooc`, `/wait` or `/roll` is written as the player would. */
  say?: string
  /** Instead of writing: take the story back (`rewind`, to the state after turn `to`, 0 for the start) or `regenerate` the last turn, which plays the same words again. */
  action?: 'rewind' | 'regenerate' | 'wait'
  to?: number
  /** For `wait`: how many minutes of real time pass with nobody writing, so that a story that goes on without its player can act. */
  minutes?: number
  expect: Expectation[]
}

/** `data/scripts/<id>.json`: the player's turns in one language, with what each should bring. */
export interface Script {
  id: string
  language: Language
  turns: ScriptTurn[]
  /** Judged on the story once every turn is played. */
  expect: Expectation[]
}

/** The language the chat is played in: the row's own unless its settings ask for the other, which tests a story told in a language the world was not written in. */
export const chatLanguage = (row: Pick<Row, 'language' | 'settings'>): Language => {
  const given = (row.settings?.['prompts'] as { language?: unknown } | undefined)?.language
  return given === 'en' || given === 'zh' ? given : row.language
}
