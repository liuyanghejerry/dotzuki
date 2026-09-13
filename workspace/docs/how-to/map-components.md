# Edit linked buildings and auto-tiles

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.8.2

Reuse pixel artwork across a map and select terrain edges, inner corners, and wall junctions
from neighboring cells.

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

## Draw auto-tiles

An [auto-tile](../reference/glossary.md#map-components) set supports one of two modes:

- `cardinal` uses sixteen variants for thin walls, fences, pipes, and paths. The mask checks
  north, east, south, and west.
- `blob` uses 47 variants for filled ground, shores, and cliff tops. The mask also checks four
  diagonal cells, so the editor can select inner-corner artwork.

Create one nonempty 1×1 building group for every required variant. Keep the outline and light
direction consistent across the groups. Open **Maps > Auto-tile > Sets**, create a set, and
choose its neighbor mode. Each mask card shows the occupied cells around the center and lets
you choose its building artwork. **Assign in library order** maps the first 16 or 47 one-cell
buildings to the canonical masks in ascending order.

Click **Save** to write `connections.json` inside the configured shared tiles directory. The
following complete `cardinal` set documents the saved format for source control and automation.
Older projects may omit `mode`; the editor treats a missing mode as `cardinal`.

```json
{
  "version": 2,
  "sets": [{
    "id": "plaster",
    "name": "Plaster walls",
    "mode": "cardinal",
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
south=4, and west=8. A `blob` set also adds north-east=16, south-east=32, south-west=64,
and north-west=128. The editor counts a diagonal only when both adjoining cardinal cells exist.
This rule produces these 47 canonical blob masks:

`0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 23, 27, 31, 38, 39, 46, 47,
55, 63, 76, 77, 78, 79, 95, 110, 111, 127, 137, 139, 141, 143, 155, 159, 175, 191, 205,
207, 223, 239, 255`.

Choose `blob` in the rule editor and map every number in that list to a building group ID. An
east-west cardinal wall uses variant 10; a fully surrounded blob cell uses variant 255.
Different sets and layers do not connect to one another.

Select **Auto-tile**, choose a set, and wait for **Preparing tiles…** to disappear. Drag on a
visual layer. Left-drag adds cells; right-drag removes cells and restores covered cells. The
canvas previews the final edges, corners, junctions, and end caps during the stroke. Releasing
the pointer commits one undo step. Touchpad users can select **Erase** and remove cells with a
left-drag; a right-drag always erases regardless of the selected action. Choose a 1×1, 2×2, or
3×3 brush from the size menu.

The auto-tile brush edits visual cells. Paint the corresponding collision layer for blocked
walls or cliffs, and leave doorway and ramp cells passable. Use a `blob` set for a cliff top and
place deeper cliff faces, ramps, and doors as linked buildings on the required visual layer.

## Keep imported atlas artwork

Building stamps and component updates retain existing GIDs and copy old pixels directly from
the map's `tileset.png`. Old artwork does not need matching shared-library PNGs. Missing
column metadata is inferred from the image width. New component cells append to the atlas.

If neither the atlas nor its referenced shared tiles is available, preparation reports an error
before writing files. Restore the missing image and retry. Map save and undo affect map cells;
appended atlas slots remain available after undo. The editor does not compact unused slots.

For asset backup and source formats, see [Assets](./assets.md).

For complete PNG components at a higher pixel density than the logical map grid, see [Arrange native-resolution map scenery](./native-map-art.md).
