#!/usr/bin/env node
// Plays a list of messages into a roleplay session of a running DSH and reports each turn's time (with turn-report.mjs).
// usage: node scripts/play.mjs <dsh url with token> <roleplay session uuid> <messages.json | "message" ...>
//   a messages file holds a JSON array of strings; anything else on the command line is taken as one message each.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [url, id, ...rest] = process.argv.slice(2)
if (url === undefined || id === undefined || rest.length === 0) { console.error('usage: play.mjs <dsh url with token> <session uuid> <messages.json | message ...>'); process.exit(2) }
const messages = rest.length === 1 && rest[0].endsWith('.json') ? JSON.parse(readFileSync(rest[0], 'utf8')) : rest
const base = new URL(url).origin
const TURN_LIMIT_MS = 30 * 60_000

const login = await fetch(url, { redirect: 'manual' })
const cookie = (login.headers.getSetCookie?.() ?? []).map(entry => entry.split(';')[0]).join('; ')
if (cookie === '') { console.error('the DSH did not give a session cookie: is the token current?'); process.exit(1) }
const api = (path, init = {}) => fetch(`${base}/roleplay-api${path}`, { ...init, headers: { ...init.headers, cookie, 'content-type': 'application/json' } })
const turnsOf = async () => {
  const { sessions } = await (await api('/sessions')).json()
  const found = sessions.find(session => session.id === id)
  if (found === undefined) { console.error(`no session ${id}`); process.exit(1) }
  return found.turns
}

for (const text of messages) {
  const before = await turnsOf()
  const sent = Date.now()
  const response = await api('/sessions/message', { method: 'POST', body: JSON.stringify({ id, text }) })
  if (response.status !== 202) { console.error(`the message was refused (${response.status}): ${await response.text()}`); process.exit(1) }
  while (await turnsOf() === before) {
    if (Date.now() - sent > TURN_LIMIT_MS) { console.error(`no turn finished within ${TURN_LIMIT_MS / 60_000} minutes`); process.exit(1) }
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  console.log(`\n> ${text}\n  turn ${before + 1} took ${Math.round((Date.now() - sent) / 1000)}s`)
  console.log(execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'turn-report.mjs'), id, '1'], { encoding: 'utf8' }))
}
