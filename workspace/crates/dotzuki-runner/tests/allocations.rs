//! Run each measurement in this single-test process after warming its caches.
use std::alloc::{GlobalAlloc, Layout, System};
use std::borrow::Cow;
use std::cell::Cell;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;
use std::sync::atomic::{AtomicIsize, AtomicUsize, Ordering::Relaxed};
use std::sync::Arc;

use dotzuki_engine::{
    render::{FrameBuffer, Rgba},
    render_config::RenderConfig,
};
use dotzuki_runner::{
    battle::{BattleSetup, ScriptedRng},
    DiskFiles, LoadedProject, MemoryFiles, ProjectFiles,
};

struct CountAlloc;
static CALLS: AtomicUsize = AtomicUsize::new(0);
static LIVE_BYTES: AtomicIsize = AtomicIsize::new(0);
#[global_allocator]
static ALLOC: CountAlloc = CountAlloc;

// SAFETY: allocation and deallocation are delegated to System with the caller's layout.
unsafe impl GlobalAlloc for CountAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            CALLS.fetch_add(1, Relaxed);
            LIVE_BYTES.fetch_add(layout.size() as isize, Relaxed);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE_BYTES.fetch_sub(layout.size() as isize, Relaxed);
        unsafe {
            System.dealloc(ptr, layout);
        }
    }
}

struct CountFiles {
    files: MemoryFiles,
    json_reads: Cell<usize>,
    listings: Cell<usize>,
}

impl ProjectFiles for CountFiles {
    fn read(&self, path: &str) -> anyhow::Result<Vec<u8>> {
        self.read_bytes(path).map(Cow::into_owned)
    }
    fn read_bytes(&self, path: &str) -> anyhow::Result<Cow<'_, [u8]>> {
        if path.ends_with(".json") {
            self.json_reads.set(self.json_reads.get() + 1);
        }
        self.files.read_bytes(path)
    }
    fn list(&self, prefix: &str) -> Vec<String> {
        self.listings.set(self.listings.get() + 1);
        self.files.list(prefix)
    }
    fn is_immutable(&self) -> bool {
        true
    }
}

#[test]
fn warm_map_draws_allocate_nothing_and_dropped_encounters_retain_nothing() {
    let disk = DiskFiles::new(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/demo"));
    let mut files: HashMap<_, _> = disk
        .list("")
        .into_iter()
        .map(|p| {
            let bytes = disk.read(&p).unwrap();
            (p, bytes)
        })
        .collect();
    files.insert("data/rules.ron".into(),br#"Ruleset(stats:["attack"],effects:[Effect(id:"slash",kind:Move,hooks:[Hook(on:"DamagingHit",do:[Boost(stat:"attack",stages:1,target:Source)])])])"#.to_vec());
    let mut png = Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(64, 16, image::Rgba([10, 20, 30, 128]))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    files.insert("data/maps/Town/tileset.png".into(), png.into_inner());
    let path = "data/maps/Town/map.tmx.json";
    let mut map: serde_json::Value = serde_json::from_slice(&files[path]).unwrap();
    let mut blended = map["layers"][0].clone();
    blended["name"] = "overlay".into();
    blended["opacity"] = 0.5.into();
    let layers = map["layers"].as_array_mut().unwrap();
    layers.push(blended.clone());
    blended["properties"] = serde_json::json!([{"name":"level","type":"int","value":1}]);
    layers.push(blended);
    files.insert(path.into(), serde_json::to_vec(&map).unwrap());
    let files = Arc::new(CountFiles {
        files: MemoryFiles::new(files),
        json_reads: Cell::default(),
        listings: Cell::default(),
    });
    let project = LoadedProject::load_with_files(files.clone()).unwrap();
    let map = project.load_map("Town").unwrap();
    let mut fb = FrameBuffer::new(RenderConfig::new(320, 240), Rgba::BLACK);
    let mut draw = || {
        map.render_below(&mut fb, 0, 0, 320, 240, 0).unwrap();
        map.render_above(&mut fb, 0, 0, 320, 240, 0).unwrap();
        std::hint::black_box(&fb);
    };
    draw();
    let before = CALLS.load(Relaxed);
    for _ in 0..16 {
        draw();
    }
    assert_eq!(CALLS.load(Relaxed), before);
    let encounter = || {
        let setup = BattleSetup::from_project(&project).unwrap();
        let battle = setup
            .start("slime", Box::new(ScriptedRng::new(vec![])))
            .unwrap();
        assert!(battle.hooks().is_some());
        drop(std::hint::black_box(battle));
    };
    encounter();
    let baseline = (files.json_reads.get(), files.listings.get());
    let before = LIVE_BYTES.load(Relaxed);
    for _ in 0..32 {
        encounter();
    }
    assert_eq!(LIVE_BYTES.load(Relaxed), before);
    assert_eq!((files.json_reads.get(), files.listings.get()), baseline);
}
