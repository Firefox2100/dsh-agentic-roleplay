import type { SourceItem } from './items.ts'
import { sourcesFor } from './extract.ts'
import { KINDS, ROLES, kindOfRole, type Kind, type Role } from './roles.ts'
import { norm, slug, uniqueKey } from './run.ts'
import { findEntity, type Classified, type Entity, type Roster, type Target } from './survey.ts'

/** One change to the survey. Entities are named by key, name or alias. */
export type SurveyEdit =
  | { op: 'rename'; entity: string; name: string }
  | { op: 'merge'; entity: string; into: string }
  | { op: 'kind'; entity: string; kind: Kind }
  | { op: 'alias'; entity: string; add?: string[]; remove?: string[] }
  | { op: 'player'; entity: string }
  | { op: 'add'; name: string; kind: Kind; aliases?: string[] }
  | { op: 'remove'; entity: string }
  | { op: 'piece'; piece: string; roles?: Role[]; targets?: { name: string; kind: Kind | 'other' }[] }

export interface Survey {
  classified: Classified
  roster: Roster
}

/** Every reason a set of changes cannot be applied: none of them is. */
export class SurveyEditError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('; '))
  }
}

const MAX_NAME = 100
const MAX_ALIASES = 20
const MAX_TARGETS = 10
const PLAYER_WORDS = /^(the |a )?(player|user|you|reader|玩家|用户|你)$/i

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function nameProblem(name: unknown): string | undefined {
  if (typeof name !== 'string' || name.trim() === '') return 'a name is needed'
  if (name.trim().length > MAX_NAME) return `a name is at most ${MAX_NAME} characters`
  if (PLAYER_WORDS.test(name.trim()) || /\[PLAYER\]|\{\{\s*user\s*\}\}/i.test(name)) return 'the player is never listed as an entity'
  return undefined
}

function lookup(roster: Roster, who: unknown, problems: string[]): Entity | undefined {
  if (typeof who !== 'string' || who.trim() === '') { problems.push('an entity is needed'); return undefined }
  const found = roster.find(entity => entity.key === who.trim()) ?? findEntity(roster, who)
  if (found === undefined) problems.push(`there is no entity "${who}" (see import_survey_show)`)
  return found
}

/** Whether a target of a piece names this entity. */
const names = (entity: Entity): Set<string> => new Set([entity.name, ...entity.aliases].map(norm))

