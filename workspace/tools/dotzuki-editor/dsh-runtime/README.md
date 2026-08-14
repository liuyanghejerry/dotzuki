# dotzuki-editor — DeepSeek Harness runtime (optional)

Standalone install of the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) agent runtime for the editor's assistant. When a provider profile has
`kind: "dsh"`, the assistant chat delegates its turns to a LOCAL dsh subprocess
(stdio JSON-RPC) instead of the Vercel AI SDK — the agent works on the game
project directly with its own tools (persistent bash, string-replace editor,
filesystem), and the editor streams dsh session events into the same chat UI.

## Install

This directory is deliberately **not** part of the `workspace/tools` pnpm
workspace (its deps are heavy and only needed for this backend). Install it
once, on demand:

```sh
cd dsh-runtime
pnpm install
```

The editor probes `dsh-runtime/node_modules/.bin/dsh-jsonrpc-agent` +
`cordis.yml` (`GET /api/dsh/status`); no editor restart is needed.

## What lives here

- `package.json` — the dsh runtime closure, pinned to one consistent release
  train (currently `0.1.0-rc.6`). DeepSeek Harness is a developer preview:
  expect breaking changes across releases, and re-verify `cordis.yml` when
  bumping.
- `cordis.yml` — the runtime composition, adapted from the official
  `examples/jsonrpc-agent/minimal.cordis.yml`: JSON-RPC server, DeepSeek LLM
  adapter, local sandbox (full access to the project root), persistent bash,
  string-replace editor, and JSONL session persistence under
  `<project>/.dsh-sessions/`. The model, workspace, persona, and session root
  are env-driven — the editor sets them per launch (see `server/dsh.ts`):
  - `DEEPSEEK_API_KEY` — the transient key the browser sends per request
  - `DSH_MODEL` — model id (default `deepseek-v4-flash`)
  - `DSH_CWD` — the open game project root
  - `DSH_SYSTEM_PROMPT` — the dotzuki-editor persona
  - `DSH_SESSION_ROOT` — session log persistence root

## Troubleshooting

- `GET /api/dsh/status` → `installed: false`: run `pnpm install` here (or set
  `DOTZUKI_DSH_BIN` / `DOTZUKI_DSH_CONFIG` to a custom runtime).
- Provider "Test" / chat fails with an auth error: your DeepSeek API key
  (https://platform.deepseek.com/api_keys) is missing or invalid.
