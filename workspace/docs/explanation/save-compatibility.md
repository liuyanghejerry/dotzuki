# Save compatibility

Save versioning, forward/backward save rules, and the compatibility rules every tool must honor.

> - **Audience**: game authors, rust developers
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

The game saves to `<project>/.dotzuki-save.json` (override with
`--save-file`) — versioned JSON: `{version, map, player: {x, y, facing, level?},
flags, lang, party?, inventory?, money?}` (v3). The runner-side save/load
contract lives in [Save/load](../reference/project-manifest.md#saveload).

- `party`/`inventory` appear once a battle has completed.
- Party members may carry optional `level`/`exp` fields when the battle
  has a `levels` block — absent ⇒ level 1 / 0 EXP.
- `money` is always written.
- `player.level` is the map elevation level, absent ⇒ 0.

## When saves are written

Saves are written only from **stable** states — after a completed
warp transition and when a scene finishes into the overworld — never
mid-scene or mid-warp (a suspended scene engine can't resume), so closing
the window mid-dialogue keeps the last stable point. The Start menu's
**Save** entry writes the same file on demand (always allowed, even in
headless runs).

Windowed runs always write saves; `--headless` never writes unless
`--save` is passed (CI stays side-effect-free).

## Backward compatibility: loading older saves

Loading accepts any version `<=`
the current one with per-field defaults — **v1/v2 saves still resume** (no
`party`/`inventory` ⇒ both start fresh; no `money` ⇒ the manifest's
`shop.startMoney` default applies). Per-member `level` + `exp` are OPTIONAL
fields; absent ⇒ level 1 / 0 EXP, so the save version stays 3 and older
saves keep loading.

On boot a valid save resumes: flags are restored, the saved
map loads, the player is placed at the saved tile (spawn-scan fallback if it
became occupied), the party state, inventory and money ride along, and the
opening dispatch is skipped — the restored `__played_main_*` flags keep
`main` from replaying on later entries.

## Forward compatibility: newer or broken saves

A missing/corrupt/**newer**-version save warns and boots fresh. `--fresh`
ignores the save; `--map` overrides its map.

## Project compatibility rules

- **`.dotzuki-editor.json` is the only manifest.** No tool may require a second
  config file in a game project.
- **Unknown keys are tolerated.** Readers must ignore keys they do not know
  (top-level, per-activity, and inside `config`); a tool that rewrites the
  manifest should preserve them. The same holds for the per-map
  `objects.json` sidecar: the editor passes keys it does not know (e.g. a
  hand-authored `encounters` block) through untouched.
- **Sidecar precedence is `objects.json` over `map.json`.** `dotzuki new` and
  older projects scaffold `map.json`, but once the editor saves a map's
  entities it writes `objects.json`, which then shadows `map.json` (the
  runner reads `objects.json` first and only falls back). Known current
  behavior, recorded here — not changed.
- **The `game` section is optional.** The editor fully supports projects
  without it; CLI consumers apply the
  [`game` section defaults](../reference/project-manifest.md#the-game-section).
- **Round-trip guarantee.** `dotzuki new` output opens in the editor unchanged,
  and an editor-wizard project passes `dotzuki check`. Both scaffolders emit the
  same layout, the same seven activities (maps, scripts, play, data, story,
  assets, tiles) with the same config shapes, and structurally equal starter
  scenes. The intentional differences: the `game` section (only `dotzuki new`
  writes it), and the starter *content* — the editor's scaffolder seeds the
  demo map, tile library, sample records, and story bible described in the
  [directory layout](../reference/project-manifest.md#directory-layout),
  while `dotzuki new` emits the minimal skeleton.
