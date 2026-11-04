import { describe, expect, it } from 'vitest'
import { MasterRecovery } from '../../../src/host/orchestration/recovery.ts'
import { MASTER_RECOVERIES } from '../../../src/host/agents/limits.ts'

const unreadable = { message: 'Failed to parse tool call arguments' }

describe('MasterRecovery', () => {
  it('runs the step again for a call that could not be read, up to the limit', () => {
    const recovery = new MasterRecovery()
    for (let i = 0; i < MASTER_RECOVERIES; i += 1) expect(recovery.retry('chat', 3, unreadable)).toBe(true)
    expect(recovery.retry('chat', 3, unreadable)).toBe(false)
  })

  it('leaves other failures terminal', () => {
    expect(new MasterRecovery().retry('chat', 1, { message: 'connection refused' })).toBe(false)
  })

  it('counts per turn and starts a new turn afresh', () => {
    const recovery = new MasterRecovery()
    for (let i = 0; i < MASTER_RECOVERIES; i += 1) recovery.retry('chat', 3, unreadable)
    expect(recovery.retry('chat', 4, unreadable)).toBe(true)
  })

  it('keeps the cap for the first recovery, then shrinks it, never below the floor', () => {
    const recovery = new MasterRecovery()
    expect(recovery.budget('chat', 12000)).toBe(12000)
    recovery.retry('chat', 1, unreadable)
    expect(recovery.budget('chat', 12000)).toBe(12000)
    recovery.retry('chat', 1, unreadable)
    expect(recovery.budget('chat', 12000)).toBe(6000)
    recovery.retry('chat', 1, unreadable)
    expect(recovery.budget('chat', 12000)).toBe(3000)
    expect(recovery.budget('chat', 1024)).toBe(1024)
    recovery.clear('chat')
    expect(recovery.budget('chat', 12000)).toBe(12000)
  })
})
