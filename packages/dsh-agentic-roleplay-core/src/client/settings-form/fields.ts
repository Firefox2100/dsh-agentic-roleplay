import type { RequestOption } from '@dsh-ai-providers/core'
import { MODEL_NAME, SETTINGS_SPEC, isTimeZone, type ChatSettings, type EmbeddingOptions, type EmbeddingValue } from '../../shared/settings.ts'

/** The settings the form offers, in the order shown. The rest are in the settings file. */
export const FORM_FIELDS = [
  { path: ['maxRounds'], kind: 'integer', label: 'maxRounds', help: 'maxRoundsHelp' },
  { path: ['maxCharacters'], kind: 'integer', label: 'maxCharacters', help: 'maxCharactersHelp' },
  { path: ['memory', 'flaky'], kind: 'flag', label: 'flaky', help: 'flakyHelp' },
  { path: ['memory', 'recall'], kind: 'integer', label: 'recall', help: 'recallHelp' },
  { path: ['memory', 'overRetrieve'], kind: 'integer', label: 'overRetrieve', help: 'overRetrieveHelp' },
  { path: ['memory', 'associate'], kind: 'integer', label: 'associate', help: 'associateHelp' },
  { path: ['memory', 'diversity'], kind: 'decimal', label: 'diversity', help: 'diversityHelp' },
  { path: ['memory', 'foldedFade'], kind: 'decimal', label: 'foldedFade', help: 'foldedFadeHelp' },
  { path: ['memory', 'lookup'], kind: 'flag', label: 'lookup', help: 'lookupHelp' },
  { path: ['memory', 'lookupCalls'], kind: 'integer', label: 'lookupCalls', help: 'lookupCallsHelp' },
  { path: ['memory', 'verify'], kind: 'flag', label: 'verify', help: 'verifyHelp' },
  { path: ['memory', 'backlogRounds'], kind: 'integer', label: 'backlogRounds', help: 'backlogRoundsHelp' },
  { path: ['authoring', 'enabled'], kind: 'flag', label: 'authoringEnabled', help: 'authoringEnabledHelp' },
  { path: ['authoring', 'perTurn'], kind: 'integer', label: 'authoringPerTurn', help: 'authoringPerTurnHelp' },
  { path: ['authoring', 'thingsPerTurn'], kind: 'integer', label: 'authoringThings', help: 'authoringThingsHelp' },
  { path: ['authoring', 'consolidateAfter'], kind: 'integer', label: 'consolidateAfter', help: 'consolidateAfterHelp' },
  { path: ['clock', 'mode'], kind: 'choice', label: 'clockMode', help: 'clockModeHelp', choices: [{ value: 'simulated', label: 'clockSimulated' }, { value: 'real', label: 'clockReal' }] },
  { path: ['clock', 'timeZone'], kind: 'text', label: 'clockTimeZone', help: 'clockTimeZoneHelp', zone: true, placeholder: 'UTC' },
  { path: ['clock', 'roundSeconds'], kind: 'integer', label: 'clockRoundSeconds', help: 'clockRoundSecondsHelp' },
  { path: ['clock', 'maxSkipDays'], kind: 'integer', label: 'clockMaxSkipDays', help: 'clockMaxSkipDaysHelp' },
  { path: ['rules', 'own'], kind: 'text', label: 'rulesOwn', help: 'rulesOwnHelp', zone: false, placeholder: '', rows: 4 },
  { path: ['prompts', 'language'], kind: 'text', label: 'promptsLanguage', help: 'promptsLanguageHelp', zone: false, placeholder: 'en' },
  { path: ['reasoning', 'children'], kind: 'text', label: 'reasoningChildren', help: 'reasoningChildrenHelp', zone: false, placeholder: 'off' },
  { path: ['factions', 'perTurn'], kind: 'integer', label: 'factionsPerTurn', help: 'factionsPerTurnHelp' },
  { path: ['factions', 'everyDays'], kind: 'integer', label: 'factionsEveryDays', help: 'factionsEveryDaysHelp' },
  { path: ['reflection', 'auto'], kind: 'flag', label: 'reflectionAuto', help: 'reflectionAutoHelp' },
  { path: ['reflection', 'everyTurns'], kind: 'integer', label: 'reflectionEveryTurns', help: 'reflectionEveryTurnsHelp' },
  { path: ['reflection', 'onSceneChange'], kind: 'flag', label: 'reflectionOnScene', help: 'reflectionOnSceneHelp' },
  { path: ['reflection', 'sceneDays'], kind: 'integer', label: 'reflectionSceneDays', help: 'reflectionSceneDaysHelp' },
  { path: ['reflection', 'minTurns'], kind: 'integer', label: 'reflectionMinTurns', help: 'reflectionMinTurnsHelp' },
  { path: ['reflection', 'perRun'], kind: 'integer', label: 'reflectionPerRun', help: 'reflectionPerRunHelp' },
  { path: ['reflection', 'minNew'], kind: 'integer', label: 'reflectionMinNew', help: 'reflectionMinNewHelp' },
  { path: ['models', 'characters'], kind: 'text', label: 'modelsCharacters', help: 'modelsCharactersHelp', zone: false, placeholder: 'localai/model-id' },
  { path: ['models', 'background'], kind: 'text', label: 'modelsBackground', help: 'modelsBackgroundHelp', zone: false, placeholder: 'localai/model-id' },
  { path: ['models', 'records'], kind: 'text', label: 'modelsRecords', help: 'modelsRecordsHelp', zone: false, placeholder: 'localai/model-id' },
  { path: ['models', 'suggestions'], kind: 'text', label: 'modelsSuggestions', help: 'modelsSuggestionsHelp', zone: false, placeholder: 'localai/model-id' },
  { path: ['models', 'authoring'], kind: 'text', label: 'modelsAuthoring', help: 'modelsAuthoringHelp', zone: false, placeholder: 'localai/model-id' },
  { path: ['triggers', 'enabled'], kind: 'flag', label: 'triggersEnabled', help: 'triggersEnabledHelp' },
  { path: ['triggers', 'maxFires'], kind: 'integer', label: 'triggersMaxFires', help: 'triggersMaxFiresHelp' },
  { path: ['triggers', 'judgedPerTurn'], kind: 'integer', label: 'triggersJudged', help: 'triggersJudgedHelp' },
  { path: ['triggers', 'beatTurns'], kind: 'integer', label: 'triggersBeatTurns', help: 'triggersBeatTurnsHelp' },
  { path: ['rewind', 'keepSnapshots'], kind: 'integer', label: 'rewindKeep', help: 'rewindKeepHelp' },
  { path: ['preview', 'enabled'], kind: 'flag', label: 'previewEnabled', help: 'previewEnabledHelp' },
  { path: ['suggestions', 'count'], kind: 'integer', label: 'suggestionsCount', help: 'suggestionsCountHelp' },
  { path: ['dice', 'visibility'], kind: 'choice', label: 'diceVisibility', help: 'diceVisibilityHelp', choices: [{ value: 'hidden', label: 'diceHidden' }, { value: 'card', label: 'diceCard' }] },
  { path: ['images', 'mode'], kind: 'choice', label: 'imagesMode', help: 'imagesModeHelp', choices: [{ value: 'off', label: 'imagesOff' }, { value: 'manual', label: 'imagesManual' }, { value: 'every-turn', label: 'imagesEveryTurn' }] },
  { path: ['images', 'references'], kind: 'choice', label: 'imageReferences', help: 'imageReferencesHelp', choices: [{ value: 'text-only', label: 'imageReferencesText' }, { value: 'prefer-reference', label: 'imageReferencesPrefer' }, { value: 'require-reference', label: 'imageReferencesRequire' }] },
  { path: ['images', 'reuse'], kind: 'flag', label: 'imagesReuse', help: 'imagesReuseHelp' },
  { path: ['images', 'highRes'], kind: 'flag', label: 'imagesHighRes', help: 'imagesHighResHelp' },
  { path: ['images', 'interpret'], kind: 'flag', label: 'imagesInterpret', help: 'imagesInterpretHelp' },
  { path: ['images', 'interpreterModel'], kind: 'text', label: 'imagesInterpreterModel', help: 'imagesInterpreterModelHelp', zone: false, placeholder: 'localai/model-id' },
  { path: ['images', 'captioner'], kind: 'text', label: 'imagesCaptioner', help: 'imagesCaptionerHelp', zone: false, placeholder: 'localai/joycaption' },
  { path: ['sampling', 'master'], kind: 'decimal', label: 'samplingMaster', help: 'samplingMasterHelp' },
  { path: ['sampling', 'characters'], kind: 'decimal', label: 'samplingCharacters', help: 'samplingCharactersHelp' },
  { path: ['sampling', 'topP'], kind: 'decimal', label: 'samplingTopP', help: 'samplingTopPHelp' },
  { path: ['sampling', 'topK'], kind: 'integer', label: 'samplingTopK', help: 'samplingTopKHelp' },
  { path: ['sampling', 'minP'], kind: 'decimal', label: 'samplingMinP', help: 'samplingMinPHelp' },
  { path: ['sampling', 'frequencyPenalty'], kind: 'decimal', label: 'samplingFrequencyPenalty', help: 'samplingFrequencyPenaltyHelp' },
  { path: ['sampling', 'presencePenalty'], kind: 'decimal', label: 'samplingPresencePenalty', help: 'samplingPresencePenaltyHelp' },
  { path: ['sampling', 'repetitionPenalty'], kind: 'decimal', label: 'samplingRepetitionPenalty', help: 'samplingRepetitionPenaltyHelp' },
  { path: ['sampling', 'suggestions'], kind: 'decimal', label: 'samplingSuggestions', help: 'samplingSuggestionsHelp' },
  { path: ['sampling', 'authoring'], kind: 'decimal', label: 'samplingAuthoring', help: 'samplingAuthoringHelp' },
  { path: ['sampling', 'records'], kind: 'decimal', label: 'samplingRecords', help: 'samplingRecordsHelp' },
  { path: ['offstage', 'perTurn'], kind: 'integer', label: 'offstagePerTurn', help: 'offstagePerTurnHelp' },
  { path: ['offstage', 'perCharacter'], kind: 'integer', label: 'offstagePerCharacter', help: 'offstagePerCharacterHelp' },
  { path: ['offstage', 'joint'], kind: 'flag', label: 'offstageJoint', help: 'offstageJointHelp' },
  { path: ['offstage', 'summary'], kind: 'flag', label: 'offstageSummary', help: 'offstageSummaryHelp' },
  { path: ['context', 'limitTokens'], kind: 'integer', label: 'limitTokens', help: 'limitTokensHelp' },
  { path: ['context', 'limitRatio'], kind: 'percent', label: 'limitRatio', help: 'limitRatioHelp' },
  { path: ['context', 'retainRatio'], kind: 'percent', label: 'retainRatio', help: 'retainRatioHelp' },
  { path: ['interface', 'pack'], kind: 'text', label: 'interfacePack', help: 'interfacePackHelp', zone: false, placeholder: 'none' },
  { path: ['diagnostics', 'keepRuns'], kind: 'flag', label: 'diagnosticsKeepRuns', help: 'diagnosticsKeepRunsHelp' },
] as const

