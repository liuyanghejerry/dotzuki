# Arrange native-resolution map scenery

> - **Audience**: game authors, tool developers
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.8.2

Move detailed pixel artwork over an existing map while keeping its logical grid and collision
data separate.

Before you start, read [Maps](./maps.md) and [linked building editing](./map-components.md).
Configure map and tiles activities in your [project manifest](../reference/project-manifest.md).

## Prepare a compatible map

[Native scenery](../reference/glossary.md#native-map-scenery) uses an optional `art.json` beside
`map.tmx.json`. Your game's runtime must consume this scenery contract. This editor feature does
not change the generic runner's rendering or convert a tilemap automatically.

For a 4×3 map with 16×16 logical tiles, create a 128×96 ground PNG and a 32×64 tree PNG. Save
them as editable building groups in your configured tiles directory. This example assumes
sibling `maps` and `tiles` directories:

```json
{
  "version": 1,
  "pixels_per_unit": 2,
  "ground": "../../tiles/groups/ground.png",
  "components": [
    {
      "image": "../../tiles/groups/tree.png",
      "x": 16,
      "y": 0,
      "foot_y": 16,
      "layer": "depth"
    }
  ]
}
```

Image paths are relative to the map directory and must resolve inside the configured data root.
Density is an integer from 1 to 4. Ground dimensions equal map size × logical tile size ×
density; every component image dimension must be divisible by density. An optional `water_mask`
PNG must have the same dimensions as the ground. The editor displays this mask for inspection;
it does not animate it.

## Arrange and inspect objects

1. Open the map and click **Native scenery**. The new tab displays the ground and complete
   component images with sharp pixel edges. At 100%, each source pixel occupies one CSS pixel.
2. Click an opaque part of an object or choose it from the filtered object list. Transparent
   image corners let you select objects underneath.
3. Drag to move. **Snap to tiles** snaps the movement delta to the logical grid. Arrow keys move
   one logical pixel; Shift + arrow moves one tile. Set **X**, **Y**, or **Sorting foot Y** for
   exact placement. Moving Y also moves the sorting anchor.
4. Choose **Ground** for bridges and floor details, **Depth sorted** for buildings and trees, or
   **Foreground** for fixed overlays. Depth objects sort by `foot_y`, with original component
   order breaking ties. The cyan line marks the selected object's sorting anchor.
5. Enable **Collision**, **Grid**, or **NPCs and exits** to compare scenery with saved map data.
   These overlays show base collision and authored object positions; conditional events and
   actor movement still need a playtest. Edit collision and entity positions in the tilemap tab,
   save there, and reload the scenery tab.
6. Choose a library image and click **Place library object** to add it near the center of the
   visible area. You can duplicate or remove existing objects. These operations change scenery
   only; they do not create or remove collision cells.

## Edit pixels and save

Select a component and click **Edit pixels** to open its building group in the existing pixel
editor. The ground has its own edit button. Save the PNG and layers there, then return to the
scenery tab. Source images refresh while unsaved positions and undo history remain intact.

**Save scenery** writes only `art.json`. Unknown map-art and component fields are preserved.
Undo/redo remains available after saving, so undoing a saved edit makes the tab unsaved again.
Switching tabs preserves each open arrangement; closing a dirty scenery tab asks before
discarding it.

If another tool changed `art.json` after you opened it, saving reports a conflict and leaves
both the file and your unsaved arrangement intact. Review the external change before choosing
**Reload from disk**, which discards the local arrangement after confirmation. Missing images,
incorrect ground sizes, invalid density, and misaligned component dimensions prevent a save.
