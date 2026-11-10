import { wrongLanguage } from '../../../src/host/translate/language.ts'
import { findPanel } from '../../../src/host/import/panels.ts'
import type { NarrationSegment } from '../../../src/shared/narration.ts'
import type { Language } from '../language.ts'
import type { Expectation, Script } from './types.ts'

/** What a run saw: the narration of each turn and, when it could read the story, who is in it. */
export interface Observation {
  language: Language
  /** The key of the character the player plays. */
  player: string
  /** What the story shows now, from its first turn to its head. */
  turns: { segments: NarrationSegment[] }[]
  /** What each of the script's steps delivered when it was played, kept even where the story was taken back after it. */
  played?: { segments: NarrationSegment[] }[]
  /** Absent when the run could not read the story's records. */
  characters?: { key: string; name?: string; placed: boolean; place?: string; /** What the story says it is doing. */ activity?: string }[]
  /** How many of each character's lines the decision model found in its voice, when one was asked. */
  voice?: { character: string; lines: number; fits: number }[]
  /** How many characters the story began with. */
  castAtStart?: number
  things?: { key: string; holder: string }[]
  triggers?: { key: string; fired: boolean }[]
  /** The tracked values the player may read, now and when the story began. */
  values?: { of: string[]; name: string; value: string }[]
  initialValues?: { of: string[]; name: string; value: string }[]
  /** Whether the world has places, so that a character is expected to be in one. */
  places?: boolean
  /** The lines of the notes shown beside the story, by kind, at the end. */
  notes?: { kind: string; lines: string[] }[]
  /** The story's opening message as the player read it. */
  opening?: string
  /** The interface pack the story plays with, and what is wrong with the one it was to use. */
  pack?: { active?: string; problems: string[] }
  /** The story's settings, as the form reads them. */
  settings?: Record<string, unknown>
  /** The names of the files in each folder the run looked at (`workspace`, a row's folders, `outside`). */
  files?: Record<string, string[]>
  /** The text of the small text files in each folder, by folder and name. */
  fileTexts?: Record<string, Record<string, string>>
}

export interface Verdict {
  where: string
  expectation: Expectation
  /** `undefined` when the observation cannot say. */
  held: boolean | undefined
  found?: string
}

const textOf = (segments: readonly NarrationSegment[]): string => segments.map(segment => segment.text).join('\n')
const has = (text: string, part: string): boolean => text.toLowerCase().includes(part.toLowerCase())