/** Applies every change, or none: the survey as it stands is not touched, and what comes back is a new one. */
export function editSurvey(before: Survey, edits: readonly SurveyEdit[], pieces: ReadonlySet<string>): { survey: Survey; done: string[] } {
  const survey = clone(before)
  const problems: string[] = []
  const done: string[] = []
  const retarget = (from: Set<string>, to: Target | undefined): void => {
    for (const piece of Object.values(survey.classified)) {
      const targets: Target[] = []
      for (const target of piece.targets) {
        if (!from.has(norm(target.name))) { targets.push(target); continue }
        if (to !== undefined && !targets.some(other => norm(other.name) === norm(to.name))) targets.push(to)
      }
      piece.targets = targets
    }
  }
  edits.forEach((edit, index) => {
    const at = `change ${index + 1}`
    const fail = (message: string): void => { problems.push(`${at}: ${message}`) }
    switch (edit.op) {
      case 'rename': {
        const inner: string[] = []
        const entity = lookup(survey.roster, edit.entity, inner)
        const bad = nameProblem(edit.name)
        if (bad !== undefined) inner.push(bad)
        else if (entity !== undefined && survey.roster.some(other => other !== entity && names(other).has(norm(edit.name)))) inner.push(`"${edit.name}" is already the name of another entity: merge them instead`)
        inner.forEach(fail)
        if (entity === undefined || inner.length > 0) return
        const old = names(entity)
        const was = entity.name
        entity.name = edit.name.trim()
        if (!entity.aliases.some(alias => norm(alias) === norm(was)) && norm(was) !== norm(entity.name)) entity.aliases.push(was)
        retarget(old, { name: entity.name, kind: entity.kind })
        done.push(`renamed ${was} to ${entity.name}`)
        return
      }
      case 'merge': {
        const inner: string[] = []
        const entity = lookup(survey.roster, edit.entity, inner)
        const into = lookup(survey.roster, edit.into, inner)
        if (entity !== undefined && into !== undefined && entity === into) inner.push('an entity cannot be merged into itself')
        if (entity !== undefined && into !== undefined && entity.kind !== into.kind) inner.push(`${entity.name} is a ${entity.kind} and ${into.name} is a ${into.kind}: change the kind first`)
        inner.forEach(fail)
        if (entity === undefined || into === undefined || inner.length > 0) return
        for (const alias of [entity.name, ...entity.aliases]) if (!names(into).has(norm(alias))) into.aliases.push(alias)
        into.aliases = into.aliases.slice(0, MAX_ALIASES)
        if (entity.player) into.player = true
        for (const other of survey.roster) if (other.parent !== undefined && norm(other.parent) === norm(entity.name)) other.parent = into.name
        retarget(names(entity), { name: into.name, kind: into.kind })
        survey.roster = survey.roster.filter(other => other !== entity)
        done.push(`merged ${entity.name} into ${into.name}`)
        return
      }
      case 'kind': {
        const inner: string[] = []
        const entity = lookup(survey.roster, edit.entity, inner)
        if (!(KINDS as readonly string[]).includes(edit.kind)) inner.push(`a kind is one of ${KINDS.join(', ')}`)
        inner.forEach(fail)
        if (entity === undefined || inner.length > 0 || entity.kind === edit.kind) return
        const old = entity.kind
        entity.kind = edit.kind
        if (edit.kind !== 'place') delete entity.parent
        if (edit.kind !== 'character') entity.player = false
        retarget(names(entity), { name: entity.name, kind: entity.kind })
        done.push(`${entity.name} is a ${edit.kind}, not a ${old}`)
        return
      }
      case 'alias': {
        const inner: string[] = []
        const entity = lookup(survey.roster, edit.entity, inner)
        for (const alias of edit.add ?? []) {
          const bad = nameProblem(alias)
          if (bad !== undefined) inner.push(`alias "${alias}": ${bad}`)
          else if (survey.roster.some(other => other !== entity && names(other).has(norm(alias)))) inner.push(`"${alias}" already names another entity: merge them instead`)
        }
        inner.forEach(fail)
        if (entity === undefined || inner.length > 0) return
        for (const alias of edit.add ?? []) if (!names(entity).has(norm(alias))) entity.aliases.push(alias.trim())
        const drop = new Set((edit.remove ?? []).map(norm))
        entity.aliases = entity.aliases.filter(alias => !drop.has(norm(alias))).slice(0, MAX_ALIASES)
        done.push(`aliases of ${entity.name}: ${entity.aliases.join(', ') || 'none'}`)
        return
      }
      case 'player': {
        const inner: string[] = []
        const entity = lookup(survey.roster, edit.entity, inner)
        if (entity !== undefined && entity.kind !== 'character') inner.push(`${entity.name} is a ${entity.kind}: only a character can be played`)
        inner.forEach(fail)
        if (entity === undefined || inner.length > 0) return
        for (const other of survey.roster) other.player = other === entity
        done.push(`${entity.name} is the character the player plays`)
        return
      }
      case 'add': {
        const bad = nameProblem(edit.name)
        if (bad !== undefined) return fail(bad)
        if (!(KINDS as readonly string[]).includes(edit.kind)) return fail(`a kind is one of ${KINDS.join(', ')}`)
        if (survey.roster.some(other => names(other).has(norm(edit.name)))) return fail(`"${edit.name}" is already in the survey`)
        const aliases = (edit.aliases ?? []).map(alias => alias.trim()).filter(alias => alias !== '')
        const badAlias = aliases.map(nameProblem).find(problem => problem !== undefined)
        if (badAlias !== undefined) return fail(`alias: ${badAlias}`)
        survey.roster.push({ kind: edit.kind, key: uniqueKey(slug(edit.name, edit.kind), new Set(survey.roster.map(other => other.key))), name: edit.name.trim(), aliases: aliases.slice(0, MAX_ALIASES), player: false })
        done.push(`added ${edit.kind} ${edit.name.trim()}; it is written from the pieces whose targets name it (see the piece change)`)
        return
      }
      case 'remove': {
        const inner: string[] = []
        const entity = lookup(survey.roster, edit.entity, inner)
        inner.forEach(fail)
        if (entity === undefined) return
        retarget(names(entity), undefined)
        survey.roster = survey.roster.filter(other => other !== entity)
        done.push(`removed ${entity.name}`)
        return
      }
      case 'piece': {
        const piece = typeof edit.piece === 'string' ? survey.classified[edit.piece] : undefined
        if (piece === undefined || !pieces.has(edit.piece)) return fail(`there is no piece "${String(edit.piece)}" (see import_survey_show)`)
        if (edit.roles === undefined && edit.targets === undefined) return fail('give the roles, the targets or both')
        if (edit.roles !== undefined) {
          if (edit.roles.length === 0 || edit.roles.length > 3) return fail('a piece has one to three roles')
          const unknown = edit.roles.filter(role => !(ROLES as readonly string[]).includes(role))
          if (unknown.length > 0) return fail(`unknown roles ${unknown.join(', ')}; a role is one of ${ROLES.join(', ')}`)
        }
        if (edit.targets !== undefined) {
          if (edit.targets.length > MAX_TARGETS) return fail(`a piece names at most ${MAX_TARGETS} targets`)
          const bad = edit.targets.map(target => nameProblem(target.name) ?? ([...KINDS, 'other'].includes(target.kind) ? undefined : `a target's kind is one of ${[...KINDS, 'other'].join(', ')}`)).find(problem => problem !== undefined)
          if (bad !== undefined) return fail(bad)
        }
        if (edit.roles !== undefined) piece.roles = [...new Set(edit.roles)]
        if (edit.targets !== undefined) piece.targets = edit.targets.map(target => ({ name: target.name.trim(), kind: target.kind }))
        done.push(`${edit.piece}: ${piece.roles.join(', ')} about ${piece.targets.map(target => target.name).join(', ') || 'nobody'}`)
        return
      }
      default:
        fail(`unknown change "${String((edit as { op?: unknown }).op)}"; it is one of rename, merge, kind, alias, player, add, remove, piece`)
    }
  })
  if (problems.length > 0) throw new SurveyEditError(problems)
  if (survey.roster.filter(entity => entity.player).length > 1) throw new SurveyEditError(['more than one entity is marked as the character the player plays'])
  return { survey, done }
}

