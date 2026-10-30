/** What a variable holds: a number within bounds, a yes or no, or one of a list of words. */
export const VARIABLE_KINDS = ['number', 'flag', 'choice'] as const
export type VariableKind = (typeof VARIABLE_KINDS)[number]

/** What a variable is about: each character, item or place has its own value; `world` has one value for the whole story. */
export const VARIABLE_SUBJECTS = ['character', 'item', 'location', 'world'] as const
export type VariableSubject = (typeof VARIABLE_SUBJECTS)[number]

/**
 * Who can tell what the value is. `public`: anyone present (what shows). `private`: the character it belongs to, and the
 * game master (what it feels or knows of itself). `hidden`: only the game master and the record keeper.
 */
export const VARIABLE_VISIBILITIES = ['public', 'private', 'hidden'] as const
export type VariableVisibility = (typeof VARIABLE_VISIBILITIES)[number]

export type VariableValue = number | boolean | string

/** The word for a number up to a bound: values up to `upTo` (and above the previous band) are called `label`. */
export interface VariableBand {
  upTo: number
  label: string
}

/** A kind of thing the story keeps track of, declared by a world, by the story, or built in. */
export interface VariableDefinition {
  /** Lowercase letters, digits and underscores, starting with a letter. */
  key: string
  name: string
  /** What it measures or means, for the models that read and change it. */
  description: string
  kind: VariableKind
  subject: VariableSubject
  /** The subjects it applies to, by their keys; every subject of its kind when empty. */
  only: string[]
  /** The bounds of a number. */
  min?: number
  max?: number
  /** Whether a number is a whole number. */
  integer: boolean
  /** The words a choice is one of. */
  options: string[]
  /** What it is for a subject that has no value of its own yet. */
  default: VariableValue
  /** Whether each value has a baseline beside the current one: the slow-moving temperament the current value is measured from (feelings). */
  baseline: boolean
  visibility: VariableVisibility
  /** Words for ranges of a number, lowest first; the last one covers whatever is above. */
  bands: VariableBand[]
  /** Whether it is always told, even at its default; otherwise only once it differs from it. */
  always: boolean
  /** Built in: it cannot be removed, and what it is cannot be changed. */
  builtin: boolean
}

/** A variable as the world's files write it: what is left out takes its default. */
export type VariableDefinitionInput = Pick<VariableDefinition, 'key' | 'name' | 'kind' | 'subject'> & Partial<Omit<VariableDefinition, 'key' | 'name' | 'kind' | 'subject' | 'builtin'>>

export interface StoredVariable {
  variable: string
  subject: VariableSubject
  /** 0 for the world. */
  subjectId: number
  value: VariableValue
  baseline?: VariableValue
  updatedTurn: number
}

export const VARIABLE_KEY = /^[a-z][a-z0-9_]{0,39}$/

/** The feelings every character has: built in, from -1 to 1, with a temperament beside the current value. */
export const EMOTION_VARIABLES: readonly VariableDefinition[] = [
  { key: 'valence', name: 'Valence', description: 'How pleasant its mood is: -1 very unpleasant, 0 neutral, 1 very pleasant.', labels: [{ upTo: -0.6, label: 'miserable' }, { upTo: -0.25, label: 'unhappy' }, { upTo: 0.25, label: 'even' }, { upTo: 0.6, label: 'pleased' }, { upTo: 1, label: 'delighted' }] },
  { key: 'arousal', name: 'Arousal', description: 'How worked up it is: -1 drowsy, 0 ordinary, 1 frantic.', labels: [{ upTo: -0.6, label: 'drowsy' }, { upTo: -0.25, label: 'calm' }, { upTo: 0.25, label: 'alert' }, { upTo: 0.6, label: 'keyed up' }, { upTo: 1, label: 'frantic' }] },
  { key: 'dominance', name: 'Dominance', description: 'How much in control it feels: -1 helpless, 0 even, 1 commanding.', labels: [{ upTo: -0.6, label: 'helpless' }, { upTo: -0.25, label: 'uneasy' }, { upTo: 0.25, label: 'steady' }, { upTo: 0.6, label: 'confident' }, { upTo: 1, label: 'commanding' }] },
].map(({ labels, ...rest }): VariableDefinition => ({
  ...rest, kind: 'number', subject: 'character', only: [], min: -1, max: 1, integer: false, options: [], default: 0, baseline: true, visibility: 'private',
  bands: labels.map(band => ({ upTo: band.upTo, label: band.label })), always: false, builtin: true,
}))
