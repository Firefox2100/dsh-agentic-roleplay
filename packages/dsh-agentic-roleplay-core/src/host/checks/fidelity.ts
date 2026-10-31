import { diffText, matchPieces } from '../import/card-diff.ts'
import { baseId, type CardPiece } from '../import/card-tools.ts'
import { mapLimit, trOf, type ImportContext } from '../import/run.ts'
import { CheckSkipped, foundBy, type Check, type CheckInput, type Found } from './check.ts'
import { usedPieces, type CardEvidence } from './card-evidence.ts'
import { folded, shareOf, squashed, termsOf } from './terms.ts'
import { loaded } from './loaded.ts'
import { verdictOf } from './judge.ts'
import { cosine, vectorsOf } from './similar.ts'
import type { WorldText } from './world-text.ts'

/** The most uncovered pieces listed one by one: past that the import itself is the problem. */
const PIECES_LISTED = 12
/** The most numbers one finding lists. */
const NUMBERS_LISTED = 8
/** The most parts of the world a finding names as made from a piece. */
const PARTS_LISTED = 3
/** A changed passage of the new card is taken as reflected in the world when this much of its terms are in what was made from its piece. */
const REFLECTED = 0.5
const MIN_PASSAGE_TERMS = 3
/** A piece with fewer terms than this is a phrase, not a source of facts: its absence proves nothing. */
const MIN_PIECE_TERMS = 4
/** When this share of the checked names is missing from the card, it is the language or the whole card that differs, not each name. */
const MOSTLY_MISSING = 0.5
const MIN_NAMES_FOR_PATTERN = 4
const SNIPPET = 120

const need = (input: CheckInput): CardEvidence => {
  if (input.card === undefined) throw new CheckSkipped('the world has no card to compare with')
  return input.card
}

const recordsNeeded = (evidence: CardEvidence): void => {
  const source = evidence.previous ?? evidence.source
  if (source.records.classified === undefined || source.records.roster === undefined) throw new CheckSkipped('the import left no record of what each piece was taken to be')
}

const snippet = (text: string): string => `${text.replace(/\s+/gu, ' ').trim().slice(0, SNIPPET)}${text.trim().length > SNIPPET ? '…' : ''}`

/** The pieces the import read for the world and the card the records are about. */
const basis = (evidence: CardEvidence) => evidence.previous ?? evidence.source

/** How many of the uncovered pieces are asked about by meaning, largest first. */
const RESCUE_PIECES = 24
/** How many documents of the world are asked about for one piece: the closest in meaning. */
const RESCUE_DOCUMENTS = 3
/** How close in meaning a document is to a piece before it is asked about; low on purpose, the question settles it. */
const RESCUE_CLOSE = 0.5
const RESCUE_CHARS = 1800

const coverage: Check = {
  id: 'card-coverage',
  kit: 'fidelity',
  mode: 'code',
  needs: ['card'],
  description: 'Every piece of the card the import read for the world is in it somewhere: made into a character, place, organisation or thing, or into lore. A piece nothing comes from was lost or left out without a word. With an embedding provider and a model, a piece no part of the world shares words with (a card in another language, a rewrite) is also looked for by meaning before it is called lost.',
  async run(input) {
    const evidence = need(input)
    recordsNeeded(evidence)
    const source = basis(evidence)
    const made = await loaded.made(input, evidence)
    const missing = usedPieces(source).filter(piece => termsOf(piece.text).size >= MIN_PIECE_TERMS && !made.has(baseId(piece.id))).sort((a, b) => b.text.length - a.text.length)
    const { saved, looked, problem } = await sayingByMeaning(input, missing)
    const lost = missing.filter(piece => !saved.has(piece.id))
    const found = lost.slice(0, PIECES_LISTED).map((piece): Found => ({
      severity: 'warning',
      code: 'piece-uncovered',
      where: `card:${piece.id}`,
      message: `${piece.label} (${piece.text.length} characters) was read for the world, but nothing in the world seems to be made from it${looked ? ', by words or by meaning' : ''}`,
      hint: 'Read it with card_read. If it says something about the world, add that where it belongs; if it is not meant for the story, say so.',
    }))
    if (lost.length > PIECES_LISTED) found.push({ severity: 'warning', code: 'pieces-uncovered-more', where: 'card', message: `${lost.length - PIECES_LISTED} more pieces of the card, smaller than these, have nothing in the world made from them`, hint: 'The import probably stopped early or read the card as something else: look at the import report before going through them one by one.' })
    if (problem !== undefined) found.push({ severity: 'info', code: 'meaning-unavailable', where: 'card', message: `the pieces were not looked for by meaning: ${problem}` })
    return foundBy('card-coverage', found)
  },
}