/**
 * Settings that trade depth for speed: no thinking for the helper agents, no scene preview, no verification pass, no memory look-ups by
 * characters, fewer and smaller rounds, no off-stage rounds and a closed world (nothing is made up in play). Keys are those of the form.
 */
export const FAST_PRESET: Drafts = {
  'reasoning.children': 'off', 'preview.enabled': false, 'memory.verify': false, 'memory.lookup': false, maxRounds: '2', maxCharacters: '3', 'offstage.perTurn': '0', 'authoring.enabled': false, 'reflection.auto': false,
}

export type FormField = (typeof FORM_FIELDS)[number]
export type Drafts = Record<string, string | boolean>

export const keyOf = (field: Pick<FormField, 'path'>): string => field.path.join('.')

type Node = Record<string, unknown>

function read(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => (node as Node)[key], root)
}

/** The key of the draft of one request option of the embedding provider. */
export const optionKey = (option: Pick<RequestOption, 'key'>): string => `embedding.options.${option.key}`

/** What each setting of the form starts as, and each request option the embedding provider offers. */
export function toDrafts(settings: ChatSettings, options: readonly RequestOption[] = []): Drafts {
  const fixed = FORM_FIELDS.map((field) => {
    const value = read(settings, field.path)
    return [keyOf(field), field.kind === 'flag' ? value === true : field.kind === 'percent' ? String(Math.round((value as number) * 100)) : String(value)] as const
  })
  const requested = options.map((option) => {
    const value = settings.embedding.options[option.key]
    return [optionKey(option), option.type === 'boolean' ? value === true : value === undefined ? '' : String(value)] as const
  })
  return Object.fromEntries([...fixed, ...requested])
}

