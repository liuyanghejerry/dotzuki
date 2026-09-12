//! Bounded SPSC PCM queue. Atomic slots avoid aliasing across callback threads.
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
const CAPACITY: usize = 8192;
pub(crate) struct AudioRing {
    data: Box<[AtomicU32]>,
    read: AtomicUsize,
    write: AtomicUsize,
}
impl AudioRing {
    pub fn new() -> Self {
        Self {
            data: (0..CAPACITY).map(|_| AtomicU32::new(0)).collect(),
            read: AtomicUsize::new(0),
            write: AtomicUsize::new(0),
        }
    }
    pub fn push(&self, samples: &[f32]) -> usize {
        let w = self.write.load(Ordering::Relaxed);
        let r = self.read.load(Ordering::Acquire);
        let n = samples.len().min(CAPACITY - w.wrapping_sub(r)) & !1;
        for (i, sample) in samples[..n].iter().enumerate() {
            self.data[w.wrapping_add(i) & (CAPACITY - 1)]
                .store(sample.to_bits(), Ordering::Relaxed);
        }
        self.write.store(w.wrapping_add(n), Ordering::Release);
        n
    }
    pub fn pop(&self, output: &mut [f32]) -> usize {
        let r = self.read.load(Ordering::Relaxed);
        let w = self.write.load(Ordering::Acquire);
        let n = output.len().min(w.wrapping_sub(r)) & !1;
        for (i, sample) in output[..n].iter_mut().enumerate() {
            *sample = f32::from_bits(
                self.data[r.wrapping_add(i) & (CAPACITY - 1)].load(Ordering::Relaxed),
            );
        }
        self.read.store(r.wrapping_add(n), Ordering::Release);
        n
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overflow_preserves_unread_stereo_and_wraps() {
        let q = AudioRing::new();
        let data: Vec<f32> = (0..CAPACITY).map(|v| v as f32).collect();
        assert_eq!(q.push(&data), CAPACITY);
        assert_eq!(q.push(&[99.0, 99.0]), 0);
        let mut out = vec![0.0; CAPACITY];
        assert_eq!(q.pop(&mut out), CAPACITY);
        assert_eq!(out, data);
        assert_eq!(q.push(&[1.0, 2.0, 3.0]), 2);
        assert_eq!(q.pop(&mut out), 2);
        assert_eq!(&out[..2], &[1.0, 2.0]);
    }
    #[test]
    fn concurrent_ordering() {
        let q = std::sync::Arc::new(AudioRing::new());
        let producer = q.clone();
        let thread = std::thread::spawn(move || {
            for i in 0..20000 {
                while producer.push(&[i as f32, -(i as f32)]) == 0 {
                    std::thread::yield_now();
                }
            }
        });
        let mut out = [0.0; 2];
        for i in 0..20000 {
            while q.pop(&mut out) == 0 {
                std::thread::yield_now();
            }
            assert_eq!(out, [i as f32, -(i as f32)]);
        }
        thread.join().unwrap();
    }
}
