# Edit linked buildings and connected walls

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.6.0

Reuse pixel artwork across a map and select wall corners from neighboring cells.

Before you start, read [Maps](./maps.md) and configure the map and tiles activities
in your [project manifest](../reference/project-manifest.md).

## Place and update buildings

1. Open **Maps** and select a map. Double-click a building thumbnail to edit its pixels.
2. Save the building. Its PNG and editable layer sidecar remain in the shared tiles directory.
3. Select a visual layer, enable **Link buildings**, and stamp the building on the map.
4. Edit and save that building again, then click **Update components** on the map toolbar.
5. Save the map. Repeat the update on other maps that use the same building.

A [linked component](../reference/glossary.md#map-components) stores its source ID,
revision, position, previous cells, and covered cells on the map layer. Updates preserve
positions and restore previous cells when source pixels become transparent. The toolbar
reports updated and skipped instances. Resized sources, missing sources, or externally
changed footprints require review; updates do not overwrite those footprints.

Normal tile painting detaches any component that covers the edited cell. Disable
**Link buildings** before stamping an independent copy. Undo and redo restore pixels and
links together. An update creates one undo entry per changed layer. Resizing the map moves
links with their cells and drops links whose footprints extend outside the new dimensions.

Existing stamps created before this feature remain independent until replaced with linked stamps.

## Draw connected walls

Create sixteen nonempty 1×1 building groups for one wall material. Use the same thickness,
outline, and light direction for every group. Store the following file as `connections.json`
inside the configured shared tiles directory. Replace each group ID with your artwork's ID.

```json
{
  "version": 1,
  "sets": [{
    "id": "plaster",
    "name": "Plaster walls",
    "variants": {
      "0": "wall-island", "1": "wall-n", "2": "wall-e", "3": "wall-ne",
      "4": "wall-s", "5": "wall-ns", "6": "wall-es", "7": "wall-nes",
      "8": "wall-w", "9": "wall-nw", "10": "wall-ew", "11": "wall-new",
      "12": "wall-sw", "13": "wall-nsw", "14": "wall-esw", "15": "wall-cross"
    }
  }]
}
```

The [connection mask](../reference/glossary.md#map-components) adds north=1, east=2,
south=4, and west=8. For example, an east-west wall uses variant 10; an isolated cell uses 0.
Different sets and layers do not connect to one another.

Reload the editor, select **Walls**, choose a set, and drag on a visual layer. Left-drag adds
walls; right-drag removes walls and restores covered cells. Adjacent walls select their
corners, junctions, and end caps after each stroke. Undo restores the entire stroke.
Use right-drag in **Walls** when erasing so neighboring end caps update too.

The wall brush edits visual cells. Paint the corresponding collision layer for blocked walls,
and leave doorway cells passable. Place wall faces and doors as separate linked buildings.

## Keep imported atlas artwork

Building stamps and component updates retain existing GIDs and copy old pixels directly from
the map's `tileset.png`. Old artwork does not need matching shared-library PNGs. Missing
column metadata is inferred from the image width. New component cells append to the atlas.

If neither the atlas nor its referenced shared tiles is available, preparation reports an error
before writing files. Restore the missing image and retry. Map save and undo affect map cells;
appended atlas slots remain available after undo. The editor does not compact unused slots.

For asset backup and source formats, see [Assets](./assets.md).
