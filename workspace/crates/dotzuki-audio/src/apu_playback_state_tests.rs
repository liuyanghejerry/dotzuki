use super::*;
use crate::output::render_apu_stereo;
use std::sync::atomic::{AtomicUsize, Ordering};

fn sounding_apu() -> Apu {
    let mut apu = Apu::new();
    for (address, value) in [
        (0xFF26, 0x80),
        (0xFF24, 0x65),
        (0xFF25, 0xD7),
        (0xFF10, 0x23),
        (0xFF11, 0xC2),
        (0xFF12, 0xB3),
        (0xFF13, 0x35),
        (0xFF14, 0x84),
        (0xFF16, 0x41),
        (0xFF17, 0xA2),
        (0xFF18, 0x88),
        (0xFF19, 0x86),
        (0xFF1A, 0x80),
        (0xFF1B, 0xFD),
        (0xFF1C, 0x20),
        (0xFF1D, 0xC1),
        (0xFF1E, 0x86),
        (0xFF20, 0x02),
        (0xFF21, 0xD2),
        (0xFF22, 0x35),
        (0xFF23, 0x80),
    ] {
        apu.write_register(address, value);
    }
    for i in 0..16 {
        apu.write_register(0xFF30 + i, (i as u8).wrapping_mul(23));
    }
    // No oscillator, envelope, sweep, or frame-sequencer alignment is assumed.
    apu.tick_n(CYCLES_PER_FRAME_SEQ_TICK * 9 + 157);
    apu
}

fn checkpoint(apu: &Apu) -> ApuPlaybackState {
    let state = apu.playback_state();
    #[cfg(feature = "serde")]
    {
        serde_json::from_slice(&serde_json::to_vec(&state).unwrap()).unwrap()
    }
    #[cfg(not(feature = "serde"))]
    {
        state
    }
}

fn assert_pcm_and_state_equal(a: &mut Apu, b: &mut Apu, rate: u32, samples: usize) -> bool {
    let mut expected = vec![0.0; samples * 2];
    let mut restored = vec![0.0; samples * 2];
    render_apu_stereo(a, &mut expected, rate);
    render_apu_stereo(b, &mut restored, rate);
    assert_eq!(
        expected.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
        restored.iter().map(|v| v.to_bits()).collect::<Vec<_>>()
    );
    assert_eq!(a.playback_state(), b.playback_state());
    expected.iter().any(|sample| *sample != 0.0)
}

static SOURCE_WRITES: AtomicUsize = AtomicUsize::new(0);
static DESTINATION_WRITES: AtomicUsize = AtomicUsize::new(0);

fn source_sink(_: u16, _: u8) {
    SOURCE_WRITES.fetch_add(1, Ordering::SeqCst);
}

fn destination_sink(_: u16, _: u8) {
    DESTINATION_WRITES.fetch_add(1, Ordering::SeqCst);
}

#[test]
fn playback_state_install_preserves_destination_sink_without_writes_or_ticks() {
    let mut source = sounding_apu();
    source.set_register_sink(Some(source_sink));
    let mut destination = Apu::new();
    destination.set_register_sink(Some(destination_sink));
    SOURCE_WRITES.store(0, Ordering::SeqCst);
    DESTINATION_WRITES.store(0, Ordering::SeqCst);

    let state = source.playback_state();
    assert_eq!(state.frame_seq_counter, 157);
    assert_eq!(state.frame_seq_step, 1);
    assert_ne!(state.ch4.lfsr, 0x7FFF);
    destination.restore_playback_state(&state);
    assert_eq!(destination.playback_state(), state);
    assert_eq!(source.playback_state(), state);
    assert_eq!(SOURCE_WRITES.load(Ordering::SeqCst), 0);
    assert_eq!(DESTINATION_WRITES.load(Ordering::SeqCst), 0);

    destination.write_register(0xFF24, 0x43);
    assert_eq!(DESTINATION_WRITES.load(Ordering::SeqCst), 1);
    assert_eq!(SOURCE_WRITES.load(Ordering::SeqCst), 0);
    // Restoring into an unbound APU must not adopt the source's sink either.
    let mut unbound = Apu::new();
    unbound.restore_playback_state(&state);
    unbound.write_register(0xFF25, 0x11);
    assert_eq!(SOURCE_WRITES.load(Ordering::SeqCst), 0);
    assert_eq!(DESTINATION_WRITES.load(Ordering::SeqCst), 1);
}

