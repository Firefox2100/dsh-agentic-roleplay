import type { VariableDeclaration } from '../../shared/world-daily.ts'

/** One declaration as it is typed: lists and numbers are text until it is saved. */
export interface Draft {
  key: string; name: string; kind: VariableDeclaration['kind']; subject: VariableDeclaration['subject']; visibility: VariableDeclaration['visibility']
  description: string; min: string; max: string; integer: boolean; baseline: boolean; always: boolean
  default: string; only: string; options: string; bands: string
}

const list = (value: string): string[] => value.split(/[,，\n]/).map(entry => entry.trim()).filter(entry => entry !== '')
export const NEW: Draft = { key: '', name: '', kind: 'number', subject: 'character', visibility: 'public', description: '', min: '', max: '', integer: false, baseline: false, always: false, default: '', only: '', options: '', bands: '' }

export const draftOf = (value: VariableDeclaration): Draft => ({
  key: value.key, name: value.name, kind: value.kind, subject: value.subject, visibility: value.visibility, description: value.description ?? '',
  min: value.min === undefined ? '' : String(value.min), max: value.max === undefined ? '' : String(value.max),
  integer: value.integer === true, baseline: value.baseline === true, always: value.always === true,
  default: value.default === undefined ? '' : String(value.default), only: (value.only ?? []).join(', '), options: (value.options ?? []).join(', '),
  bands: (value.bands ?? []).map(band => `${band.up_to}: ${band.label}`).join('\n'),
})

/** The declaration as it will be sent: a default is a number, true/false or text according to the kind; bands are `up to: label` lines. */
export function declarationOf(draft: Draft): VariableDeclaration {
  const number = (text: string): number | undefined => (text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text))
  const defaultValue = draft.default.trim() === '' ? undefined : draft.kind === 'number' ? number(draft.default) ?? draft.default.trim() : draft.kind === 'flag' ? draft.default.trim() === 'true' : draft.default.trim()
  const bands = draft.bands.split('\n').flatMap((line): { up_to: number; label: string }[] => {
    const at = line.indexOf(':')
    const upTo = at < 0 ? undefined : number(line.slice(0, at))
    return upTo === undefined ? [] : [{ up_to: upTo, label: line.slice(at + 1).trim() }]
  })
  const [min, max, only, options] = [number(draft.min), number(draft.max), list(draft.only), list(draft.options)]
  return {
    key: draft.key.trim(), name: draft.name.trim(), kind: draft.kind, subject: draft.subject, visibility: draft.visibility,
    ...(draft.description.trim() === '' ? {} : { description: draft.description.trim() }),
    ...(draft.kind === 'number' && min !== undefined ? { min } : {}), ...(draft.kind === 'number' && max !== undefined ? { max } : {}),
    ...(draft.kind === 'number' && draft.integer ? { integer: true } : {}), ...(draft.baseline ? { baseline: true } : {}), ...(draft.always ? { always: true } : {}),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(only.length === 0 ? {} : { only }), ...(draft.kind === 'choice' && options.length > 0 ? { options } : {}), ...(draft.kind === 'number' && bands.length > 0 ? { bands } : {}),
  }
}
