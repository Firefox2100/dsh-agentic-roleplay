import { describe, expect, it } from 'vitest'
import type { RequestOption } from '@dsh-ai-providers/core'
import { FAST_PRESET, FORM_FIELDS, boundsOf, fromDrafts, keyOf, optionKey, problemsOf, toDrafts } from '../../../src/client/settings-form/fields.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../../src/shared/settings.ts'

describe('the settings form', () => {
  it('has a fast preset made of valid settings of the form', () => {
    const drafts = { ...toDrafts(DEFAULT_SETTINGS), ...FAST_PRESET }
    expect(Object.keys(FAST_PRESET).every(key => FORM_FIELDS.some(field => keyOf(field) === key))).toBe(true)
    expect(problemsOf(drafts).size).toBe(0)
    const settings = fromDrafts(DEFAULT_SETTINGS, drafts)
    expect(parseSettings(settings).ok).toBe(true)
    expect(settings).toMatchObject({ maxRounds: 2, maxCharacters: 3, preview: { enabled: false }, memory: { verify: false, lookup: false }, authoring: { enabled: false }, reasoning: { children: 'off' }, offstage: { perTurn: 0 }, reflection: { auto: false } })
  })

  it('starts from the settings, with a share shown as a percentage', () => {
    expect(toDrafts(DEFAULT_SETTINGS)).toEqual({ maxRounds: '3', maxCharacters: '4', 'memory.flaky': true, 'memory.foldedFade': '0.5', 'memory.recall': '12', 'memory.overRetrieve': '4', 'memory.associate': '2', 'memory.diversity': '0.3', 'memory.lookup': true, 'memory.lookupCalls': '5', 'memory.verify': true, 'memory.backlogRounds': '6', 'authoring.enabled': true, 'authoring.perTurn': '2', 'authoring.thingsPerTurn': '4', 'authoring.consolidateAfter': '3', 'clock.mode': 'simulated', 'clock.timeZone': '', 'clock.roundSeconds': '30', 'clock.maxSkipDays': '30', 'rules.own': '', 'prompts.language': 'en', 'reasoning.children': '', 'factions.perTurn': '1', 'factions.everyDays': '3', 'reflection.auto': true, 'reflection.everyTurns': '20', 'reflection.onSceneChange': true, 'reflection.sceneDays': '1', 'reflection.minTurns': '5', 'reflection.perRun': '3', 'reflection.minNew': '4', 'models.characters': '', 'models.background': '', 'models.records': '', 'models.suggestions': '', 'models.authoring': '', 'triggers.enabled': true, 'triggers.maxFires': '3', 'triggers.beatTurns': '3', 'triggers.judgedPerTurn': '2', 'decisions.triggers': 'llm', 'decisions.reflection': 'llm', 'decisions.agency': 'off', 'decisions.refusal': 'off', 'decisions.rules': 'off', 'decisions.secrets': 'off', 'decisions.gateThreshold': '0.5', 'decisions.confidence': '0.7', 'interface.pack': '', 'rewind.keepSnapshots': '30', 'preview.enabled': true, 'dice.visibility': 'card', 'suggestions.count': '3', 'images.mode': 'manual', 'images.references': 'prefer-reference', 'images.reuse': true, 'images.highRes': false, 'images.interpret': true, 'images.interpreterModel': '', 'images.captioner': '', 'sampling.master': '0.7', 'sampling.characters': '0.8', 'sampling.topP': '1', 'sampling.topK': '0', 'sampling.minP': '0', 'sampling.frequencyPenalty': '0', 'sampling.presencePenalty': '0', 'sampling.repetitionPenalty': '1', 'sampling.suggestions': '0.2', 'sampling.authoring': '0.4', 'sampling.records': '0.1', 'background.concurrent': false, 'offstage.perTurn': '2', 'offstage.perCharacter': '1', 'offstage.joint': true, 'offstage.summary': true, 'context.limitTokens': '0', 'context.limitRatio': '60', 'context.workingTokens': '0', 'context.retainRatio': '50', 'diagnostics.keepRuns': false })
  })

  it('gives back settings that parse, with what the form does not show left as it was', () => {
    const base = { ...DEFAULT_SETTINGS, context: { ...DEFAULT_SETTINGS.context, shortTermTokens: 999 } }
    const drafts = { ...toDrafts(base), maxRounds: '5', 'memory.flaky': false, 'context.retainRatio': '30' }
    const next = fromDrafts(base, drafts)
    expect(next).toMatchObject({ maxRounds: 5, memory: { flaky: false }, context: { retainRatio: 0.3, shortTermTokens: 999 } })
    expect(parseSettings(next).ok).toBe(true)
    expect(base.maxRounds).toBe(3)
  })

  it('finds the values that are out of bounds or not numbers', () => {
    const drafts = toDrafts(DEFAULT_SETTINGS)
    expect([...problemsOf(drafts)]).toEqual([])
    expect([...problemsOf({ ...drafts, maxRounds: '0', 'memory.recall': '2.5', 'context.limitTokens': '', 'context.retainRatio': '95' })].sort()).toEqual(['context.limitTokens', 'context.retainRatio', 'maxRounds', 'memory.recall'])
  })

  it('takes a choice and a time zone as typed, and finds a zone that does not exist', () => {
    const base = DEFAULT_SETTINGS
    const drafts = { ...toDrafts(base), 'clock.mode': 'real', 'clock.timeZone': ' Europe/London ' }
    expect(fromDrafts(base, drafts).clock).toMatchObject({ mode: 'real', timeZone: 'Europe/London' })
    expect(parseSettings(fromDrafts(base, drafts)).ok).toBe(true)
    expect([...problemsOf(drafts)]).toEqual([])
    expect([...problemsOf({ ...drafts, 'clock.timeZone': 'Mars/Olympus' })]).toEqual(['clock.timeZone'])
    expect([...problemsOf({ ...drafts, 'clock.timeZone': '', 'clock.roundSeconds': '4000' })]).toEqual(['clock.roundSeconds'])
  })

  it('finds a model that is not written provider/model', () => {
    const drafts = toDrafts(DEFAULT_SETTINGS)
    expect(problemsOf({ ...drafts, 'models.records': 'localai/qwen' }).size).toBe(0)
    expect([...problemsOf({ ...drafts, 'models.records': 'qwen' })]).toEqual(['models.records'])
  })

  it('takes its bounds from the settings themselves', () => {
    const retain = FORM_FIELDS.find(field => keyOf(field) === 'context.retainRatio')!
    expect(boundsOf(retain)).toEqual({ min: 10, max: 90 })
    expect(boundsOf(FORM_FIELDS[0]!)).toEqual({ min: 1, max: 10 })
  })
})