/** The ids of the pieces whose facts a document of the world says in other words (or another language): the closest documents by meaning, and a model's yes. */
async function sayingByMeaning(input: CheckInput, pieces: readonly CardPiece[]): Promise<{ saved: Set<string>; looked: boolean; problem?: string }> {
  const model = input.model
  const saved = new Set<string>()
  if (model?.embed === undefined || pieces.length === 0) return { saved, looked: false }
  try {
    return await lookedByMeaning(input, model, pieces, saved)
  } catch (error) {
    if (model.cancelled?.() === true) throw error
    return { saved, looked: false, problem: error instanceof Error ? error.message : String(error) }
  }
}

async function lookedByMeaning(input: CheckInput, model: ImportContext, pieces: readonly CardPiece[], saved: Set<string>): Promise<{ saved: Set<string>; looked: boolean }> {
  const world = await loaded.text(input)
  const documents = [...world.prose].filter(([, prose]) => prose.trim() !== '')
  if (documents.length === 0) return { saved, looked: false }
  const asked = pieces.slice(0, RESCUE_PIECES)
  const vectors = await vectorsOf(model, input.world.directory, [...asked.map(piece => piece.text.slice(0, RESCUE_CHARS)), ...documents.map(([, prose]) => prose.slice(0, RESCUE_CHARS))])
  if (vectors === undefined) return { saved, looked: false }
  const instructions = model.text('checks/decide-covered')
  await mapLimit(asked, model.concurrency, async (piece, at) => {
    const near = documents.map(([where, prose], index) => ({ where, prose, score: cosine(vectors[at]!, vectors[asked.length + index]!) })).filter(entry => entry.score >= RESCUE_CLOSE).sort((a, b) => b.score - a.score).slice(0, RESCUE_DOCUMENTS)
    for (const document of near) {
      if (model.cancelled?.() === true) return
      const verdict = await verdictOf(model, { passage: piece.text.slice(0, RESCUE_CHARS), document: document.prose.slice(0, RESCUE_CHARS) }, 'covered', instructions, async () => {
        const answer = await model.run<{ reason: string; covered: boolean }>({ persona: instructions, prompt: `${piece.text.slice(0, RESCUE_CHARS)}\n\n${document.prose.slice(0, RESCUE_CHARS)}`, result: COVERED_SCHEMA as never, maxTokens: 500 })
        return answer.covered
      })
      if (verdict.yes) { saved.add(piece.id); return }
    }
  })
  return { saved, looked: true }
}

const COVERED_SCHEMA = { type: 'object', properties: { reason: { type: 'string' }, covered: { type: 'boolean' } }, required: ['reason', 'covered'], additionalProperties: false } as const

const names: Check = {
  id: 'card-names',
  kit: 'fidelity',
  mode: 'code',
  needs: ['card'],
  description: 'Every character, place, organisation and thing of the world is named somewhere in the card (a made-up name is a fact the card does not give).',
  async run(input) {
    const evidence = need(input)
    const source = basis(evidence)
    const world = await loaded.text(input)
    const text = folded([source.card.name, ...source.pieces.map(piece => piece.text)].join('\n'))
    const named = (candidate: string): boolean => {
      const plain = candidate.replace(/\s*[(（][^)）]*[)）]/gu, '').trim()
      return [candidate, plain].some(name => folded(name).trim() !== '' && text.includes(folded(name).trim()))
    }
    const checked = world.names.filter(thing => !thing.playable && thing.names.length > 0)
    const missing = checked.filter(thing => !thing.names.some(named))
    if (checked.length >= MIN_NAMES_FOR_PATTERN && missing.length / checked.length > MOSTLY_MISSING) {
      return foundBy('card-names', [{ severity: 'info', code: 'names-elsewhere', where: '(the world)', message: `${missing.length} of ${checked.length} names do not occur in the card: the world is probably in another language than the card, or was made from another card`, hint: 'Compare by meaning instead; the judged checks do.' }])
    }
    return foundBy('card-names', missing.map((thing): Found => ({
      severity: thing.kind === 'items' ? 'info' : 'warning',
      code: 'name-not-in-card',
      where: thing.where,
      message: `"${thing.names[0]}" does not occur anywhere in the card`,
      hint: 'If the card never names it, it was made up: keep it only if the story needs it, and say it is not from the card.',
    })))
  },
}

const NUMBER = /\p{N}{2,}(?:[.,:]\p{N}+)*/gu

/** The numbers of a piece's text, without those inside the card's macros and addresses. */
export function numbersOf(text: string): string[] {
  const plain = text.replace(/\{\{[\s\S]*?\}\}/gu, ' ').replace(/https?:\/\/\S+/gu, ' ').normalize('NFKC')
  return [...new Set(plain.match(NUMBER) ?? [])]
}

