//! Retain decoded data by byte budget. Render scratch belongs to the caller's map handle.
use super::*;
use std::collections::VecDeque;
use std::mem::size_of;

const DEFAULT_BUDGET: usize = 8 * 1024 * 1024;

struct Entry {
    data: Arc<MapData>,
    sources: Option<MapSources<'static>>,
    bytes: usize,
}

pub(crate) struct MapCache {
    entries: VecDeque<Entry>,
    used: usize,
    budget: usize,
}

impl Default for MapCache {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            used: 0,
            budget: DEFAULT_BUDGET,
        }
    }
}

impl MapCache {
    pub(crate) fn set_budget(&mut self, bytes: usize) {
        self.budget = bytes;
        self.trim(bytes);
    }

    fn trim(&mut self, limit: usize) {
        while self.used > limit {
            let entry = self
                .entries
                .pop_front()
                .expect("nonzero cache weight has an entry");
            self.used -= entry.bytes;
        }
    }

    pub(crate) fn invalidate(&mut self, id: &str) {
        if let Some(i) = self.entries.iter().position(|e| e.data.id == id) {
            self.used -= self.entries.remove(i).unwrap().bytes;
        }
    }

    pub(crate) fn load(
        &mut self,
        files: &dyn ProjectFiles,
        maps_dir: &str,
        id: &str,
    ) -> Result<RuntimeMap> {
        if self.budget == 0 {
            return RuntimeMap::load_with_files(files, maps_dir, id);
        }
        let dir = join_path(maps_dir, id);
        // Mutable backends compare the exact inputs. This also catches edits to inactive maps,
        // a new preferred sidecar, or same-length replacements between watcher events.
        let mutable = !files.is_immutable();
        let sources = if mutable {
            Some(MapSources::read(files, &dir)?)
        } else {
            None
        };
        if let Some(i) = self.entries.iter().position(|e| e.data.id == id) {
            let entry = self.entries.remove(i).unwrap();
            if entry.sources.as_ref() == sources.as_ref() {
                let map = RuntimeMap::from_data(Arc::clone(&entry.data));
                self.entries.push_back(entry);
                return Ok(map);
            }
            self.used -= entry.bytes;
        }
        let sources = match sources {
            Some(s) => s,
            None => MapSources::read(files, &dir)?,
        };
        let map = RuntimeMap::decode(id, &dir, &sources)?;
        let bytes = size_of::<Entry>()
            + map.data.resident_bytes()
            + if mutable { sources.resident_bytes() } else { 0 };
        if bytes <= self.budget {
            self.trim(self.budget - bytes);
            self.entries.push_back(Entry {
                data: Arc::clone(&map.data),
                sources: mutable.then(|| sources.owned()),
                bytes,
            });
            self.used += bytes;
        }
        Ok(map)
    }
}

impl MapSources<'_> {
    fn resident_bytes(&self) -> usize {
        let cost = |bytes: &Cow<'_, [u8]>| match bytes {
            Cow::Borrowed(slice) => slice.len(),
            Cow::Owned(v) => v.capacity(),
        };
        cost(&self.tmx) + cost(&self.png) + self.sidecar.as_ref().map_or(0, |(_, b)| cost(b))
    }

    fn owned(self) -> MapSources<'static> {
        MapSources {
            tmx: Cow::Owned(self.tmx.into_owned()),
            png: Cow::Owned(self.png.into_owned()),
            sidecar: self
                .sidecar
                .map(|(name, b)| (name, Cow::Owned(b.into_owned()))),
        }
    }
}

fn vec_bytes<T>(v: &Vec<T>) -> usize {
    v.capacity() * size_of::<T>()
}

impl MapData {
    fn resident_bytes(&self) -> usize {
        let layer_tiles = self
            .state
            .layers
            .iter()
            .map(|layer| vec_bytes(&layer.tilemap.entries))
            .sum::<usize>();
        let collision_grids = self.collision_levels.iter().map(vec_bytes).sum::<usize>();
        // The Arc allocation also holds two reference counts.
        size_of::<Self>()
            + 2 * size_of::<usize>()
            + self.id.capacity()
            + vec_bytes(&self.draw_order)
            + vec_bytes(&self.state.layers)
            + layer_tiles
            + vec_bytes(&self.collision_levels)
            + collision_grids
            + self.stairs.as_ref().map_or(0, vec_bytes)
            + self.tileset.pixel_bytes()
            + self.objects.heap_bytes()
    }
}

