import { describe, expect, it } from 'vitest'
import { registerCard } from '../../../src/client/card/register.ts'

interface Registered { id: string; kind: string; keepMounted: boolean; title: () => string; guide: { id: string; order: number; title: () => string; description: () => string; icon: unknown }[] }
interface SlotRegistration { name: string; key: string; locale: string; inject: (sessionId: string) => { sessionId: string }; body: unknown }

const fake = () => {
  const dictionaries: unknown[] = []
  const effects: string[] = []
  const services: string[][] = []
  const tabs: Registered[] = []
  const slots: SlotRegistration[] = []
  const guides: string[] = []
  const ctx = {
    locale: {
      bind: (namespace: string) => (key: string) => `${namespace}:${key}`,
      register: (namespace: string, dictionary: unknown) => { dictionaries.push({ namespace, dictionary }); return () => undefined },
    },
    effect: (run: () => unknown, label?: string) => { effects.push(label ?? 'unlabelled'); return run() },
    inject: (names: string[], run: (right: unknown) => void) => {
      services.push(names)
      run({
        effect: ctx.effect,
        sidebarRightTabs: { register: (tab: Registered) => { tabs.push(tab); return () => undefined } },
        slots: {
          inject: (name: string, register: () => unknown) => { guides.push(name); return register() },
          register: (registration: SlotRegistration, body: unknown) => { slots.push({ ...registration, body }); return () => undefined },
        },
      })
    },
  }
  return { ctx, dictionaries, effects, services, tabs, slots, guides }
}

const views = { id: '@dsh-agentic-roleplay/core/card-sidebar', kind: 'roleplay-card', icon: 'icon', guide: 'guide', body: 'body' }

describe('the card of a world in the right sidebar', () => {
  it('registers its dictionaries, its tab type, and both of its entries', () => {
    const { ctx, dictionaries, effects, services, tabs, slots, guides } = fake()
    registerCard(ctx as never, views)

    expect(dictionaries).toHaveLength(1)
    expect(services).toEqual([['sidebarRight', 'sidebarRightTabs']])
    expect(effects).toEqual(['roleplay: card dictionaries', 'roleplay: card tab type', 'roleplay: card guide entry', 'roleplay: card body'])
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ id: views.id, kind: views.kind, keepMounted: true })
    expect(tabs[0]?.title()).toBe('roleplay.card:tab')
    expect(tabs[0]?.guide.map(entry => entry.id)).toEqual(['card'])
    expect(tabs[0]?.guide[0]).toMatchObject({ order: 34, icon: 'icon' })
    expect(tabs[0]?.guide[0]?.description()).toBe('roleplay.card:guideText')
    expect(guides).toEqual(['sidebar.right.tab.guide.entry', 'sidebar.right.pane.tab'])
    expect(slots.map(entry => [entry.name, entry.key, entry.locale])).toEqual([
      ['sidebar.right.tab.guide.entry', views.id, 'roleplay.card'],
      ['sidebar.right.pane.tab', views.id, 'roleplay.card'],
    ])
    expect(slots.map(entry => entry.inject('session-abc'))).toEqual([{ sessionId: 'session-abc' }, { sessionId: 'session-abc' }])
    expect(slots.map(entry => entry.body)).toEqual(['guide', 'body'])
  })
})