const SHOWN_PIECES = 12

/** What the survey found, for the person to check: every entity with the pieces it is written from, and what looks doubtful. */
export function describeSurvey(survey: Survey, items: readonly SourceItem[]): { entities: object[]; unsure: string[]; pieceRoles: Record<string, number> } {
  const entities = survey.roster.map((entity) => {
    const sources = sourcesFor(entity, items, survey.classified)
    return {
      key: entity.key, name: entity.name, kind: entity.kind, ...(entity.aliases.length === 0 ? {} : { aliases: entity.aliases }), ...(entity.player ? { playedByThePlayer: true } : {}),
      ...(entity.parent === undefined ? {} : { in: entity.parent }), pieces: sources.slice(0, SHOWN_PIECES).map(item => item.id), ...(sources.length > SHOWN_PIECES ? { morePieces: sources.length - SHOWN_PIECES } : {}),
    }
  })
  const unsure: string[] = []
  if (survey.roster.some(entity => entity.kind === 'character') && !survey.roster.some(entity => entity.player)) unsure.push('no character is marked as the one the player plays (set it with a player change when the card has one)')
  for (const entity of survey.roster) if (sourcesFor(entity, items, survey.classified).length === 0) unsure.push(`${entity.name} (${entity.kind}) has no piece that is about it`)
  for (const item of items) {
    const piece = survey.classified[item.id]
    if (piece === undefined) continue
    if (piece.roles.some(role => kindOfRole(role) !== undefined) && piece.targets.length === 0) unsure.push(`${item.id} is about ${piece.roles[0]} but names nobody`)
    else if (piece.targets.length >= 5) unsure.push(`${item.id} names ${piece.targets.length} targets: is it about all of them`)
  }
  const pieceRoles: Record<string, number> = {}
  for (const item of items) { const role = survey.classified[item.id]?.roles[0]; if (role !== undefined) pieceRoles[role] = (pieceRoles[role] ?? 0) + 1 }
  return { entities, unsure, pieceRoles }
}

/** The pieces of the card with what the survey made of each. */
export function describePieces(survey: Survey, items: readonly SourceItem[]): object[] {
  return items.map(item => ({ piece: item.id, label: item.label, characters: item.text.length, roles: survey.classified[item.id]?.roles ?? [], about: (survey.classified[item.id]?.targets ?? []).map(target => `${target.name} (${target.kind})`) }))
}
