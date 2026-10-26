use super::*;
use std::sync::Mutex;

static TEST_LOCK: Mutex<()> = Mutex::new(());
static WRITES: Mutex<Vec<(u16, u8)>> = Mutex::new(Vec::new());

fn record(address: u16, value: u8) {
    WRITES.lock().unwrap().push((address, value));
}

#[test]
fn slide_onsets_match_independent_register_observations() {
    let _guard = TEST_LOCK.lock().unwrap();
    let cases: &[[u16; 13]] = include!("../tests/fixtures/pitch_slide_onsets.rs");
    for &[note, octave, target, delay, modifier, perfect, low, high, current, target_freq, step, fraction, flags] in
        cases
    {
        for hw in 0..3 {
            for paired in [false, true] {
                let mut seq = Sequencer::new();
                let mut apu = Apu::new();
                apu.write_register(0xff26, 0x80);
                let mut stream = vec![0xd1, 0xb3, 0xe0 | octave as u8];
                if perfect != 0 {
                    stream.push(0xe8);
                }
                stream.extend_from_slice(&[
                    0xeb,
                    modifier as u8,
                    target as u8,
                    (note << 4 | (delay - 1)) as u8,
                    0xff,
                ]);
                let mut music = vec![vec![]; NUM_MUSIC_CHANNELS];
                music[hw] = stream;
                seq.play_music(1, &music, 0x100);
                seq.channels[hw].frequency = 0x777;
                seq.channels[hw].freq_lo_saved = 77;
                if paired {
                    seq.play_sfx(200, &[vec![0x2f, 0xb2, 0x70, 6, 0xff]], hw, 0x100);
                    // Controlled sustained one-shot: its initial write is outside
                    // this music-onset observation, as in the source fixture.
                    seq.channels[hw + NUM_MUSIC_CHANNELS].delay_counter = 8;
                }
                apu.set_register_sink(Some(record));
                WRITES.lock().unwrap().clear();
                seq.update_frame(&mut apu);
                let port = [0xff13, 0xff18, 0xff1d][hw];
                let writes: Vec<_> = WRITES
                    .lock()
                    .unwrap()
                    .iter()
                    .copied()
                    .filter(|&(a, _)| a == port || a == port + 1)
                    .collect();
                assert_eq!(writes, if paired { vec![] } else { vec![(port, low as u8), (port + 1, high as u8)] },
                    "note{note}, octave{octave}, delay{delay}, perfect{perfect}, voice{hw}, paired{paired}");
                let ch = &seq.channels[hw];
                assert_eq!(ch.freq_lo_saved, if paired { 77 } else { low as u8 });
                assert_eq!(ch.pitch_slide.current_freq, current);
                assert_eq!(ch.pitch_slide.target_freq, target_freq);
                assert_eq!(ch.pitch_slide.freq_step, step);
                assert_eq!(ch.pitch_slide.step_frac, fraction as u8);
                assert_eq!(ch.pitch_slide.freq_frac, fraction as u8);
                assert_eq!(ch.pitch_slide.length_modifier, (delay - modifier) as u8);
                assert_eq!(ch.flags1.bits() & 0x31, flags as u8);
                if !paired {
                    let length_enabled = match hw {
                        0 => apu.ch1.length.enabled,
                        1 => apu.ch2.length.enabled,
                        _ => apu.ch3.length.enabled,
                    };
                    assert_eq!(length_enabled, high & 0x40 != 0);
                }
            }
        }
    }
}
