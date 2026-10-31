import { mapLimit, norm } from '../import/run.ts'
import { CheckSkipped, foundBy, type Check, type Found } from './check.ts'
import { verdictOf } from './judge.ts'
import { loaded } from './loaded.ts'

/** A place described in fewer characters than this has nothing to play with. */
const THIN_PLACE = 20
const SHEET_CHARS = 3000
const DIGEST_CHARS = 7000
const GAPS_LISTED = 8

const text = (value: string | undefined): string => (value ?? '').trim()

const cast: Check = {
  id: 'quality-cast',
  kit: 'quality',
  mode: 'code',
  needs: [],
  description: 'Whether the cast can be played: someone to play, sheets with more than a summary for the characters that matter, voices, and characters that are one description twice.',
  async run(input) {
    const { characters } = await loaded.characters(input)
    if (characters.length === 0) throw new CheckSkipped('the world has no characters yet')
    const found: Found[] = []
    if (!characters.some(character => character.role === 'playable')) found.push({ severity: 'warning', code: 'no-playable', where: 'characters', message: 'no character can be played, so a story from this world needs an avatar brought along', hint: 'Make one character playable, or add one for the player.' })
    const seen = new Map<string, string>()
    for (const character of characters) {
      const where = `characters/${character.id}`
      const main = character.tier !== 'background' && character.kind === 'person'
      if (main && text(character.personality) === '' && text(character.background) === '' && text(character.speech.style) === '') found.push({ severity: 'warning', code: 'sheet-summary-only', where, message: `${character.name} has only a summary: no personality, background or way of speaking`, hint: 'Write from what the card or the world says about them; do not make them up.' })
      else if (main && text(character.speech.style) === '' && character.speech.examples.length === 0) found.push({ severity: 'info', code: 'no-voice', where, message: `${character.name} has no stated way of speaking` })
      const summary = norm(character.summary)
      if (summary !== '') {
        const other = seen.get(summary)
        if (other !== undefined) found.push({ severity: 'warning', code: 'same-summary', where, message: `${character.name} and ${other} have the same summary, so they may be one character written twice`, hint: 'Merge them, or tell them apart.' })
        else seen.set(summary, character.name)
      }
    }
    return foundBy('quality-cast', found)
  },
}

const places: Check = {
  id: 'quality-places',
  kit: 'quality',
  mode: 'code',
  needs: [],
  description: 'Places with no description, or one too short to play in.',
  async run(input) {
    const { locations } = await loaded.locations(input)
    return foundBy('quality-places', locations.flatMap((place): Found[] => {
      const length = text(place.description).length
      if (length === 0) return [{ severity: 'warning', code: 'place-undescribed', where: `locations/${place.id}`, message: `${place.name} has no description` }]
      return length < THIN_PLACE && place.features.length === 0 ? [{ severity: 'info', code: 'place-thin', where: `locations/${place.id}`, message: `${place.name} has a one-line description and no features` }] : []
    }))
  },
}

const about: Check = {
  id: 'quality-world',
  kit: 'quality',
  mode: 'code',
  needs: [],
  description: 'What the world says about itself: a description, tags for the catalogue, an opening for the story.',
  async run(input) {
    const info = await loaded.info(input)
    const found: Found[] = []
    if (text(info.description) === '') found.push({ severity: 'info', code: 'no-description', where: 'world.json', message: 'the world has no description, so the worlds list shows nothing about it' })
    if (info.tags.length === 0) found.push({ severity: 'info', code: 'no-tags', where: 'world.json', message: 'the world has no tags' })
    if (text(info.opening) === '' && !info.openingParts) found.push({ severity: 'info', code: 'no-opening', where: 'world.json', message: 'the world has no opening, so a story starts with "The story begins."' })
    return foundBy('quality-world', found)
  },
}

const SHEET_SCHEMA = { type: 'object', properties: { reason: { type: 'string' }, playable: { type: 'boolean' } }, required: ['reason', 'playable'], additionalProperties: false } as const

