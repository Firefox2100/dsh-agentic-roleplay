import { describe, expect, it } from 'vitest'
import { guarded } from '../../../src/host/residency/guard.ts'
import { ModelResidency, type ModelAdmin } from '../../../src/host/residency/residency.ts'
import { offloadOf, type OffloadConfig } from '../../../src/shared/offload.ts'

const CONFIG: OffloadConfig = offloadOf({
  models: { image: { route: 'localai', model: 'flux' }, embedding: { route: 'localai', model: 'bge' } },
  groups: [['main', 'image']],
})
const MAIN = { provider: 'localai', model: 'qwen' }

function rig(config: OffloadConfig = CONFIG, state: string = 'ready') {
  const calls: string[] = []
  const problems: string[] = []
  let failing = false
  const admin: ModelAdmin = {
    operations: () => ['status', 'unload'],
    status: async (route, model) => { calls.push(`status ${route}/${model}`); return { state } },
    unload: async (route, model) => { calls.push(`unload ${route}/${model}`); if (failing) throw new Error('refused') },
  }
  const residency = new ModelResidency({ config: () => config, admin: () => admin, problem: message => { problems.push(message) } })
  return { residency, calls, problems, fail: () => { failing = true } }
}

describe('model residency', () => {
  it('never unloads anything without a group', async () => {
    const { residency, calls } = rig(offloadOf({}))
    await residency.ensure('image')
    await residency.ensure('main', MAIN)
    expect(calls).toEqual([])
  })

  it('unloads the story model before an image is made, and the image model before the story goes on', async () => {
    const { residency, calls } = rig()
    await residency.ensure('main', MAIN)
    expect(calls).toEqual(['status localai/flux', 'unload localai/flux'])
    calls.length = 0
    await residency.ensure('image')
    expect(calls).toEqual(['status localai/qwen', 'unload localai/qwen'])
    calls.length = 0
    await residency.ensure('main', MAIN)
    expect(calls).toEqual(['status localai/flux', 'unload localai/flux'])
  })

  it('costs nothing while the same role is used again and again, or a role outside every group', async () => {
    const { residency, calls } = rig()
    await residency.ensure('embedding')
    await residency.ensure('image')
    calls.length = 0
    await residency.ensure('image')
    await residency.ensure('image')
    await residency.ensure('embedding')
    expect(calls).toEqual([])
  })

  it('skips a model the server says is not loaded', async () => {
    const { residency, calls } = rig(CONFIG, 'uninitialized')
    await residency.ensure('image', undefined)
    await residency.ensure('main', MAIN)
    expect(calls).toEqual(['status localai/flux'])
  })

  it('unloads anyway when the server cannot say whether a model is loaded', async () => {
    const calls: string[] = []
    const admin: ModelAdmin = { operations: () => ['status', 'unload'], status: async () => { throw new Error('no monitor') }, unload: async (_route, model) => { calls.push(model) } }
    const residency = new ModelResidency({ config: () => CONFIG, admin: () => admin, problem: () => undefined })
    await residency.ensure('image')
    expect(calls).toEqual([])
    await residency.ensure('main', MAIN)
    expect(calls).toEqual(['flux'])
  })

  it('remembers the last story model for callers that do not know it', async () => {
    const { residency, calls } = rig()
    await residency.ensure('main', MAIN)
    await residency.ensure('image')
    expect(calls).toContain('unload localai/qwen')
  })

  it('does not fail the work when a model cannot be unloaded, and says so once', async () => {
    const { residency, problems, fail } = rig()
    fail()
    await residency.ensure('main', MAIN)
    await residency.ensure('image')
    await residency.ensure('image')
    expect(problems).toHaveLength(2)
    expect(problems.filter(message => message.includes('could not unload qwen'))).toHaveLength(1)
  })

  it('reports a model without a place once and goes on', async () => {
    const { residency, problems } = rig(offloadOf({ groups: [['embedding', 'image']] }))
    await residency.ensure('image')
    await residency.ensure('embedding')
    expect(problems.filter(message => message.includes('not set'))).toHaveLength(2)
  })

  it('serialises concurrent switches', async () => {
    const order: string[] = []
    const admin: ModelAdmin = {
      operations: () => ['unload'],
      status: async () => ({ state: 'ready' }),
      unload: async (_route, model) => { order.push(`begin ${model}`); await new Promise(resolve => setTimeout(resolve, 5)); order.push(`end ${model}`) },
    }
    const residency = new ModelResidency({ config: () => offloadOf({ models: { image: { route: 'r', model: 'img' }, speech: { route: 'r', model: 'tts' } }, groups: [['image', 'speech', 'main']] }), admin: () => admin, problem: () => undefined })
    await Promise.all([residency.ensure('main', MAIN), residency.ensure('main', MAIN)])
    expect(order).toEqual(['begin img', 'end img', 'begin tts', 'end tts'])
  })

  it('does not unload a model under the calls that are using it', async () => {
    const { residency, calls } = rig()
    await residency.ensure('image')
    calls.length = 0
    let finish: () => void = () => undefined
    const working = residency.using('image', () => new Promise<void>((resolve) => { finish = resolve }))
    const switched = residency.ensure('main', MAIN)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(calls).toEqual([])
    finish()
    await working
    await switched
    expect(calls).toEqual(['status localai/flux', 'unload localai/flux'])
  })

  it('serialises conflicting guarded calls without deadlocking', async () => {
    const { residency } = rig()
    const order: string[] = []
    await Promise.all([
      residency.run('main', async () => { order.push('main start'); await new Promise(resolve => setTimeout(resolve, 5)); order.push('main end') }, MAIN),
      residency.run('image', async () => { order.push('image start'); await new Promise(resolve => setTimeout(resolve, 5)); order.push('image end') }),
    ])
    expect(order).toEqual(['main start', 'main end', 'image start', 'image end'])
  })

  it('lets the calls that wait behind a switch go on while it waits for others', async () => {
    const { residency } = rig()
    await residency.ensure('image')
    let finish: () => void = () => undefined
    const first = residency.using('image', () => new Promise<void>((resolve) => { finish = resolve }))
    const switched = residency.ensure('main', MAIN)
    const second = residency.using('image', async () => { await residency.ensure('image') })
    await second
    finish()
    await Promise.all([first, switched])
  })

  it('is told about conflicts', () => {
    const { residency } = rig()
    expect(residency.conflicts('image', 'main')).toBe(true)
    expect(residency.conflicts('image', 'embedding')).toBe(false)
  })
})

describe('guarded services', () => {
  it('makes room before the listed methods only, and keeps the rest of the service', async () => {
    const { residency, calls } = rig()
    await residency.ensure('main', MAIN)
    calls.length = 0
    const service = { name: 'images', generate: async (prompt: string) => `made ${prompt}`, describe() { return this.name } }
    const wrapped = guarded(residency, 'image', service, ['generate'])!
    expect(wrapped.describe()).toBe('images')
    expect(calls).toEqual([])
    expect(await wrapped.generate('a harbour')).toBe('made a harbour')
    expect(calls).toEqual(['status localai/qwen', 'unload localai/qwen'])
  })

  it('is the service itself without residency or without the service', () => {
    const service = { generate: async () => 'x' }
    expect(guarded(undefined, 'image', service, ['generate'])).toBe(service)
    expect(guarded(rig().residency, 'image', undefined as typeof service | undefined, ['generate'])).toBeUndefined()
  })
})
