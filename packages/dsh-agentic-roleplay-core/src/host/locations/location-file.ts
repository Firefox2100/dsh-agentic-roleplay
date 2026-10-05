import { EXIT_STATES, MAX_LOCATION_FEATURES, type ExitDefinition, type LocationDefinition, type LocationFeature } from 'dsh-roleplay-model'
import { readVariableValues } from '../variables/values.ts'
import { readIdentifier } from '../identifiers.ts'
import { Reader, type Issue, type ParseResult } from '../validation.ts'

export const LOCATION_FILE_NAME = 'location.json'

/** At most this many ways out of one place, so that a place never overwhelms a prompt. */
export const MAX_EXITS = 30

const FEATURE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/

function readFeatures(reader: Reader): LocationFeature[] {
  const features = reader.objects('features').flatMap((feature): LocationFeature[] => {
    const key = feature.string('id', { required: true })
    const name = feature.string('name', { required: true })
    if (key !== undefined && !FEATURE_KEY.test(key)) feature.fail('id', 'must be letters, digits, "-" or "_", at most 60')
    return key === undefined || name === undefined ? [] : [{ key, name, description: feature.text('description') }]
  })
  const seen = new Set<string>()
  features.forEach((feature, index) => {
    if (seen.has(feature.key)) reader.fail(`features[${index}].id`, `"${feature.key}" is used twice in this place`)
    seen.add(feature.key)
  })
  if (features.length > MAX_LOCATION_FEATURES) reader.fail('features', `a place has at most ${MAX_LOCATION_FEATURES} features`)
  return features
}

function readExits(reader: Reader): ExitDefinition[] {
  const exits = reader.objects('exits').flatMap((exit): ExitDefinition[] => {
    const to = exit.string('to', { required: true })
    const travelSeconds = exit.number('travel_time_seconds', { min: 0 })
    if (travelSeconds !== undefined && !Number.isInteger(travelSeconds)) exit.fail('travel_time_seconds', 'must be a whole number of seconds')
    const back = exit.string('back_description')
    const oneWay = exit.raw('one_way')
    if (oneWay !== undefined && typeof oneWay !== 'boolean') exit.fail('one_way', 'must be true or false')
    return to === undefined ? [] : [{
      to,
      description: exit.text('description'),
      oneWay: oneWay === true,
      ...(back === undefined ? {} : { backDescription: back }),
      ...(travelSeconds === undefined || !Number.isInteger(travelSeconds) ? {} : { travelSeconds }),
      state: exit.oneOf('state', EXIT_STATES, 'open'),
      note: exit.text('note'),
      openedBy: exit.strings('opened_by'),
    }]
  })
  if (exits.length > MAX_EXITS) reader.fail('exits', `a place has at most ${MAX_EXITS} exits`)
  return exits
}

/**
 * Read a `location.json` into the canonical place definition.
 * @param fallbackId - used when the file sets no `id`; the name of its folder.
 */
export function parseLocationFile(text: string, fallbackId: string): ParseResult<LocationDefinition> {
  const issues: Issue[] = []
  const reader = Reader.fromJson(text, issues)
  if (reader === undefined) return { ok: false, issues }
  const id = readIdentifier(reader, fallbackId) ?? fallbackId
  const name = reader.string('name', { required: true })
  const parent = reader.string('parent')
  const variables = readVariableValues(reader)
  const location: LocationDefinition = {
    id,
    name: name ?? '',
    description: reader.text('description'),
    ...(parent === undefined ? {} : { parent }),
    features: readFeatures(reader),
    exits: readExits(reader),
    ...(variables === undefined ? {} : { variables }),
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: location }
}
