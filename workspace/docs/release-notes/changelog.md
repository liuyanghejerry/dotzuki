# Changelog

> - **Audience**: rust developers, game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

Engine version history. Version numbers follow the workspace version
(`workspace/Cargo.toml`, shared by every `dotzuki-*` crate); each release ships
with a migration guide under `migration/` (created per release).

## Format

- Each version lists **breaking changes** first (with a link to its migration
  guide), then notable additions and fixes.
- Doc bodies do not mention "since vX.Y" — this page is the single place for
  version history (doc-standard §10).

## Unreleased

## v0.1.0

Initial published version of the engine workspace: core engine, battle
effect-stack, `dotzuki-rules`, DSL compiler, runner, CLI, renderer, UI, audio,
app/tui/web shells, and the dotzuki-editor toolchain. (Backfill from git
history before the first release if this entry ships as a placeholder.)
