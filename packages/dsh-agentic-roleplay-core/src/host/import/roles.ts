export const ROLES = ['character', 'player', 'speech', 'place', 'faction', 'thing', 'world', 'scenario', 'instruction', 'generator', 'template', 'irrelevant'] as const
export type Role = typeof ROLES[number]

export const KINDS = ['character', 'place', 'faction', 'thing'] as const
export type Kind = typeof KINDS[number]

/** What the importer does with a piece that plays a role. */
interface RoleTraits {
  /** The kind of entity a piece in this role tells about; none for roles about the world, the story or the card itself. */
  entity?: Kind
  /** Whether the piece says how to run a story, or nothing about this one, so that it is not carried on as the world's facts. */
  leftOut: boolean
  /** Whether the piece is searched for guidance on making things up and for standing rules. */
  guidance: boolean
}

/** One place that says what every role means to the import; the stages ask the predicates below instead of listing roles. */
export const ROLE_TABLE: Record<Role, RoleTraits> = {
  character: { entity: 'character', leftOut: false, guidance: true },
  player: { entity: 'character', leftOut: false, guidance: true },
  speech: { entity: 'character', leftOut: false, guidance: false },
  place: { entity: 'place', leftOut: false, guidance: true },
  faction: { entity: 'faction', leftOut: false, guidance: true },
  thing: { entity: 'thing', leftOut: false, guidance: true },
  world: { leftOut: false, guidance: true },
  scenario: { leftOut: false, guidance: true },
  instruction: { leftOut: true, guidance: true },
  generator: { leftOut: false, guidance: true },
  template: { leftOut: true, guidance: false },
  irrelevant: { leftOut: true, guidance: false },
}

/** What a stage needs of a classification: the roles of one piece. */
export interface HasRoles { roles: readonly Role[] }

/** The role a piece is mostly about: the first the classifier named. */
export const mainRole = <T extends HasRoles>(piece: T): Role | undefined => piece.roles[0]
export const kindOfRole = (role: Role): Kind | undefined => ROLE_TABLE[role].entity
export const playsRole = <T extends HasRoles>(piece: T, role: Role): boolean => piece.roles.includes(role)
export const isLeftOut = <T extends HasRoles>(piece: T): boolean => piece.roles.every(role => ROLE_TABLE[role].leftOut)

/** A piece that is only guidance on making people, places or things up while the story is played: the names in it are kinds and examples, not entities of the world. */
export const isGeneratorOnly = <T extends HasRoles>(piece: T): boolean => playsRole(piece, 'generator') && piece.roles.every(role => role === 'generator' || ROLE_TABLE[role].leftOut)

/** A piece that states facts of the world, for the lore: not a rule for the narrator, not guidance on making things up. */
export const statesWorldFacts = <T extends HasRoles>(piece: T): boolean => playsRole(piece, 'world') && !playsRole(piece, 'instruction') && !playsRole(piece, 'generator')

/** A piece that may hold guidance on making things up or a standing rule (the generator pieces are read whole by their own step). */
export const mayHoldGuidance = <T extends HasRoles>(piece: T): boolean => !playsRole(piece, 'generator') && piece.roles.some(role => ROLE_TABLE[role].guidance)
