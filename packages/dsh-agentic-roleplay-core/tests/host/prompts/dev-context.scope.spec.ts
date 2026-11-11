import { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { silenceHarnessDevContext } from '../../../src/host/prompts/dev-context.ts'

/**
 * The real registry, not a stand-in: the presets rely on a registration made in a preset's scope replacing
 * the profile's contribution of the same name, and on that replacement staying inside that scope.
 */
async function registry(): Promise<{ root: Context; scope: Scope; key: object }> {
  const root = new Context()
  await root.plugin(SystemPrompt, {})
  root.systemPrompt.section({ name: 'harness:source', order: 10000, interpolate: false, text: 'The checkout is at C:/somewhere.' })
  root.systemPrompt.context({ name: 'harness:source', order: 200, interpolate: false, text: 'Checkout: C:/somewhere.' })
  root.systemPrompt.section({ name: 'app:web-surface', order: 10100, interpolate: false, text: 'This page is the web GUI.' })
  root.systemPrompt.context({ name: 'app:web-surface', order: 210, interpolate: false, text: 'Page: http://127.0.0.1/.' })
  // A scope is minted inside a plugin that injects the registry, the way a preset composition mints one:
  // the scoped context inherits that plugin's dependency API, so `scope.ctx.systemPrompt` is usable.
  const key = {}
  let scope: Scope | undefined
  await root.plugin({
    name: 'mint-a-scope',
    inject: ['systemPrompt'],
    apply: (ctx: Context) => {
      scope = createScope(ctx, key)
    },
  })
  return { root, scope: scope as Scope, key }
}

/** What a model would be sent for one scope: the sections and then the runtime contexts. */
async function promptFor(root: Context, scope?: object): Promise<string> {
  const assembly = await root.systemPrompt.assemble(scope === undefined ? {} : { scope })
  return `${renderPrompt(assembly)}\n${renderContextSnapshot(assembly)}`
}

describe('a scope that silences the harness orientation text', () => {
  it('replaces the profile contribution in its own scope, and leaves the profile as it was', async () => {
    const { root, scope, key } = await registry()
    expect(await promptFor(root, key)).toContain('The checkout is at C:/somewhere.')
    expect(await promptFor(root, key)).toContain('Page: http://127.0.0.1/.')

    silenceHarnessDevContext(scope.ctx)

    const story = await promptFor(root, key)
    expect(story).not.toContain('C:/somewhere.')
    expect(story).not.toContain('This page is the web GUI.')
    expect(story).not.toContain('http://127.0.0.1/')
    // A neighbour scope still reads it, and so does the profile's own unscoped assembly.
    const neighbourKey = {}
    createScope(scope.ctx, neighbourKey)
    expect(await promptFor(root, neighbourKey)).toContain('The checkout is at C:/somewhere.')
    expect(await promptFor(root, undefined)).toContain('The checkout is at C:/somewhere.')
  })

  it('cannot be registered twice in one scope: the second registration is a duplicate', async () => {
    const { scope } = await registry()
    silenceHarnessDevContext(scope.ctx)
    expect(() => silenceHarnessDevContext(scope.ctx)).toThrow(/already registered/)
  })
})