#[cfg(feature = "serde")]
#[test]
fn playback_state_json_roundtrip_retains_all_private_phases_and_requires_complete_state() {
    let mut source = sounding_apu();
    source.set_register_sink(Some(source_sink));
    let state = source.playback_state();
    let bytes = serde_json::to_vec(&state).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(value.get("register_sink").is_none());
    assert_eq!(value["frame_seq_counter"], 157);
    assert_eq!(value["frame_seq_step"], 1);
    for channel in ["ch1", "ch2", "ch3", "ch4"] {
        assert!(value[channel]["freq_timer"].is_number());
    }
    assert!(value["ch1"]["envelope"]["counter"].is_number());
    assert!(value["ch2"]["envelope"]["counter"].is_number());
    assert!(value["ch4"]["envelope"]["counter"].is_number());
    assert!(value["ch1"]["sweep"]["counter"].is_number());
    let decoded: ApuPlaybackState = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(decoded, state);
    let mut destination = Apu::new();
    destination.restore_playback_state(&decoded);
    assert_eq!(destination.playback_state(), state);
    assert_pcm_and_state_equal(&mut source, &mut destination, 48_000, 4096);

    let mut missing_phase = value;
    missing_phase
        .as_object_mut()
        .unwrap()
        .remove("frame_seq_counter");
    assert!(serde_json::from_value::<ApuPlaybackState>(missing_phase).is_err());
}

fn mixed_write(apu: &mut Apu, step: usize) {
    match step {
        1 => apu.write_register(0xFF13, 0xF9), // frequency change without trigger
        3 => apu.write_register(0xFF19, 0x47), // length gate without trigger
        4 => apu.write_register(0xFF17, 0),    // DAC off
        5 => {
            apu.write_register(0xFF17, 0x98);
            apu.write_register(0xFF19, 0x86);
        }
        6 => apu.write_register(0xFF22, 0x0D), // seven-bit noise, no trigger
        7 => apu.write_register(0xFF1A, 0),
        8 => {
            apu.write_register(0xFF1A, 0x80);
            apu.write_register(0xFF1C, 0x60);
            apu.write_register(0xFF1E, 0x86);
        }
        9 => {
            apu.write_register(0xFF11, 0xBF); // length1
            apu.write_register(0xFF14, 0xC4);
            apu.write_register(0xFF20, 0x3F);
            apu.write_register(0xFF23, 0xC0);
        }
        10 => apu.write_register(0xFF25, 0x5A),
        11 => apu.write_register(0xFF24, 0x37),
        13 => {
            apu.write_register(0xFF26, 0);
            apu.write_register(0xFF35, 0xE1); // wave RAM remains writable while off
            apu.write_register(0xFF12, 0xFF); // ignored while off
        }
        14 => {
            apu.write_register(0xFF26, 0x80);
            apu.write_register(0xFF24, 0x77);
            apu.write_register(0xFF25, 0xFF);
            apu.write_register(0xFF12, 0xF2);
            apu.write_register(0xFF14, 0x87);
            apu.write_register(0xFF1A, 0x80);
            apu.write_register(0xFF1C, 0x20);
            apu.write_register(0xFF1E, 0x85);
            apu.write_register(0xFF21, 0xC1);
            apu.write_register(0xFF23, 0x80);
        }
        17 => apu.write_register(0xFF25, 0), // silent output, running oscillators
        18 => apu.write_register(0xFF25, 0xFF),
        20 => apu.write_register(0xFF10, 0x1A),
        _ => {}
    }
    apu.tick_n((step as u32 * 31 + 7) % 199);
}

#[test]
fn playback_state_mixed_writes_and_ticks_replay_bit_exact_stereo_at_both_sample_rates() {
    for rate in [44_100, 48_000] {
        let mut source = sounding_apu();
        let mut destination = Apu::new();
        destination.restore_playback_state(&checkpoint(&source));
        let mut audible = false;
        for step in 0..24 {
            mixed_write(&mut source, step);
            mixed_write(&mut destination, step);
            assert_eq!(source.playback_state(), destination.playback_state());
            audible |=
                assert_pcm_and_state_equal(&mut source, &mut destination, rate, 511 + step * 13);
        }
        assert!(audible, "replay includes non-silent PCM");
    }
}

