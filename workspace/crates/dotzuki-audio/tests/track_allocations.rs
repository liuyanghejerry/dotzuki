//! Count real allocations on the test thread, excluding harness/other threads.
use dotzuki_audio::manager::{AudioManager, TrackData};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
};

#[derive(Clone, Copy, Default)]
struct Counts {
    enabled: bool,
    calls: usize,
    bytes: usize,
}
thread_local! {
    static COUNTS: Cell<Counts> = const { Cell::new(Counts { enabled: false, calls: 0, bytes: 0 }) };
}
struct CountingAllocator;
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
fn count(size: usize) {
    let _ = COUNTS.try_with(|counts| {
        let mut value = counts.get();
        if value.enabled {
            value.calls += 1;
            value.bytes += size;
            counts.set(value);
        }
    });
}
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        count(size);
        unsafe { System.realloc(ptr, layout, size) }
    }
}
fn measure(f: impl FnOnce()) -> Counts {
    COUNTS.with(|counts| {
        counts.set(Counts {
            enabled: true,
            ..Counts::default()
        })
    });
    f();
    COUNTS.with(|counts| {
        let result = counts.get();
        counts.set(Counts::default());
        result
    })
}
const STREAM: &[u8] = &[0xdc, 0xc7, 0xe5, 0x04, 0xff];
fn track(id: u8) -> TrackData {
    TrackData {
        sound_id: id,
        channels: [Some(STREAM), None, Some(STREAM), None],
        tempo: 0x100,
    }
}

#[test]
fn manager_allocates_only_the_two_owned_streams_and_nothing_for_duplicate_sfx() {
    let mut manager = AudioManager::<u8, u8>::new(track, track);
    let music = measure(|| manager.play_music(1));
    assert_eq!((music.calls, music.bytes), (2, 2 * STREAM.len()));
    let sfx = measure(|| manager.play_sfx(2));
    assert_eq!((sfx.calls, sfx.bytes), (2, 2 * STREAM.len()));
    let duplicate = measure(|| manager.play_sfx(2));
    assert_eq!((duplicate.calls, duplicate.bytes), (0, 0));
    assert_eq!(manager.sequencer.channels[0].data, STREAM);
    assert_eq!(manager.sequencer.channels[2].data, STREAM);
    assert_eq!(manager.sequencer.channels[4].data, STREAM);
    assert!(!manager.sequencer.channels[5].active);
    assert_eq!(manager.sequencer.channels[6].data, STREAM);
    // Channels still own writable buffers; the API did not introduce static
    // borrowing or couple separate live voices to the same mutable data.
    manager.sequencer.channels[4].data[0] = 0xff;
    assert_eq!(manager.sequencer.channels[6].data, STREAM);
}