describe('the request options of the embedding provider in the form', () => {
  const options: RequestOption[] = [
    { key: 'dimensions', type: 'integer', label: 'Dimensions', min: 1, max: 4096, atStart: true },
    { key: 'user', type: 'string', label: 'User' },
    { key: 'normalize', type: 'boolean', label: 'Normalize' },
    { key: 'temperature', type: 'number', label: 'T', min: 0 },
  ]

  it('start empty, so that the provider\'s own setting applies, and show what the chat already chose', () => {
    expect(toDrafts(DEFAULT_SETTINGS, options)).toMatchObject({ 'embedding.options.dimensions': '', 'embedding.options.user': '', 'embedding.options.normalize': false, 'embedding.options.temperature': '' })
    const chosen = { ...DEFAULT_SETTINGS, embedding: { options: { dimensions: 256, user: 'u', normalize: true } } }
    expect(toDrafts(chosen, options)).toMatchObject({ 'embedding.options.dimensions': '256', 'embedding.options.user': 'u', 'embedding.options.normalize': true })
    expect(optionKey(options[0]!)).toBe('embedding.options.dimensions')
  })

  it('are written typed, left out when empty, and options the form does not offer are kept', () => {
    const base = { ...DEFAULT_SETTINGS, embedding: { options: { dimensions: 64, other: 'kept' } } }
    const drafts = { ...toDrafts(base, options), 'embedding.options.dimensions': '', 'embedding.options.user': ' me ', 'embedding.options.normalize': true, 'embedding.options.temperature': '0.5' }
    const next = fromDrafts(base, drafts, options)
    expect(next.embedding.options).toEqual({ other: 'kept', user: 'me', normalize: true, temperature: 0.5 })
    expect(parseSettings(next).ok).toBe(true)
    expect(fromDrafts(DEFAULT_SETTINGS, toDrafts(DEFAULT_SETTINGS, options), options).embedding.options).toEqual({ normalize: false })
    expect(base.embedding.options).toEqual({ dimensions: 64, other: 'kept' })
  })

  it('are checked against what the provider says about them', () => {
    const drafts = toDrafts(DEFAULT_SETTINGS, options)
    expect([...problemsOf(drafts, options)]).toEqual([])
    expect([...problemsOf({ ...drafts, 'embedding.options.dimensions': '2.5', 'embedding.options.temperature': '-1' }, options)].sort()).toEqual(['embedding.options.dimensions', 'embedding.options.temperature'])
    expect([...problemsOf({ ...drafts, 'embedding.options.dimensions': '5000' }, options)]).toEqual(['embedding.options.dimensions'])
    expect([...problemsOf({ ...drafts, 'embedding.options.dimensions': '0' }, options)]).toEqual(['embedding.options.dimensions'])
  })
})
