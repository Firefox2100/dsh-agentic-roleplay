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
| The chat of a session | `ctx.sessionController.create/rename`, `ctx.workspaceRegistry.create/archiveSession`, `workspace.attachSession`, `ctx.sessionPersistence` | `host/agent/` |
| Agent presets | the `@deepseek-ai/dsh-agent-preset` row with `plugins` (persona, our two plugins, a `compaction` group) | the bundle's `cordis.patch.yml` |
| Game master tools | `ctx.tools.register(defineTool(...))` | `host/orchestration/tools.ts`, `@dsh-agentic-roleplay/state` |
| Prompt | `ctx.systemPrompt.section` | `orchestration.ts` |
| Turn control | `agent/pre-step` (waterfall), `agent/turn-stopping`, `agent.steer`, `exec.concludeTurn()`, `exec.agent`, `exec.signal` | `host/orchestration/hooks.ts`, `tools.ts` |
| Chronicler (no tools of its own) | a `runChild` child with a `submit_result` of its own (below) | `compaction/chronicler.ts` |
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

## Helper agents

Characters, the record keeper, the world author, the faction strategist and the other one-shot helpers are *children with tools of their own*: a tool built around
Alice's memory must give Bob's agent, running at the same time, nothing of it, and a child ends by calling a `submit_result` tool after looping (so it can read, write,
check and fix). `host/agents/child.ts` (`runChild`) does this through public API only:

- **Start.** `ctx.get('subagents').startActivation({ provider: 'spawn', childId, delivery: 'caller', request: { parent, agentPreset: 'roleplay-helper', agentOptions, prompt } })`.
  The caller reserves the child's session id (`childId`) first, so what it needs to hand the child is registered under that id before the child exists. (`parent.ctx.subagents`
  throws without an `inject` on the owning plugin; `ctx.get('subagents')` does not.)
- **The preset.** `roleplay-helper` is a `@deepseek-ai/dsh-agent-preset` row in the bundle's patch (so a standalone core install has no helpers). It mounts the `core/helper`
  plugin, which gives the child its persona (a system-prompt section read by session id) and, on the public `agent/created` event, calls the child's `setup`. A preset is shared by
  every agent that uses it, so nothing per child lives in the plugin: it is looked up by the child's session id.
- **Tools of its own.** A spawned child inherits every global tool (the story's readers, DSH's working directory), so `setup` first calls `agent.ctx.tools.restrict({ allow })`
  (`allow` is only the external tools the task lets through), then registers the child's tools on `agent.ctx`, which `restrict` never touches. The `submit_result` tool, the call
  budget, the repeated-call guard and the reminders are registered the same way.
- **Costs.** Each run adds a `subagent/catalog` event to the game master's log (a few hundred bytes, also after the turn ended, so the last event of a finished turn is not always
  `turn/end`). DSH admits at most `maxActiveSubagents` children of one parent at once (default 8) and refuses the rest, so the bundle patch raises it to 32 for a round of
  characters plus the keeper, author and suggestions.
- **Exact tested release.** The packages declare DSH `>=0.2.1-rc.2 <0.2.2` (`engines.dsh` and the peer dependency). Development dependencies and
  `tests/support/dsh-contract.spec.ts` are pinned to the exact tested release; `scripts/dsh-compat.mjs` is the one list these are derived from. Supporting a later patch tuple
  requires inspecting its changes, porting every affected integration, and testing against that exact release before widening the range.
- **When DSH changes**, re-read `docs/subsystems/subagent.md` and port `runChild` to match; the real-loop tests in `tests/host/orchestration/loop.spec.ts` mount the helper
  plugin through a stand-in `agentPresets` service.

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