const facts: Check = {
  id: 'card-numbers',
  kit: 'fidelity',
  mode: 'code',
  needs: ['card'],
  description: 'The numbers a piece of the card gives (ages, years, amounts) are in the parts of the world made from it, as the card has them.',
  async run(input) {
    const evidence = need(input)
    recordsNeeded(evidence)
    const source = basis(evidence)
    const world = await loaded.text(input)
    const made = await loaded.made(input, evidence)
    const found: Found[] = []
    for (const piece of usedPieces(source)) {
      const into = made.get(baseId(piece.id))
      if (into === undefined) continue
      const said = into.map(where => world.texts.get(where) ?? '').join('\n').normalize('NFKC')
      const lost = numbersOf(piece.text).filter(number => !said.includes(number))
      if (lost.length > 0) found.push({ severity: 'info', code: 'number-lost', where: `card:${piece.id}`, message: `${piece.label} gives ${lost.slice(0, NUMBERS_LISTED).join(', ')}${lost.length > NUMBERS_LISTED ? ` and ${lost.length - NUMBERS_LISTED} more` : ''}, which ${into.slice(0, PARTS_LISTED).join(', ')}${into.length > PARTS_LISTED ? ` and ${into.length - PARTS_LISTED} more` : ''} do not have`, hint: 'Read the piece with card_read: a number that matters to the story belongs in the world as the card has it.' })
    }
    return foundBy('card-numbers', found)
  },
}

/** Whether what was made from a piece (or, with none, the whole world) says a changed passage. */
function reflected(passage: string, into: readonly string[] | undefined, world: WorldText): boolean {
  const terms = termsOf(passage)
  if (terms.size < MIN_PASSAGE_TERMS) return true
  const said = (into ?? [...world.texts.keys()]).map(where => world.texts.get(where) ?? '').join('\n')
  return shareOf(terms, termsOf(said)) >= REFLECTED
}

const drift: Check = {
  id: 'card-update',
  kit: 'fidelity',
  mode: 'code',
  needs: ['card'],
  description: 'With a newer card waiting: what the new card changed or added that the world does not say yet, and what only a dropped piece made.',
  async run(input) {
    const evidence = need(input)
    if (evidence.previous === undefined) throw new CheckSkipped('no newer card is waiting; ask for the card that is waiting with version new')
    recordsNeeded(evidence)
    const world = await loaded.text(input)
    const made = await loaded.made(input, evidence)
    const match = matchPieces(evidence.previous.pieces, evidence.source.pieces)
    const found: Found[] = []
    for (const { before, after } of match.pairs) {
      const hunks = diffText(before.text, after.text)
      const into = made.get(baseId(before.id))
      if (hunks === undefined) { found.push({ severity: 'info', code: 'too-long-to-compare', where: `card:${after.id}`, message: `${after.label} is too long to compare sentence by sentence`, hint: 'Read both versions with card_read (version current and new).' }); continue }
      for (const hunk of hunks) {
        if (hunk.added.trim() === '' || reflected(hunk.added, into, world)) continue
        found.push({ severity: 'warning', code: 'update-pending', where: `card:${after.id}`, message: `${after.label} now says “${snippet(hunk.added)}”, which the world does not seem to say yet${hunk.removed === '' ? '' : ` (it said “${snippet(hunk.removed)}”)`}`, hint: 'Change what was made from this piece to match, keeping what the person edited.' })
      }
    }
    const everything = [...world.texts.keys()]
    for (const piece of match.added.filter((entry: CardPiece) => entry.used && entry.enabled !== false)) {
      if (!reflected(piece.text, everything, world)) found.push({ severity: 'info', code: 'update-new-piece', where: `card:${piece.id}`, message: `${piece.label} is new in the card and the world does not seem to say it (it may be an instruction rather than the world)` })
    }
    const kept = new Map<string, number>()
    for (const [piece, into] of made) for (const where of into) if (!match.removed.some(entry => baseId(entry.id) === piece)) kept.set(where, (kept.get(where) ?? 0) + 1)
    for (const piece of match.removed) for (const where of made.get(baseId(piece.id)) ?? []) {
      if (!kept.has(where)) found.push({ severity: 'info', code: 'update-dropped', where, message: `${where} was made only from ${piece.label}, which the new card dropped`, hint: 'Remove it unless the person edited it.' })
    }
    return foundBy('card-update', found)
  },
}

/** What one comparison is shown of the source, and how many documents one run compares: a card with more is compared largest source first and the rest is said. */
const SOURCE_CHARS = 6000
const MAX_COMPARED = 40
const MAX_REPORTED = 6

