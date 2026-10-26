import { describe, expect, it } from 'vitest'
import { ASSISTANT_FIELDS, assistantFields } from '../../../src/client/settings/assistants.ts'

const field = (name: string) => assistantFields.find(spec => spec.field === name)!

describe('the settings of the assistants', () => {
  it('cover the thinking level, the model, the limits and the decision model, each a field of the plugin configuration', () => {
    expect(ASSISTANT_FIELDS.map(spec => spec.field)).toEqual(['importReasoning', 'childReasoning', 'importModel', 'importTemperature', 'importMaxTokens', 'importTimeoutMinutes', 'importConcurrency', 'importDecisions', 'importConfidence', 'importMaxUploadBytes', 'catalogueMaxBytes', 'catalogueTrashDays'])
  })

  it('go back to the default when emptied, keep a text as it is, and show a number as text', () => {
    expect(field('importReasoning').parse('  ')).toEqual({ kind: 'clear' })
    expect(field('importReasoning').parse(' off ')).toEqual({ kind: 'set', value: 'off' })
    expect(field('importModel').parse('localai/qwen')).toEqual({ kind: 'set', value: 'localai/qwen' })
    expect(field('importMaxTokens').format(16000)).toBe('16000')
    expect(field('importReasoning').format(undefined)).toBe('')
  })

  it('accept only a number the host accepts', () => {
    expect(field('importTimeoutMinutes').parse('0')).toEqual({ kind: 'set', value: 0 })
    expect(field('importTimeoutMinutes').parse('241')).toBeUndefined()
    expect(field('importTimeoutMinutes').parse('1.5')).toBeUndefined()
    expect(field('importConcurrency').parse('0')).toBeUndefined()
    expect(field('importTemperature').parse('0.3')).toEqual({ kind: 'set', value: 0.3 })
    expect(field('importTemperature').parse('3')).toBeUndefined()
    expect(field('importConfidence').parse('abc')).toBeUndefined()
  })

  it('accept only the two ways of sorting a card', () => {
    expect(field('importDecisions').parse('decision')).toEqual({ kind: 'set', value: 'decision' })
    expect(field('importDecisions').parse('llm')).toEqual({ kind: 'set', value: 'llm' })
    expect(field('importDecisions').parse('hybrid')).toBeUndefined()
  })
})
