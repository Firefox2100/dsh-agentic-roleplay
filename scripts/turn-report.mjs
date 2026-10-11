#!/usr/bin/env node
// Prints where the time of a roleplay turn went, from DSH's stored session logs.
// usage: node scripts/turn-report.mjs <roleplay session uuid> [turns=1] [sessions dir]
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [id, count = '1', root = join(homedir(), '.dsh', 'sessions')] = process.argv.slice(2)
if (id === undefined) { console.error('usage: turn-report.mjs <roleplay session uuid> [turns] [sessions dir]'); process.exit(2) }

const readLog = (file) => execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
const folders = readdirSync(root).map(name => join(root, name))
const logs = folders.flatMap(folder => readdirSync(folder).filter(name => existsSync(join(folder, name, 'session.v4.jsonl.zstd'))).map(name => ({ name, file: join(folder, name, 'session.v4.jsonl.zstd') })))
const chat = logs.find(log => log.name === `session-${id}`)
if (chat === undefined) { console.error(`no chat log for ${id}`); process.exit(1) }

const seconds = (ms) => `${Math.round(ms / 1000)}s`
const rows = readLog(chat.file)
const starts = rows.flatMap((row, index) => (row.type === 'turn/start' ? [index] : []))
for (const [position, from] of starts.slice(-Number(count)).entries()) {
  const to = starts.find(index => index > from) ?? rows.length
  const turn = rows.slice(from, to)
  const began = Number(turn[0].time)
  const ended = Number(turn.at(-1).time)
  const player = turn.find(row => row.type === 'user/message' && row.data?.source?.kind === 'user')
  const said = player?.data?.content?.map(part => part.text).join('') ?? ''
  console.log(`\nturn ${position + 1} of the last ${count}: ${seconds(ended - began)}  "${said.slice(0, 70)}"`)
  const firstStep = turn.find(row => row.type === 'step/start')
  if (firstStep !== undefined) console.log(`  waited ${seconds(Number(firstStep.time) - began)} before the first request`)
  for (const row of turn) {
    if (row.type === 'tool/call') console.log(`  +${String(Math.round((Number(row.time) - began) / 1000)).padStart(4)}s  ${row.data.name}`)
    if (row.type === 'tool/result' && row.data.message?.isError) console.log(`         refused: ${JSON.stringify(row.data.message.content).slice(0, 150)}`)
  }
  // Helpers (characters, keeper, authors, suggestions) are the other logs that began during the turn.
  const helpers = logs.filter(log => log.name !== chat.name).flatMap((log) => {
    const first = readLog(log.file)
    const start = Number(first.find(row => Number(row.time) > 0)?.time ?? 0)
    if (start < began || start > ended + 600_000) return []
    const calls = first.filter(row => row.type === 'tool/call').map(row => row.data.name)
    const brief = first.find(row => row.type === 'user/message')?.data?.content?.[0]?.text ?? ''
    return [{ start, took: Number(first.at(-1).time) - start, calls, brief }]
  }).sort((a, b) => a.start - b.start)
  for (const helper of helpers) console.log(`  helper +${String(Math.round((helper.start - began) / 1000)).padStart(4)}s ${seconds(helper.took).padStart(5)}  ${helper.brief.slice(0, 40).replace(/\n/g, ' ')}  [${helper.calls.slice(0, 6).join(', ')}${helper.calls.length > 6 ? ', …' : ''}]`)
}