const FIDELITY_SCHEMA = {
  type: 'object',
  properties: {
    dropped: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string' }, quote: { type: 'string' } }, required: ['fact', 'quote'], additionalProperties: false } },
    invented: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string' }, quote: { type: 'string' } }, required: ['fact', 'quote'], additionalProperties: false } },
  },
  required: ['dropped', 'invented'],
  additionalProperties: false,
} as const

interface Reported { fact: string; quote: string }

/** Why the comparison cannot be used: a quote that is not in the text it is said to come from is a guess, not a finding. */
export function comparisonProblem(value: { dropped: Reported[]; invented: Reported[] }, source: string, document: string): string | undefined {
  if (value.dropped.length > MAX_REPORTED || value.invented.length > MAX_REPORTED) return `report at most ${MAX_REPORTED} of each`
  const missing = (list: Reported[], text: string): boolean => list.some(entry => entry.fact.trim() === '' || !squashed(text).includes(squashed(entry.quote)) || squashed(entry.quote) === '')
  if (missing(value.dropped, source)) return 'the quote of every dropped fact must be a passage of the source, exactly as it is written there'
  if (missing(value.invented, document)) return 'the quote of every invented fact must be a passage of the document, exactly as it is written there'
  return undefined
}

const compared: Check = {
  id: 'card-fidelity',
  kit: 'fidelity',
  mode: 'judged',
  needs: ['card', 'model'],
  description: 'For each character, place, organisation, thing and background entry made from the card: facts the card states that the document lost, and facts the document states that the card does not give, each with the quoted passage.',
  async run(input) {
    const evidence = need(input)
    recordsNeeded(evidence)
    const model = input.model!
    const tr = trOf(model)
    const source = basis(evidence)
    const world = await loaded.text(input)
    const made = await loaded.made(input, evidence, 'about')
    const from = new Map<string, CardPiece[]>()
    for (const piece of usedPieces(source)) for (const where of made.get(baseId(piece.id)) ?? []) from.set(where, [...from.get(where) ?? [], piece])
    const ranked = [...from].map(([where, pieces]) => ({ where, pieces, size: pieces.reduce((sum, piece) => sum + piece.text.length, 0) })).sort((a, b) => b.size - a.size)
    const chosen = ranked.slice(0, MAX_COMPARED)
    const found: Found[] = []
    if (ranked.length > chosen.length) found.push({ severity: 'info', code: 'not-compared', where: '(the world)', message: `${ranked.length - chosen.length} more documents were not compared: a run compares at most ${MAX_COMPARED}, the ones with the most source first`, hint: 'Compare the rest with check_card again after fixing these, or read them against the card yourself.' })
    await mapLimit(chosen, model.concurrency, async ({ where, pieces }) => {
      if (model.cancelled?.() === true) return
      const document = world.prose.get(where) ?? ''
      const subject = world.subjects.get(where) ?? where
      const text = pieces.map(piece => `[${piece.label}]\n${piece.text.slice(0, SOURCE_CHARS)}`).join('\n\n').slice(0, SOURCE_CHARS * 2)
      try {
        const answer = await model.run<{ dropped: Reported[]; invented: Reported[] }>({
          persona: model.text('checks/fidelity'), prompt: `${tr('Source pieces:')}\n${text}\n\n${tr('Document ({where}), about {subject}:', { where, subject })}\n${document}`, result: FIDELITY_SCHEMA as never, maxTokens: 1500,
          check: value => comparisonProblem(value, text, document),
        })
        const once = (list: Reported[]): Reported[] => list.filter((entry, at) => list.findIndex(other => squashed(other.quote) === squashed(entry.quote)) === at)
        for (const entry of once(answer.dropped)) found.push({ severity: 'warning', code: 'fact-dropped', where, message: `the card says “${snippet(entry.quote)}” (${entry.fact}), which ${where} does not say`, hint: 'Read the piece with card_read; if the fact matters to the story, add it to the document as the card has it.' })
        for (const entry of once(answer.invented)) found.push({ severity: 'warning', code: 'fact-invented', where, message: `${where} says “${snippet(entry.quote)}” (${entry.fact}), which the card does not give`, hint: 'Remove it unless the person wants it; the world should not state what its source does not.' })
      } catch (error) {
        if (model.cancelled?.() === true) throw error
        found.push({ severity: 'info', code: 'not-compared', where, message: `${where} could not be compared: ${error instanceof Error ? error.message : String(error)}` })
      }
    })
    return foundBy('card-fidelity', found)
  },
}

export const fidelityChecks: readonly Check[] = [coverage, names, facts, drift, compared]
