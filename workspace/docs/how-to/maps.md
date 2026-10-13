# Maps

How to define maps: Tiled JSON, tileset, `objects.json` sidecar, levels, and encounters.

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.10.0

Before you start, read [the project manifest](../reference/project-manifest.md),
which defines the map directories and the runner contract these files plug
into.

## Map files

A map is `<mapsDir>/<id>/map.tmx.json` (Tiled JSON; the layer named
`collision` marks blocked tiles, every other layer renders) plus
`tileset.png` (full-color atlas, GIDs 1-based, row-major) plus an optional
objects sidecar — `objects.json` (editor-written) with
`npcs: [{id,name,x,y,facing,sprite,talk}]`, `warps: [{x,y,dest_map,dest_x,dest_y}]`,
`signs: [{x,y,text}]` (face the sign tile + A reads its text as paged
dialogue) and an optional `encounters` block (below)
(the runner reads legacy `map.json` as a fallback). Walking onto a warp tile fades to
the destination map.

## Elevation levels

Maps may be multi-level (walk on the ground *and* on
wall tops). Collision per level: layers named `collision` (level 0),
`collision1`, `collision2`, … — a non-zero GID is solid at that level; these
layers never render. Missing intermediate levels count as all-solid.
A layer named `stairs` marks transition tiles (never rendered): GID 1
ascends one level on arrival, GID 2 descends one (clamped to the map's
levels). Visual layers carry an optional integer custom property `level`
(default 0): layers with `level <= player elevation` render below the
sprites, layers above render over them. Maps with only a `collision` layer
behave exactly as single-level maps.

## Random encounters

A map opts into wild
battles with an `encounters` block in its objects sidecar — the same shape
as pokered's `wild_data`: a per-step `rate` byte in **/256 units** (`25` ≈
9.8% per step) plus tile-rectangle zones, each with a weighted table:

```json
"encounters": {
  "rate": 25,
  "zones": [
    { "x": 0, "y": 5, "w": 8, "h": 3,
      "table": [ { "id": "slime", "weight": 70 }, { "id": "bug-catcher", "weight": 30 } ] }
  ]
}
```

Zone coordinates are map tiles, the rectangle **inclusive** of its `w`×`h`
extent. A completed walk step onto a zoned tile rolls once: one rng byte
`< rate` hits, then a weighted draw from the zone's `table` picks the id
(`weight` is relative, default 1). The id resolves exactly like
`startBattle(id)` — an encounter record first (trainer parties/queues
included), then a single enemy record — and arms a **sceneless** battle (see
[the battle rules](../reference/battle-rules.md)). Step resolution priority
is: **warp > encounter roll > plain walk** — stepping onto a warp tile
never rolls, and turning in place is not a step. Absent (or `null`)
`encounters` ⇒ the map never rolls — older sidecars keep working unchanged.

The encounter record schema lives in
[Encounter records](../reference/data-tables/encounters.md); sceneless
battle outcomes live in [battle rules](../reference/battle-rules.md).

## Click to move

[Click to move](../reference/glossary.md#maps) lets players select a walkable map tile
in the editor's **Play** activity, desktop player, Web export, or Android/HarmonyOS export.
The player follows a four-direction route. You can use the existing map format.
A yellow outline marks the destination. An unreachable destination, or a search that exceeds
16,384 states, flashes red. Walls and NPCs block routes. Every completed step
still processes stairs, warps, and random encounters.

Another click replaces the destination after the current step finishes. Directional input
cancels [navigation](../reference/glossary.md#maps) and takes control. Dialogue, menus, battles,
warps, focus loss, map reload, and save import cancel the route; returning to play does not resume it.
The game ignores clicks during menus or dialogue. Drags, multiple fingers, and virtual controls
do not create goals.

Routes stay within the current map. Clicking an NPC does not start a conversation; A retains
its interaction behavior. Ordinary destinations use the player's collision layer; stair targets
use the layer after entering that stair. Overlapping floors have no separate layer picker.
A destination warp may change maps, but a route cannot pass through an intermediate warp.

Custom Rust games must wire navigation and pointer callbacks into their own game loop.
Updating dependencies alone does not enable this behavior. For iOS host integration, see
[Native Touch Controls](../../crates/dotzuki-mobile/controls/README.md).