#[test]
fn playback_state_retains_old_timers_larger_than_new_periods_without_clamping() {
    let mut source = Apu::new();
    for (address, value) in [
        (0xFF26, 0x80),
        (0xFF10, 0x70),
        (0xFF12, 0xB7),
        (0xFF14, 0x80),
        (0xFF17, 0xA7),
        (0xFF19, 0x80),
        (0xFF1A, 0x80),
        (0xFF1E, 0x80),
        (0xFF21, 0xC7),
        (0xFF22, 0xF7),
        (0xFF23, 0x80),
    ] {
        source.write_register(address, value);
    }
    source.tick_n(37);
    for (address, value) in [
        (0xFF10, 0x10),
        (0xFF12, 0xB1),
        (0xFF13, 0xFF),
        (0xFF14, 0x07),
        (0xFF17, 0xA1),
        (0xFF18, 0xFF),
        (0xFF19, 0x07),
        (0xFF1D, 0xFF),
        (0xFF1E, 0x07),
        (0xFF21, 0xC1),
        (0xFF22, 0),
    ] {
        source.write_register(address, value);
    }
    let state = checkpoint(&source);
    #[cfg(feature = "serde")]
    {
        let value = serde_json::to_value(&state).unwrap();
        assert_eq!(value["ch1"]["freq_timer"], 8192 - 37);
        assert_eq!(value["ch2"]["freq_timer"], 8192 - 37);
        assert_eq!(value["ch3"]["freq_timer"], 4096 - 37);
        assert_eq!(value["ch4"]["freq_timer"], (112 << 15) - 37);
        assert_eq!(value["ch1"]["envelope"]["counter"], 7);
        assert_eq!(value["ch1"]["envelope"]["period"], 1);
        assert_eq!(value["ch1"]["sweep"]["counter"], 7);
        assert_eq!(value["ch1"]["sweep"]["period"], 1);
    }
    let mut destination = Apu::new();
    destination.restore_playback_state(&state);
    assert_eq!(destination.playback_state(), state);
    destination.tick_n(127);
    assert_eq!(destination.ch1.waveform_pos, source.ch1.waveform_pos);
    assert_eq!(destination.ch2.waveform_pos, source.ch2.waveform_pos);
    assert_eq!(destination.ch3.sample_pos, source.ch3.sample_pos);
    assert_eq!(destination.ch4.lfsr, source.ch4.lfsr);
    source.tick_n(127);
    assert_eq!(destination.playback_state(), source.playback_state());
    assert_pcm_and_state_equal(&mut source, &mut destination, 44_100, 4096);
}

#[test]
fn playback_state_retains_disabled_oscillators_and_powered_off_wave_ram() {
    let mut source = sounding_apu();
    source.ch1.enabled = false;
    source.ch2.enabled = false;
    source.ch3.enabled = false;
    source.ch4.enabled = false;
    let silent = source.playback_state();
    assert_eq!(source.mix_sample(), (0, 0));
    source.tick_n(713);
    assert_ne!(
        source.playback_state(),
        silent,
        "disabled oscillators still advance"
    );
    let mut destination = Apu::new();
    destination.restore_playback_state(&checkpoint(&source));
    source.write_register(0xFF14, 0x84);
    destination.write_register(0xFF14, 0x84);
    assert_pcm_and_state_equal(&mut source, &mut destination, 48_000, 1024);

    source.write_register(0xFF26, 0);
    source.write_register(0xFF30, 0xBA);
    source.write_register(0xFF3F, 0x17);
    let off = checkpoint(&source);
    destination.restore_playback_state(&off);
    destination.tick_n(98_765);
    assert_eq!(destination.playback_state(), off);
    assert_eq!(destination.ch3.wave_ram, source.ch3.wave_ram);
    assert_eq!(
        (
            destination.read_register(0xFF30),
            destination.read_register(0xFF3F)
        ),
        (0xBA, 0x17)
    );
    for apu in [&mut source, &mut destination] {
        for (address, value) in [
            (0xFF26, 0x80),
            (0xFF24, 0x77),
            (0xFF25, 0x44),
            (0xFF1A, 0x80),
            (0xFF1C, 0x20),
            (0xFF1E, 0x86),
        ] {
            apu.write_register(address, value);
        }
    }
    assert_pcm_and_state_equal(&mut source, &mut destination, 48_000, 1024);
}

#[test]
fn playback_state_captures_hardware_tails_with_no_current_music_and_between_drums() {
    use crate::manager::{AudioManager, TrackData};
    use crate::sequencer::Sequencer;
    fn empty_track(_: u8) -> TrackData {
        TrackData {
            sound_id: 0,
            channels: [None; 4],
            tempo: 0x100,
        }
    }
    let mut manager = AudioManager::new(empty_track, empty_track);
    assert_eq!(manager.last_music_id(), None);
    manager.apu = sounding_apu();
    let mut no_music_restore = Apu::new();
    no_music_restore.restore_playback_state(&checkpoint(&manager.apu));
    assert_pcm_and_state_equal(&mut manager.apu, &mut no_music_restore, 48_000, 1024);

    let mut seq = Sequencer::new();
    seq.register_noise_instruments(vec![vec![0x20, 0xC1, 0x33, 0xFF]]);
    let mut source = Apu::new();
    source.write_register(0xFF26, 0x80);
    seq.play_music(
        1,
        &[
            vec![0xC0],
            vec![0xC0],
            vec![0xC0],
            vec![0xB2, 0x01, 0xB2, 0x01, 0xFF],
        ],
        0x100,
    );
    seq.update_frame(&mut source);
    source.tick_n(697);
    seq.update_frame(&mut source);
    assert!(
        !seq.channels[7].active,
        "instrument has returned before next drum"
    );
    assert!(
        source.ch4.enabled,
        "software noise tail outlives the instrument stream"
    );
    let mut destination = Apu::new();
    destination.restore_playback_state(&checkpoint(&source));
    let mut replay_seq = seq.clone(); // identical future writes are external inputs to the APU API
    for _ in 0..12 {
        seq.update_frame(&mut source);
        replay_seq.update_frame(&mut destination);
        assert_pcm_and_state_equal(&mut source, &mut destination, 44_100, 800);
    }
}