const sheets: Check = {
  id: 'sheet-playable',
  kit: 'quality',
  mode: 'decision',
  needs: ['model'],
  description: 'Whether each principal or supporting character\'s sheet is enough to play them (who they are, how they talk, what they want). A decision model may answer; what it is unsure of goes to the language model.',
  async run(input) {
    const { model } = input
    const { characters } = await loaded.characters(input)
    const asked = characters.filter(character => character.tier !== 'background' && character.kind === 'person')
    const found: Found[] = []
    await mapLimit(asked, model!.concurrency, async (character) => {
      const sheet = [`name: ${character.name}`, `summary: ${character.summary}`, `personality: ${character.personality}`, `background: ${character.background}`, `speech: ${character.speech.style}`, ...character.speech.examples.slice(0, 3).map(example => `says: ${example}`), ...(character.start.intents ?? []).slice(0, 3).map(intent => `wants: ${intent.name}: ${intent.description}`)].join('\n').slice(0, SHEET_CHARS)
      let reason = ''
      const instructions = model!.text('checks/decide-sheet')
      const verdict = await verdictOf(model!, { sheet }, 'playable', instructions, async () => {
        const answer = await model!.run<{ reason: string; playable: boolean }>({ persona: instructions, prompt: sheet, result: SHEET_SCHEMA as never, maxTokens: 500 })
        reason = answer.reason
        return answer.playable
      })
      if (!verdict.yes) found.push({ severity: 'warning', code: 'sheet-thin', where: `characters/${character.id}`, message: `${character.name}'s sheet is not enough to play them${reason === '' ? '' : `: ${reason}`}`, hint: 'Fill it in from the card or the world, or ask the person; do not make them up.' })
    })
    return foundBy('sheet-playable', found)
  },
}

const GAPS_SCHEMA = {
  type: 'object',
  properties: { gaps: { type: 'array', items: { type: 'object', properties: { about: { type: 'string' }, gap: { type: 'string' }, fill: { type: 'string' } }, required: ['about', 'gap', 'fill'], additionalProperties: false } } },
  required: ['gaps'],
  additionalProperties: false,
} as const

const gaps: Check = {
  id: 'world-gaps',
  kit: 'quality',
  mode: 'judged',
  needs: ['model'],
  description: 'What a model reading a digest of the world finds missing for it to play well: places with nothing to do, conflicts nobody carries, openings the world never sets up.',
  async run(input) {
    const { world, model } = input
    const [{ characters }, { locations }, { factions }, { lore }, { defs }] = await Promise.all([loaded.characters(input), loaded.locations(input), loaded.factions(input), loaded.lore(input), loaded.variables(input)])
    const named = new Map<string, string>()
    for (const [kind, entries] of [['character', characters.map(entry => ({ id: entry.id, name: entry.name }))], ['place', locations.map(entry => ({ id: entry.id, name: entry.name }))], ['organisation', factions.map(entry => ({ id: entry.id, name: entry.name }))], ['background', lore.map(entry => ({ id: entry.id, name: entry.title }))]] as const) {
      for (const entry of entries) for (const label of [entry.id, entry.name, `${kind} ${entry.id}`, `${kind} ${entry.name}`]) named.set(norm(label), entry.id)
    }
    /** What the model named, as the key of that thing; anything else is about the world as a whole. */
    const keyOf = (about: string): string => named.get(norm(about)) ?? '(the world)'
    const digest = [
      `world: ${world.summary.name}: ${text((await loaded.info(input)).description)}`,
      ...characters.map(entry => `character ${entry.id} (${entry.role}, ${entry.tier}): ${entry.name}: ${entry.summary}`),
      ...locations.map(entry => `place ${entry.id}: ${entry.name}: ${text(entry.description).slice(0, 160)} (${entry.exits.length} ways out)`),
      ...factions.map(entry => `organisation ${entry.id}: ${entry.name}: ${entry.summary}`),
      ...lore.map(entry => `background ${entry.id}: ${entry.title}: ${entry.summary}`),
      ...(defs.length === 0 ? [] : [`tracked values: ${defs.map(def => def.key).join(', ')}`]),
    ].join('\n').slice(0, DIGEST_CHARS)
    const answer = await model!.run<{ gaps: { about: string; gap: string; fill: string }[] }>({
      persona: model!.text('checks/gaps'), prompt: digest, result: GAPS_SCHEMA as never, maxTokens: 1500,
      check: value => (value.gaps.length > GAPS_LISTED ? `name at most ${GAPS_LISTED} gaps` : value.gaps.some(gap => text(gap.gap) === '' || text(gap.fill) === '') ? 'every gap says what is missing and what would fill it' : undefined),
    })
    return foundBy('world-gaps', answer.gaps.map((gap): Found => ({ severity: 'info', code: 'gap', where: keyOf(gap.about), message: gap.gap, hint: gap.fill })))
  },
}

export const qualityChecks: readonly Check[] = [cast, places, about, sheets, gaps]
