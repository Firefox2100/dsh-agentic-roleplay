---
title: DSH API contract
description: Exact host and browser services, private composition boundary, lifecycle operations, and upgrade checks.
---

DSH is pre-stable: its own rule is that public APIs may change between releases and every
consumer is updated with them. So the aim here is not an API that never changes but one
where an upgrade is mechanical: only what DSH exports from a package root and documents is
used, never a deep path (`.../src/*`), never an internal event, and every use is listed
below so it can be checked when DSH moves.

## Host (the plugins)

| Use | API | Where |
|---|---|---|
| Plugins, services | `Context`, `Service`, `ctx.inject`, `ctx.effect`, `ctx.provide` (cordis) | everywhere |
| Configuration | Schemastery `Config`, volatile fields, `loader/volatile-update` | `index.ts`, `host/config.ts` |
| Browser HTTP API | `ctx.webServer.register`, `ctx.connection.requestRejection` | `host/http/` |
| The chat of a session | `ctx.sessionController.create/rename`, `ctx.workspaceRegistry.create/archiveSession`, `ctx.sessionPersistence` | `host/agent/` |
| Agent presets | the `@deepseek-ai/dsh-agent-preset` row with `plugins` (persona, our two plugins, a `compaction` group) | the bundle's `cordis.patch.yml` |
| Game master tools | `ctx.tools.register(defineTool(...))` | `host/orchestration/tools.ts`, `dsh-roleplay-state` |
| Prompt | `ctx.systemPrompt.section` | `orchestration.ts` |
| Turn control | `agent/pre-step` (waterfall), `agent/turn-stopping`, `agent.steer`, `exec.concludeTurn()`, `exec.agent`, `exec.signal` | `host/orchestration/hooks.ts`, `tools.ts` |
| Chronicler (no tools) | `ctx.subagents.start('spawn', { persona, toolFilter, outputSchema, prompt, parent, signal })`, `SubagentRun.result/dispose` | `compaction/chronicler.ts` |
| Characters and record keeper (tools of their own) | **not the public sub-agent API**: see below | `agents/child.ts` |
| Message source | merge into `MessageSourceMap` (`roleplay`) | `hooks.ts` |
| Looking up an agent | `ctx.agents.get` | `orchestration.ts` |
| Compaction | `BasicCompactionEngine` (`@deepseek-ai/dsh-compaction-basic`, default export): its documented sole hook `summarize()` and `compactRegion()`; `ctx.tokenMeter.measure(session)`; `session.surface.nodes`; `session.snapshotEvents()`; `session.header.origin` | `host/compaction/` |
| Session events | reading `turn/start`, `user/message`, `tool/result` events; writing the opening turn through `Session.create` and `ctx.sessionPersistence` | `compaction/range.ts`, `agent/opening.ts` |

## Browser (the client plugins)

`ctx.slots` (`settings.section`, `sidebar.panellist`, `main` panels, `conversation.chat.node`,
`conversation.view`), `ctx.locale`, `ctx.configForms`, `ctx.uiConversation` (events and views),
`uiWorkspace.openSession`, and the shell primitives (`Button`, `Input`, `Switch`, `Modal`, `Tag`,
`Tooltip`). The client bundle format is the shell's module loader, checked by `tsdown.config.ts`.

## The one place that goes below the public API

Characters and the record keeper are *children with tools of their own*. That needs two things
the sub-agent API cannot give: tools registered on one child alone (so a tool built around
Alice's memory gives Bob's agent, running at the same time, nothing of it), and a result
contract finished by a tool the child calls after looping (so it can read, write, check and fix).
`host/agents/child.ts` (`runChild`) therefore creates the child itself with `parent.ctx.agents.create`
and the composition helpers DSH exports for sub-agent *providers* (`applyChildComposition`,
`childSessionMeta`, `resolveChildAgentOptions`, `resolveChildDepth`, `captureDelegatedPolicyOverrides`,
`appendDelegatedPolicyOverrides` from `@deepseek-ai/dsh-subagent`; `validateJsonSchemaValue` and
`ToolArgsError` from `@deepseek-ai/dsh-tools`), registers its tools on the child's own scope, and
ends it with a `submit_result` tool whose arguments are the result.

This is accepted on purpose, because per-agent tools are a core feature of the bundle. The
consequences, and how they are contained:

- **Version series.** The packages declare DSH `>=0.2.0-rc.2 <0.3.0` (`dsh.engines` and the peer
  dependency): the 0.2 series, release candidates included, which are not expected to change these
  helpers; the dev dependencies are the exact version the types come from, bumped when convenient.
  `tests/support/dsh-contract.spec.ts` fails if an installed package leaves the 0.2 series or a helper
  disappears, so a move to 0.3 is a deliberate piece of work, not a surprise.
- **One file.** Nothing else builds an agent below the public API; when DSH offers per-agent tools
  properly, `runChild` is what is replaced.
- **Not in the parent's catalog.** Such a child writes no sub-agent descriptor (that part of DSH is
  internal), so it does not show in the parent's list of sub-agents. It is an ordinary child session
  otherwise (verified with DSH's invariants in the real-loop tests).
- **When DSH changes**, re-read `docs/subsystems/subagent.md` and the in-process driver
  (`packages/subagent/subagent-in-process-driver`, which does the same composition) and port
  `runChild` to match.

## Taking the story back, putting sessions away, deleting them

- **Replace markers.** `Session.append('user/message', ..., { surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs })` over a stretch of the model's
  conversation (the public append, as DSH's own compaction does it) keeps turns out of the next request, and `surfaceOp: 'append'` adds a notice. It is accepted over a
  middle range with newer turns after it, and also inside the first step of the next turn. DSH's Chat view does not hide the rows it replaced, so the client leaves them out
  itself (`TurnsDock`, by the key DSH gives each row). Shadowed turns never come back to the conversation: going forward again is told as a notice.
- **`session/event`** (a public event) tells when a turn ends, which fixes where it stands in the log.
- **Branches.** `ctx.sessions.fork({ sessionId, atSeq, increaseTitle })` on the client (`ISessions`, the same call DSH's own branch button makes) makes the chat; on the host the
  public `agent/created` event (serial, awaited before creation resolves) carries the new agent, whose header has `isSeeded`, `parentSession` and whose session has
  `inheritedEventCount` (the cut is one before it), so the roleplay session is made before the chat is first used, and a failure refuses the fork.
- **Archive and restore** are DSH's own `workspaceRegistry.archiveSession` (with `stopActivity`) and `unarchiveSession`.
- **Deleting a chat for good is not an API of DSH.** `host/agent/purge.ts` removes the folders DSH keeps (`<store>/--<project>--/<session id>/`, one for the chat and one for each
  sub-agent session it started, found through `origin: 'subagent'` and `parentSession` in `sessionPersistence.list()`) after stopping the chat and flushing it, naming the
  folders as DSH's JSONL store does (`projectKey`, `encodeSegment`), and refusing a folder that is a link, is not named as the session, or holds no log. Its location is the
  config `sessionStorePath` (default `~/.dsh/sessions`). DSH keeps the id in its workspace accounting and its projection cache (stock DSH has no way to forget it; a cache that
  has `delete` is told); the leftover is not listed or read again (verified live). It emits `api-session/removed`, the event DSH's own controller emits. A change of the store
  layout in DSH would show first in `tests/host/agent/purge.spec.ts` and in a live delete.

## Prompts, language and messages sent for the person

- **System prompt sections** (`ctx.systemPrompt.section`) take a `text` provider `(context) => string` evaluated at each assembly; `context.agent` (an `AssembleContext` merge from `dsh-agent`) is the agent being assembled, so a section can follow the chat's language. A preset's `dsh-persona` row with `prefix: ''` shadows the deployment persona and then disappears at render, which leaves the persona section to us. `{{...}}` in a section is read as a prompt variable unless the section sets `interpolate: false`; the prompt files avoid it either way.
- **`sessionController.prompt(request, signal)`** needs the `AbortSignal` (without it the call fails inside DSH with `throwIfAborted` of undefined). It is how the plugin sends a message into a chat for the person (the card import's `/import-st`).
- **A stored chat that starts with an opening** needs an empty `system/message` appended with `surfaceOp: 'append'` before any other surface node: the log format refuses a system prompt that follows other nodes.

## When upgrading DSH

Read the upgrade guides, then check each row above: typecheck first (the types are the
contract), then the real-loop tests in `tests/host/orchestration/loop.spec.ts`, which run the
actual agent loop, sub-agents, tool registry and compaction with a scripted model.
