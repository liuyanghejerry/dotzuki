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

First published release (crates.io). The engine workspace's version line
resets from the v0.5.x pre-release tags (`v0.5.0`, `v0.5.1`) to `0.1.0`;
every `dotzuki-*` crate publishes at 0.1.0, and the tag-driven release
pipeline lands: `workspace/scripts/publish-crates.sh`, the release
workflow, and the package-check PR gate. The code at tag `v0.1.0` is one
commit past `v0.5.1` — no API changes in the jump. Pre-release consumers
switch their git tags from `v0.5.x` to `v0.1.0` (or to the registry form)
per [the migration guide](migration/v0.1.0.md).