/** The bounds of a field as the form shows them: percentages for a share. */
export function boundsOf(field: FormField): { min: number; max: number } {
  const spec = read(SETTINGS_SPEC, field.path) as { min?: number; max?: number }
  return field.kind === 'percent' ? { min: Math.round((spec.min ?? 0) * 100), max: Math.round((spec.max ?? 1) * 100) } : { min: spec.min ?? 0, max: spec.max ?? 0 }
}

/** Whether a draft can be saved: the keys of the values that cannot. */
export function problemsOf(drafts: Drafts, options: readonly RequestOption[] = []): Set<string> {
  const bad = new Set<string>()
  for (const option of options) {
    const draft = drafts[optionKey(option)]
    if (option.type === 'boolean' || option.type === 'string' || typeof draft !== 'string' || draft.trim() === '') continue
    const value = Number(draft)
    if (!Number.isFinite(value) || (option.type === 'integer' && !Number.isInteger(value)) || (option.min !== undefined && value < option.min) || (option.max !== undefined && value > option.max)) bad.add(optionKey(option))
  }
  for (const field of FORM_FIELDS) {
    if (field.kind === 'flag' || field.kind === 'choice') continue
    if (field.kind === 'text') {
      const draft = drafts[keyOf(field)]
      if (field.zone && typeof draft === 'string' && draft.trim() !== '' && !isTimeZone(draft.trim())) bad.add(keyOf(field))
      if (field.path[0] === 'models' && typeof draft === 'string' && draft.trim() !== '' && !MODEL_NAME.test(draft.trim())) bad.add(keyOf(field))
      continue
    }
    const draft = drafts[keyOf(field)]
    const value = typeof draft === 'string' && draft.trim() !== '' ? Number(draft) : Number.NaN
    const { min, max } = boundsOf(field)
    if (!Number.isFinite(value) || value < min || value > max || (field.kind === 'integer' && !Number.isInteger(value))) bad.add(keyOf(field))
  }
  return bad
}

