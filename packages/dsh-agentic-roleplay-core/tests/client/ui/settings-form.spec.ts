import { describe, expect, it } from 'vitest'
import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFormPathOp,
  type SettingsFormScope,
  type SettingsFormScopeSnapshot,
} from '../../../src/client/ui/settings-form.ts'

interface Section {
  rootPath?: string
  limit?: number
}

/** A scope over one section that records the mutations a form performs. */
function scope(init: Partial<SettingsFormScopeSnapshot<Section>> = {}): SettingsFormScope<Section> & { writes: { ops: readonly SettingsFormPathOp[]; revision: number | undefined }[]; snapshot: SettingsFormScopeSnapshot<Section>; emit: () => void } {
  const snapshot: SettingsFormScopeSnapshot<Section> = {
    status: 'ready',
    value: {},
    base: {},
    user: {},
    writable: true,
    revision: 7,
    ...init,
  }
  const listeners = new Set<() => void>()
  const writes: { ops: readonly SettingsFormPathOp[]; revision: number | undefined }[] = []
  return {
    writes,
    snapshot,
    emit: () => { for (const listener of listeners) listener() },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: async (ops, expectedRevision) => {
      writes.push({ ops, revision: expectedRevision })
      return true
    },
  }
}

function form(target = scope()): { model: SettingsFormModel<Section>; target: ReturnType<typeof scope> } {
  const model = new SettingsFormModel<Section>(target, [settingsTextField('rootPath'), settingsNumberField('limit')])
  return { model, target }
}

describe('the settings form model', () => {
  it('shows the effective value and marks a field the user layer carries', () => {
    const target = scope({ value: { rootPath: '/worlds' }, base: { rootPath: '/other' }, user: { rootPath: '/worlds' } })
    const { model } = form(target)
    expect(model.field('rootPath')).toEqual({ text: '/worlds', overridden: true, invalid: false })
    expect(model.field('limit')).toEqual({ text: '', overridden: false, invalid: false })
  })

  it('stages an edit without writing, and marks the form dirty', () => {
    const { model, target } = form()
    model.actions().edit('rootPath', ' /tmp ')
    expect(model.shell()).toMatchObject({ dirty: true, invalid: false })
    expect(model.field('rootPath')).toMatchObject({ text: ' /tmp ', overridden: true })
    expect(target.writes).toHaveLength(0)
  })

  it('writes every staged edit as one revision-fenced mutation, then forgets them', async () => {
    const { model, target } = form()
    const actions = model.actions()
    actions.edit('rootPath', '/tmp')
    actions.edit('limit', '12')
    await model.save()
    expect(target.writes).toEqual([{ ops: [{ op: 'set', path: ['rootPath'], value: '/tmp' }, { op: 'set', path: ['limit'], value: 12 }], revision: 7 }])
    expect(model.shell().dirty).toBe(false)
  })

  it('clears a field the user layer carries instead of writing the inherited value', async () => {
    const target = scope({ value: { rootPath: '/worlds' }, user: { rootPath: '/worlds' } })
    const { model } = form(target)
    const actions = model.actions()
    actions.resetField('rootPath')
    expect(model.field('rootPath')).toMatchObject({ overridden: false, invalid: false })
    await model.save()
    expect(target.writes[0]?.ops).toEqual([{ op: 'unset', path: ['rootPath'] }])
  })

  it('refuses to save while a draft is not a value the field accepts', async () => {
    const { model, target } = form()
    const actions = model.actions()
    actions.edit('limit', 'twelve')
    expect(model.shell()).toMatchObject({ dirty: true, invalid: true })
    expect(model.field('limit').invalid).toBe(true)
    await model.save()
    expect(target.writes).toHaveLength(0)
  })

  it('reads a field the Host does not serve as unavailable and not writable', () => {
    const { model } = form(scope({ status: 'unavailable', writable: false, value: undefined }))
    expect(model.shell()).toMatchObject({ available: false, writable: false, dirty: false })
  })

  it('re-publishes bound projections when the scope or a draft changes', () => {
    const { model, target } = form()
    const store = model.bind(() => ({ text: model.field('rootPath').text }))
    expect(store.getSnapshot()).toEqual({ text: '' })
    model.actions().edit('rootPath', '/tmp')
    expect(store.getSnapshot()).toEqual({ text: '/tmp' })
    target.snapshot.value = { rootPath: '/from-host' }
    target.emit()
    model.actions().discard()
    expect(store.getSnapshot()).toEqual({ text: '/from-host' })
  })
})
