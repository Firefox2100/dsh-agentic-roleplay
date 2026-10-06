import type { VisualIdentityInput } from 'dsh-roleplay-model'
import { Reader } from '../validation.ts'

export const MAX_VISUAL_TAGS = 40
export const MAX_VISUAL_DESCRIPTION = 2_000

/** Read an optional provider-neutral visual identity from an authored entity file. */
export function readVisualIdentity(reader: Reader): VisualIdentityInput | undefined {
  const visual = reader.object('visual_identity')
  if (visual === undefined) return undefined
  const description = visual.string('description', { required: true })
  const tags = visual.strings('tags')
  const negativeTags = visual.strings('negative_tags')
  const globalId = visual.string('global_id')
  if (description !== undefined && description.length > MAX_VISUAL_DESCRIPTION) visual.fail('description', `must be at most ${MAX_VISUAL_DESCRIPTION} characters`)
  if (tags.length > MAX_VISUAL_TAGS) visual.fail('tags', `has at most ${MAX_VISUAL_TAGS} entries`)
  if (negativeTags.length > MAX_VISUAL_TAGS) visual.fail('negative_tags', `has at most ${MAX_VISUAL_TAGS} entries`)
  if (description === undefined) return undefined
  return { description, tags, negativeTags, ...(globalId === undefined ? {} : { globalId }) }
}