/** The value of a request option as typed, or nothing when it is left empty (the provider's own setting then applies). */
function valueOf(option: RequestOption, draft: string | boolean | undefined): EmbeddingValue | undefined {
  if (option.type === 'boolean') return draft === true
  if (typeof draft !== 'string' || draft.trim() === '') return undefined
  return option.type === 'string' ? draft.trim() : Number(draft)
}

/** The settings with the form's values put over the ones it does not show; options it does not offer are left as they are. */
export function fromDrafts(base: ChatSettings, drafts: Drafts, options: readonly RequestOption[] = []): ChatSettings {
  const next = structuredClone(base) as unknown as Node
  const chosen: EmbeddingOptions = { ...base.embedding.options }
  for (const option of options) {
    const value = valueOf(option, drafts[optionKey(option)])
    if (value === undefined) delete chosen[option.key]
    else chosen[option.key] = value
  }
  ;(next['embedding'] as Node)['options'] = chosen
  for (const field of FORM_FIELDS) {
    const draft = drafts[keyOf(field)]
    const value = field.kind === 'flag' ? draft === true : field.kind === 'choice' ? String(draft) : field.kind === 'text' ? String(draft ?? '').trim() : field.kind === 'percent' ? Number(draft) / 100 : Number(draft)
    const parent = field.path.slice(0, -1).reduce<Node>((node, key) => node[key] as Node, next)
    parent[field.path.at(-1)!] = value
  }
  return next as unknown as ChatSettings
}
