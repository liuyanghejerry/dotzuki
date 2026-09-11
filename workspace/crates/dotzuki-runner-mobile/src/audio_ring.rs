//! Lock-free, single-producer/single-consumer PCM queue for mobile hosts.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU64, Ordering};

/// About 1.5 seconds of stereo `f32` PCM at 44.1 kHz.
const CAPACITY: usize = 1 << 17;

pub(crate) struct AudioRing {
    data: UnsafeCell<Box<[f32]>>,
    write: AtomicU64,
    read: AtomicU64,
}

// One game thread calls `push`, and one platform audio callback calls `pop`.
// The producer never overwrites unread slots. Release/acquire publication of
// the monotonically increasing heads protects every shared slot.
unsafe impl Sync for AudioRing {}

impl AudioRing {
    pub(crate) fn new() -> Self {
        Self {
            data: UnsafeCell::new(vec![0.0; CAPACITY].into_boxed_slice()),
            write: AtomicU64::new(0),
            read: AtomicU64::new(0),
        }
    }

    /// Queue as many complete stereo frames as fit. Returns samples written.
    pub(crate) fn push(&self, samples: &[f32]) -> usize {
        let write = self.write.load(Ordering::Relaxed);
        let read = self.read.load(Ordering::Acquire);
        let used = write.wrapping_sub(read).min(CAPACITY as u64) as usize;
        let available = CAPACITY - used;
        let count = samples.len().min(available) & !1;
        if count == 0 {
            return 0;
        }

        let start = write as usize & (CAPACITY - 1);
        let first = count.min(CAPACITY - start);
        // SAFETY: the SPSC contract gives this thread exclusive ownership of
        // the unpublished slots in `[write, write + count)`.
        unsafe {
            let data = &mut *self.data.get();
            data[start..start + first].copy_from_slice(&samples[..first]);
            data[..count - first].copy_from_slice(&samples[first..count]);
        }
        self.write
            .store(write.wrapping_add(count as u64), Ordering::Release);
        count
    }

    /// Pop complete stereo frames into `output`. Returns samples copied.
    pub(crate) fn pop(&self, output: &mut [f32]) -> usize {
        let read = self.read.load(Ordering::Relaxed);
        let write = self.write.load(Ordering::Acquire);
        let available = write.wrapping_sub(read).min(CAPACITY as u64) as usize;
        let count = output.len().min(available) & !1;
        if count == 0 {
            return 0;
        }

        let start = read as usize & (CAPACITY - 1);
        let first = count.min(CAPACITY - start);
        // SAFETY: the acquire load publishes the producer's writes, and the
        // producer does not reuse these slots until the release store below.
        unsafe {
            let data = &*self.data.get();
            output[..first].copy_from_slice(&data[start..start + first]);
            output[first..count].copy_from_slice(&data[..count - first]);
        }
        self.read
            .store(read.wrapping_add(count as u64), Ordering::Release);
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_stereo_samples_and_drains() {
        let ring = AudioRing::new();
        assert_eq!(ring.push(&[0.1, 0.2, 0.3, 0.4]), 4);
        let mut output = [0.0; 6];
        assert_eq!(ring.pop(&mut output), 4);
        assert_eq!(&output[..4], &[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(ring.pop(&mut output), 0);
    }

    #[test]
    fn ignores_incomplete_stereo_frame() {
        let ring = AudioRing::new();
        assert_eq!(ring.push(&[0.1, 0.2, 0.3]), 2);
        let mut output = [0.0; 3];
        assert_eq!(ring.pop(&mut output), 2);
    }
}
