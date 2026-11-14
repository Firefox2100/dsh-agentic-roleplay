import { describe, expect, it, vi } from 'vitest'
import {
  registerAgentCommands,
  registerCommands,
  registryOf,
  runCommandLine,
  type CommandSpec,
} from '../../../src/host/commands/registry.ts'

interface Registered {
  name: string
  description: string
  input?: { hint?: string }
  recordInput?: boolean
  handler: (call: { agent: unknown; rawInput: string; signal: AbortSignal }) => unknown
}

/** A stand-in for DSH's command registry, which records what was registered and is disposed of. */
function fakeRuntime() {
  const registered: Registered[] = []
  const disposed: string[] = []
  const runtime = {
    register: (definition: Registered): (() => void) => {
      registered.push(definition)
      return () => { disposed.push(definition.name) }
    },
    find: vi.fn(),
    execute: vi.fn(),
  }
  return { runtime, registered, disposed }
}

type Runtime = ReturnType<typeof fakeRuntime>['runtime']

/**
 * A context with the plugin's own effect scope and the injection DSH's commands are registered through, and the cleanups it collected, so that a test can unload the plugin.
 */
function fakeContext(runtime?: Runtime) {
  const cleanups: (() => void)[] = []
  const effect = (fn: () => unknown): void => {
    const out = fn()
    if (typeof out === 'function') cleanups.push(out as () => void)
  }
  const ctx = {
    get: (name: string) => (name === 'commands' ? runtime : undefined),
    effect,
    inject: (_deps: string[], fn: (scope: unknown) => void) => {
      fn({
        commands: runtime,
        effect: (f: () => unknown) => {
          const out = f()
          return typeof out === 'function' ? out : (): void => {}
        },
      })
      return { dispose: async () => { for (const cleanup of cleanups) cleanup() } }
    },
  }
  return { ctx, cleanups }
}

const spec = (name: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({
  name,
  description: `does ${name}`,
  hint: `${name} what`,
  handler: () => ({ kind: 'success' }),
  ...extra,
})

describe('the commands this plugin registers', () => {
  it('registers each command with its hint, and the log setting only when it is set', () => {
    const { runtime, registered } = fakeRuntime()
    const { ctx } = fakeContext(runtime)

    registerCommands(ctx as never, [spec('ooc'), spec('ask', { recordInput: false }), spec('roll', { recordInput: true })])

    expect(registered.map(definition => definition.name)).toEqual(['ooc', 'ask', 'roll'])
    expect(registered[0]?.input).toEqual({ hint: 'ooc what' })
    expect(registered[0]).not.toHaveProperty('recordInput')
    expect(registered[1]?.recordInput).toBe(false)
    expect(registered[2]?.recordInput).toBe(true)
  })

  it('takes the handlers as its own, so that only they run from outside the input box', async () => {
    const { runtime, registered } = fakeRuntime()
    const { ctx } = fakeContext(runtime)
    registerCommands(ctx as never, [spec('roll', { handler: () => ({ kind: 'success', text: 'rolled' }) })])

    const definition = registered[0]!
    runtime.find.mockReturnValue({ handler: definition.handler })
    runtime.execute.mockResolvedValue({ commandId: 'c1', result: { kind: 'success', text: 'rolled' } })

    expect(await runCommandLine(ctx as never, {} as never, '/roll 2d6', new AbortController().signal)).toEqual({ kind: 'success', text: 'rolled' })
    expect(runtime.execute).toHaveBeenCalledWith({}, '/roll 2d6', [], expect.anything())
  })

  it('does nothing for an agent without commands to register', () => {
    const { runtime, registered } = fakeRuntime()
    const { ctx } = fakeContext(runtime)
    const agent = { ctx: { inject: vi.fn() } }

    registerAgentCommands(ctx as never, agent as never, [])

    expect(agent.ctx.inject).not.toHaveBeenCalled()
    expect(registered).toEqual([])
  })

  it('registers commands for one agent and unloads them with the plugin as well as with the chat', async () => {
    const runtime = fakeRuntime().runtime
    const { ctx, cleanups } = fakeContext(runtime)
    const registered: string[] = []
    const disposed: string[] = []
    const ends: (() => void)[] = []
    const agent = {
      ctx: {
        inject: (_deps: string[], fn: (scope: unknown) => void) => {
          fn({
            commands: {
              register: (definition: Registered) => {
                registered.push(definition.name)
                const end = (): void => { disposed.push(definition.name) }
                ends.push(end)
                return end
              },
            },
            effect: (f: () => unknown) => f(),
          })
          return { dispose: async () => { for (const end of ends) end() } }
        },
      },
    }

    registerAgentCommands(ctx as never, agent as never, [spec('pray')])

    expect(registered).toEqual(['pray'])
    expect(cleanups, 'the plugin keeps the handle that ends the registration').toHaveLength(1)

    cleanups[0]!()
    await Promise.resolve()

    expect(disposed).toEqual(['pray'])
  })
})

describe('running a line from outside the input box', () => {
  const line = '/roll 2d6'

  it('does nothing without a command registry', async () => {
    const { ctx } = fakeContext(undefined)
    expect(registryOf(ctx as never)).toBeUndefined()
    expect(await runCommandLine(ctx as never, {} as never, line, new AbortController().signal)).toBeUndefined()
  })

  it('leaves a message alone when it is not a command', async () => {
    const { runtime } = fakeRuntime()
    const { ctx } = fakeContext(runtime)
    expect(await runCommandLine(ctx as never, {} as never, 'I open the door', new AbortController().signal)).toBeUndefined()
    expect(runtime.find).not.toHaveBeenCalled()
  })

  it('leaves a command of the profile alone: one of DSH\'s own is still a message here', async () => {
    const { runtime } = fakeRuntime()
    runtime.find.mockReturnValue({ handler: (): void => {} })
    const { ctx } = fakeContext(runtime)
    expect(await runCommandLine(ctx as never, {} as never, '/compact', new AbortController().signal)).toBeUndefined()
    expect(runtime.execute).not.toHaveBeenCalled()
  })

  it('leaves a command it does not know alone', async () => {
    const { runtime } = fakeRuntime()
    runtime.find.mockReturnValue(undefined)
    const { ctx } = fakeContext(runtime)
    expect(await runCommandLine(ctx as never, {} as never, '/unknown', new AbortController().signal)).toBeUndefined()
    expect(runtime.execute).not.toHaveBeenCalled()
  })

  it('is nothing when the command ran without a result to report', async () => {
    const { runtime, registered } = fakeRuntime()
    const { ctx } = fakeContext(runtime)
    registerCommands(ctx as never, [spec('wait')])
    runtime.find.mockReturnValue({ handler: registered[0]!.handler })
    runtime.execute.mockResolvedValue(undefined)

    expect(await runCommandLine(ctx as never, {} as never, '/wait 1h', new AbortController().signal)).toBeUndefined()
  })
})