function judge(expectation: Expectation, observation: Observation, turns: Observation['turns']): Pick<Verdict, 'held' | 'found'> {
  const text = turns.map(turn => textOf(turn.segments)).join('\n')
  switch (expectation.type) {
    case 'narration-clean': {
      const panel = findPanel(text)
      return panel === undefined ? { held: true } : { held: false, found: panel.slice(0, 200) }
    }
    case 'narration-language': {
      const wrong = wrongLanguage(observation.language, { narration: text }, { strays: true })
      return wrong === undefined ? { held: true } : { held: false, found: wrong }
    }
    case 'narration-has': return { held: has(text, expectation.text) }
    case 'narration-lacks': return has(text, expectation.text) ? { held: false, found: expectation.text } : { held: true }
    case 'speaks': return { held: turns.some(turn => turn.segments.some(segment => segment.type === 'utterance' && segment.character === expectation.character)) }
    case 'speaks-in-voice': {
      const judged = observation.voice?.find(entry => entry.character === expectation.character)
      if (judged === undefined || judged.lines === 0) return { held: undefined }
      const share = judged.fits / judged.lines
      return { held: share >= (expectation.share ?? 0.7), found: `${judged.fits} of ${judged.lines} lines` }
    }
    case 'character-silent': return { held: !turns.some(turn => turn.segments.some(segment => segment.type === 'utterance' && segment.character === expectation.character)) }
    case 'character-doing': {
      if (observation.characters === undefined) return { held: undefined }
      const found = observation.characters.find(character => character.key === expectation.character)
      if (found?.activity === undefined) return { held: undefined }
      const doing = has(found.activity, expectation.text)
      return { held: expectation.not === true ? !doing : doing, found: found.activity }
    }
    case 'player-silent': {
      const spoken = turns.flatMap(turn => turn.segments).filter(segment => segment.type === 'utterance' && segment.character === observation.player)
      return spoken.length === 0 ? { held: true } : { held: false, found: textOf(spoken).slice(0, 200) }
    }
    case 'turns': return { held: observation.turns.length >= expectation.count, found: String(observation.turns.length) }
    case 'value-changed': {
      if (observation.values === undefined || observation.initialValues === undefined) return { held: undefined }
      const matching = (list: NonNullable<Observation['values']>) => list.filter(entry => entry.name === expectation.name && (expectation.of === undefined || entry.of.includes(expectation.of)))
      const before = matching(observation.initialValues)
      const now = matching(observation.values)
      if (now.length === 0) return { held: false, found: 'no such value is shown' }
      const moved = now.filter(entry => before.find(other => other.of.join() === entry.of.join())?.value !== entry.value)
      return moved.length > 0 ? { held: true, found: moved.map(entry => `${entry.of[0] ?? ''} ${entry.value}`).join('; ') } : { held: false, found: now.map(entry => entry.value).join('; ') }
    }
    case 'value-is': {
      if (observation.values === undefined) return { held: undefined }
      const now = observation.values.filter(entry => entry.name === expectation.name && (expectation.of === undefined || entry.of.includes(expectation.of)))
      return { held: now.some(entry => entry.value.includes(expectation.value)), found: now.map(entry => entry.value).join('; ') || 'no such value is shown' }
    }
    case 'trigger-fired': {
      if (observation.triggers === undefined) return { held: undefined }
      const found = observation.triggers.find(trigger => trigger.key === expectation.key)
      return found === undefined ? { held: false, found: 'not in the story' } : { held: found.fired }
    }
    case 'character-at': {
      if (observation.characters === undefined) return { held: undefined }
      const found = observation.characters.find(character => character.key === expectation.character)
      return { held: found === undefined ? false : (found.place === expectation.place) !== (expectation.not === true), found: found === undefined ? 'not in the story' : found.place ?? 'in no place' }
    }
    case 'item-held-by': {
      if (observation.things === undefined) return { held: undefined }
      const found = observation.things.find(thing => thing.key === expectation.item)
      return { held: found?.holder === expectation.holder, found: found === undefined ? 'not in the story' : found.holder }
    }
    case 'no-repeats': {
      const seen = new Set<string>()
      const repeated: string[] = []
      for (const turn of turns) {
        const here = new Set<string>()
        for (const segment of turn.segments) for (const sentence of segment.text.split(/(?<=[.!?。！？])\s*/)) {
          const text = sentence.trim().toLowerCase()
          if (text.length < 12) continue
          if (seen.has(text)) repeated.push(sentence.trim())
          here.add(text)
        }
        for (const text of here) seen.add(text)
      }
      return repeated.length === 0 ? { held: true } : { held: false, found: repeated.slice(0, 3).join(' | ') }
    }
    case 'message-arrived': {
      if (observation.notes === undefined) return { held: undefined }
      const lines = observation.notes.filter(note => note.kind === 'message').flatMap(note => note.lines)
      const names = expectation.character === undefined ? undefined : observation.characters?.find(character => character.key === expectation.character)?.name
      if (expectation.character !== undefined && names === undefined) return { held: undefined }
      const found = names === undefined ? lines : lines.filter(line => line.startsWith(`${names}:`))
      return { held: found.length > 0, found: found.length === 0 ? 'no message' : found.join(' | ').slice(0, 300) }
    }
    case 'opening-has': return observation.opening === undefined ? { held: undefined } : { held: has(observation.opening, expectation.text), found: observation.opening.slice(0, 120) }
    case 'setting-is': {
      if (observation.settings === undefined) return { held: undefined }
      const value = expectation.path.split('.').reduce<unknown>((found, key) => (typeof found === 'object' && found !== null ? (found as Record<string, unknown>)[key] : undefined), observation.settings)
      return { held: String(value) === expectation.value, found: String(value) }
    }
    case 'pack-active': return observation.pack === undefined ? { held: undefined } : { held: observation.pack.active === expectation.id, found: observation.pack.active ?? (observation.pack.problems.join('; ') || 'none') }
    case 'file-has': {
      const text = observation.fileTexts?.[expectation.in]?.[expectation.name]
      if (observation.fileTexts === undefined) return { held: undefined }
      return text === undefined ? { held: false, found: 'no such file' } : { held: has(text, expectation.text), found: text.slice(0, 120) }
    }
    case 'html-sane': {
      const folder = observation.fileTexts?.[expectation.in]
      if (folder === undefined || observation.files === undefined) return { held: undefined }
      const html = folder[expectation.name]
      if (html === undefined) return { held: false, found: 'no such file' }
      const missing: string[] = []
      if (!/<title>[^<]*\S[^<]*<\/title>/i.test(html)) missing.push('a title')
      if (!/<body[\s>]/i.test(html)) missing.push('a body')
      if (!/<\/html>/i.test(html)) missing.push('a closing html tag')
      for (const match of html.matchAll(/(?:href|src)\s*=\s*["']([^"'#?]+)["']/gi)) {
        const target = match[1]!
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) continue
        if (!(observation.files[expectation.in] ?? []).includes(target.replace(/^\.\//, ''))) missing.push(`the file ${target}`)
      }
      return missing.length === 0 ? { held: true } : { held: false, found: `lacks ${missing.join(', ')}` }
    }
    case 'file-exists': case 'file-lacks': {
      const listed = observation.files?.[expectation.in]
      if (listed === undefined) return { held: undefined }
      const there = listed.includes(expectation.name)
      return { held: expectation.type === 'file-exists' ? there : !there, found: listed.join(', ') || 'nothing' }
    }
    case 'cast-distinct': {
      if (observation.characters === undefined || observation.characters.some(character => character.name === undefined)) return { held: undefined }
      const seen = new Map<string, number>()
      for (const character of observation.characters) seen.set(character.name!.trim().toLowerCase(), (seen.get(character.name!.trim().toLowerCase()) ?? 0) + 1)
      const repeated = [...seen].filter(([, count]) => count > 1).map(([name]) => name)
      return repeated.length === 0 ? { held: true } : { held: false, found: `more than one ${repeated.join(', ')}` }
    }
    case 'cast-placed': {
      if (observation.characters === undefined || observation.places === undefined) return { held: undefined }
      if (!observation.places) return { held: true }
      const nowhere = observation.characters.filter(character => !character.placed).map(character => character.name ?? character.key)
      return nowhere.length === 0 ? { held: true } : { held: false, found: `in no place: ${nowhere.join(', ')}` }
    }
    case 'cast-grew': {
      if (observation.characters === undefined || observation.castAtStart === undefined) return { held: undefined }
      const grew = observation.characters.length - observation.castAtStart
      return { held: grew >= expectation.by, found: `${grew} made` }
    }
    case 'character-exists': {
      const found = observation.characters?.find(character => character.key === expectation.character)
      if (observation.characters === undefined) return { held: undefined }
      if (found === undefined) return { held: false, found: 'not in the story' }
      return observation.places === true && !found.placed ? { held: false, found: 'in no place' } : { held: true }
    }
  }
}

/** Every expectation of a script judged on what a run observed: each turn's on that turn, the script's own on the whole story. */
export function evaluate(script: Script, observation: Observation): Verdict[] {
  const verdicts: Verdict[] = []
  script.turns.forEach((turn, index) => {
    const seen = (observation.played ?? observation.turns)[index]
    for (const expectation of turn.expect) verdicts.push({ where: `turn ${index + 1}`, expectation, ...seen === undefined ? { held: undefined, found: 'the turn was not played' } : judge(expectation, observation, [seen]) })
  })
  for (const expectation of script.expect) verdicts.push({ where: 'story', expectation, ...judge(expectation, observation, observation.turns) })
  return verdicts
}

/** The share of the judged expectations that held, or `undefined` when none could be judged (reported not applicable, never 100%). */
export function held(verdicts: readonly Verdict[]): number | undefined {
  const judged = verdicts.filter(verdict => verdict.held !== undefined)
  return judged.length === 0 ? undefined : judged.filter(verdict => verdict.held).length / judged.length
}
