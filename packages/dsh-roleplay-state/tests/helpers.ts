import { createSessionStore, type Intent, type NewCharacter, type SessionStore } from '../src/index.ts'

/** Overrides may name a field with `undefined` to leave it out. */
type Overrides<T> = { [K in keyof T]?: T[K] | undefined }

function without<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

/** A clock that moves forward one second with every reading. */
export function steppingClock(start = '2026-01-01T00:00:00.000Z'): () => Date {
  let time = Date.parse(start)
  return () => new Date(time += 1000)
}

export function memoryStore(): SessionStore {
  return createSessionStore(
    ':memory:',
    { id: 'session-1', title: 'First night', world: { id: 'blackwater-observatory', name: 'The Blackwater Observatory' } },
    { clock: steppingClock() },
  )
}

export function newCharacter(overrides: Overrides<NewCharacter> = {}): NewCharacter {
  return without({
    sourceId: 'eleanor-graves',
    name: 'Eleanor Graves',
    aliases: ['Ellie', 'the Mayor'],
    age: '42',
    gender: 'female',
    pronouns: 'she/her',
    kind: 'person',
    tier: 'principal',
    role: 'npc',
    control: 'agent',
    summary: 'Mayor of Blackwater Ridge.',
    personality: 'Calculating and practical.',
    background: 'Born in the town.',
    appearance: 'Sharp features.',
    speech: { style: 'Formal, clipped.', examples: ['Let us not make a scene.'] },
    ...overrides,
  }) as NewCharacter
}

export function newIntent(overrides: Overrides<Intent> = {}): Intent {
  return without({
    type: 'agenda',
    name: 'Contain the scandal',
    description: 'Keep the disappearance quiet.',
    status: 'active',
    horizon: 'day',
    priority: 0.8,
    urgency: 0.6,
    plan: ['Charm the visitor', 'Move the records'],
    openThreads: ['What does he know?'],
    constraints: ['Never be seen to panic'],
    deadline: '1912-09-22T00:00:00.000Z',
    ...overrides,
  }) as Intent
}
