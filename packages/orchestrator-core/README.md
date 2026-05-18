# @telegraph/orchestrator-core

Telegraph-internal graph orchestration core.

This package is the controlled migration target for:

`/Users/ryuyutyo/Documents/code/modules/ai/langgraphjs/libs/orchestrator`

Source snapshot:

- Upstream package name: `@orchestrator/core`
- Upstream version: `0.1.0`
- Migrated on: `2026-05-19`
- Core exports: `StateGraph`, `Annotation`, `START`, `END`, `Send`, `Command`, checkpoint, interrupt, runnable, and swarm primitives

Migration boundary:

- Included: `src/`, source tests, `UPSTREAM_README.md`
- Excluded: `dist/`, `node_modules/`, `.turbo/`, `playground/`
- Runtime dependencies: none
- Forbidden dependencies: Electron, React, x-oasis, `@telegraph/agent-protocol`, `@telegraph/agent`

Telegraph code should consume this package only from adapter/runtime implementation layers. Protocol packages and renderer/pagelet UI should continue to speak in `AgentEvent` / `RuntimeEvent` terms rather than importing graph primitives directly.