impl MapObjects {
    fn heap_bytes(&self) -> usize {
        let npcs = self
            .npcs
            .iter()
            .map(|n| {
                n.name.capacity() + n.facing.capacity() + n.sprite.capacity() + n.talk.capacity()
            })
            .sum::<usize>();
        let signs = self.signs.iter().map(|s| s.text.capacity()).sum::<usize>();
        let warps = self
            .warps
            .iter()
            .map(|w| w.dest_map.capacity())
            .sum::<usize>();
        let encounters = self.encounters.as_ref().map_or(0, |e| {
            vec_bytes(&e.zones)
                + e.zones
                    .iter()
                    .map(|z| {
                        vec_bytes(&z.table)
                            + z.table
                                .iter()
                                .map(|entry| entry.id.capacity())
                                .sum::<usize>()
                    })
                    .sum::<usize>()
        });
        vec_bytes(&self.npcs)
            + npcs
            + vec_bytes(&self.signs)
            + signs
            + vec_bytes(&self.warps)
            + warps
            + encounters
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{tileset_png, TWO_LEVEL_TMX};
    use super::*;
    use crate::pack::{encode_pack, PackFiles};
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;

    fn assets() -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::new();
        for id in ["A", "B", "C"] {
            files.insert(
                format!("maps/{id}/map.tmx.json"),
                TWO_LEVEL_TMX.as_bytes().to_vec(),
            );
            files.insert(format!("maps/{id}/tileset.png"), tileset_png());
        }
        files
    }

    struct CountPack {
        pack: PackFiles,
        reads: Cell<usize>,
    }
    impl ProjectFiles for CountPack {
        fn read(&self, _: &str) -> Result<Vec<u8>> {
            panic!("packed maps should borrow their inputs")
        }
        fn read_bytes(&self, path: &str) -> Result<Cow<'_, [u8]>> {
            self.reads.set(self.reads.get() + 1);
            self.pack.read_bytes(path)
        }
        fn list(&self, prefix: &str) -> Vec<String> {
            self.pack.list(prefix)
        }
        fn is_immutable(&self) -> bool {
            true
        }
    }

    #[test]
    fn packed_revisits_skip_reads_and_promote_the_map_under_byte_pressure() {
        let files = CountPack {
            pack: PackFiles::from_bytes(encode_pack(&assets(), serde_json::Value::Null)).unwrap(),
            reads: Cell::new(0),
        };
        let mut cache = MapCache::default();
        let a = cache.load(&files, "maps", "A").unwrap();
        let weight = cache.used;
        cache.set_budget(weight * 2);
        let b = cache.load(&files, "maps", "B").unwrap();
        let reads = files.reads.get();
        assert!(Arc::ptr_eq(
            &a.data,
            &cache.load(&files, "maps", "A").unwrap().data
        ));
        assert_eq!(files.reads.get(), reads);
        cache.load(&files, "maps", "C").unwrap();
        assert!(Arc::ptr_eq(
            &a.data,
            &cache.load(&files, "maps", "A").unwrap().data
        ));
        assert!(!Arc::ptr_eq(
            &b.data,
            &cache.load(&files, "maps", "B").unwrap().data
        ));
        assert!(b.is_blocked(0, 0)); // A live handle survives eviction.
        for limit in [weight - 1, 0] {
            cache.set_budget(limit);
            assert!(cache.load(&files, "maps", "A").unwrap().is_blocked(0, 0));
            assert_eq!(cache.used, 0);
        }
    }

    struct Editable(RefCell<BTreeMap<String, Vec<u8>>>);
    impl ProjectFiles for Editable {
        fn read(&self, path: &str) -> Result<Vec<u8>> {
            self.0
                .borrow()
                .get(path)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing {path}"))
        }
        fn list(&self, _: &str) -> Vec<String> {
            self.0.borrow().keys().cloned().collect()
        }
    }

    #[test]
    fn revisiting_an_edited_map_rechecks_all_inputs_and_sidecar_precedence() {
        let files = Editable(RefCell::new(assets()));
        let mut cache = MapCache::default();
        let load = |cache: &mut MapCache| cache.load(&files, "maps", "A").unwrap();
        let first = load(&mut cache);
        assert!(Arc::ptr_eq(&first.data, &load(&mut cache).data));
        cache.load(&files, "maps", "B").unwrap();
        let tmx = TWO_LEVEL_TMX.replace("[1,0,1,0,0,1]", "[0,0,1,0,0,1]");
        files
            .0
            .borrow_mut()
            .insert("maps/A/map.tmx.json".into(), tmx.into_bytes());
        let edited = load(&mut cache);
        assert!(!edited.is_blocked(0, 0));
        assert!(first.is_blocked(0, 0));
        let legacy = br#"{"signs":[{"x":0,"y":0,"text":"old"}]}"#;
        files
            .0
            .borrow_mut()
            .insert("maps/A/map.json".into(), legacy.to_vec());
        assert_eq!(load(&mut cache).objects().signs[0].text, "old");
        let preferred = br#"{"signs":[{"x":0,"y":0,"text":"new"}]}"#;
        files
            .0
            .borrow_mut()
            .insert("maps/A/objects.json".into(), preferred.to_vec());
        assert_eq!(load(&mut cache).objects().signs[0].text, "new");
        files.0.borrow_mut().remove("maps/A/objects.json");
        assert_eq!(load(&mut cache).objects().signs[0].text, "old");
        files
            .0
            .borrow_mut()
            .insert("maps/A/tileset.png".into(), vec![0]);
        assert!(cache.load(&files, "maps", "A").is_err());
        files
            .0
            .borrow_mut()
            .insert("maps/A/tileset.png".into(), tileset_png());
        let restored = load(&mut cache);
        cache.invalidate("A");
        assert!(!Arc::ptr_eq(&restored.data, &load(&mut cache).data));
    }
}
