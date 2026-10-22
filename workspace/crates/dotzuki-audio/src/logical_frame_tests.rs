//! Logical commits share sequencing and consumption, while the external owner
//! supplies any physical register writes. Test-only paired instances compare
//! complete state and do not form part of the runtime implementation.

use crate::apu::Apu;
use crate::sequencer::{LogicalFrameOutcome, Sequencer, CHAN4, CHAN5, CHAN7, CHAN8};
use crate::{ChannelFlags1, ChannelFlags2, NUM_MUSIC_CHANNELS};
use std::cell::RefCell;

std::thread_local! {
    static WRITES: RefCell<Vec<(u16, u8)>> = const { RefCell::new(Vec::new()) };
}

fn record(address: u16, value: u8) {
    WRITES.with(|writes| writes.borrow_mut().push((address, value)));
}

fn take_writes() -> Vec<(u16, u8)> {
    WRITES.with(|writes| core::mem::take(&mut *writes.borrow_mut()))
}

fn powered_apu() -> Apu {
    let mut apu = Apu::new();
    apu.write_register(0xff26, 0x80);
    apu.set_register_sink(Some(record));
    apu
}

fn compare_frame(
    ordinary: &mut Sequencer,
    logical: &mut Sequencer,
    ordinary_apu: &mut Apu,
    owned_apu: &mut Apu,
) -> LogicalFrameOutcome {
    take_writes();
    ordinary.update_frame(ordinary_apu);
    let writes = take_writes();
    // Controlled fixture: model the external owner's already-applied writes.
    // The logical method must neither repeat them nor touch playback phase.
    for &(address, value) in &writes {
        owned_apu.write_register(address, value);
    }
    assert_eq!(owned_apu.playback_state(), ordinary_apu.playback_state());
    take_writes();
    let before = owned_apu.playback_state();
    let outcome = logical.advance_frame_without_output();
    assert_eq!(owned_apu.playback_state(), before);
    assert!(take_writes().is_empty());
    assert_eq!(logical, ordinary, "compare every sequencer/channel field");
    assert_eq!(
        outcome.nr50,
        writes
            .iter()
            .rev()
            .find_map(|&(address, value)| (address == 0xff24).then_some(value))
    );
    outcome
}

fn music_fixture() -> Sequencer {
    let mut sequencer = Sequencer::new();
    sequencer.register_noise_instruments(vec![vec![0x20, 0xc1, 0x33, 0xff]]);
    sequencer.play_music(
        1,
        &[
            vec![0xd1, 0xb3, 0xea, 0, 0x23, 0xec, 2, 0x07, 0xc3, 0x27, 0xff],
            vec![0xd1, 0xa1, 0xeb, 3, 0x45, 0x07, 0xc1, 0x27, 0xff],
            vec![0xd1, 0x23, 0xea, 1, 0x32, 0x03, 0xc2, 0x37, 0xff],
            vec![0xd1, 0xb3, 1, 0xc1, 0xb1, 1, 0xff],
        ],
        0x140,
    );
    sequencer
}

#[test]
fn logical_frames_match_notes_rests_effects_and_noise_complete_state() {
    let mut ordinary = music_fixture();
    let mut logical = ordinary.clone();
    let mut ordinary_apu = powered_apu();
    let mut owned_apu = ordinary_apu.clone();
    let mut saw_rest = false;
    let mut saw_drum = false;
    for _ in 0..64 {
        compare_frame(
            &mut ordinary,
            &mut logical,
            &mut ordinary_apu,
            &mut owned_apu,
        );
        saw_rest |= logical
            .channels
            .iter()
            .any(|channel| channel.active && channel.resting);
        saw_drum |= logical.channels[CHAN8].active;
        for _ in 0..73 {
            ordinary_apu.tick();
            owned_apu.tick();
        }
    }
    assert!(saw_rest && saw_drum);
    assert!(logical.channels.iter().all(|channel| !channel.active));
}

#[test]
fn logical_frames_match_sfx_priority_and_release_on_every_hardware_voice() {
    for hw in 0..NUM_MUSIC_CHANNELS {
        for start_frame in [0, 1, 4, 10] {
            let mut ordinary = music_fixture();
            let mut logical = ordinary.clone();
            let mut ordinary_apu = powered_apu();
            let mut owned_apu = ordinary_apu.clone();
            let mut saw_active = false;
            for frame in 0..64 {
                if frame == start_frame {
                    let stream = if hw == 3 {
                        vec![0x22, 0xa1, 0x34, 0xff]
                    } else {
                        vec![0x22, 0xa1, 0x34, 0x06, 0xff]
                    };
                    ordinary.play_sfx(200, &[stream.clone()], hw, 0x100);
                    logical.play_sfx(200, &[stream], hw, 0x100);
                }
                compare_frame(
                    &mut ordinary,
                    &mut logical,
                    &mut ordinary_apu,
                    &mut owned_apu,
                );
                saw_active |= logical.channels[hw + NUM_MUSIC_CHANNELS].active;
            }
            assert!(saw_active);
            assert!(!logical.channels[hw + NUM_MUSIC_CHANNELS].active);
        }
    }
}

#[test]
fn logical_commit_consumes_only_selected_note_and_rest_requests() {
    for execute_music in [false, true] {
        let mut ordinary = Sequencer::new();
        ordinary.play_sfx(200, &[vec![0xc3, 0xff]], 0, 0x100);
        ordinary.channels[CHAN5]
            .flags2
            .set(ChannelFlags2::EXECUTE_MUSIC, execute_music);
        // Inactive channels retain their state; bulk-clearing triggers would
        // differ from ordinary output even though the channel is not selected.
        ordinary.channels[CHAN7].trigger = true;
        let mut logical = ordinary.clone();
        let mut ordinary_apu = powered_apu();
        let mut owned_apu = ordinary_apu.clone();
        compare_frame(
            &mut ordinary,
            &mut logical,
            &mut ordinary_apu,
            &mut owned_apu,
        );
        assert!(logical.channels[CHAN7].trigger);
        // Raw SFX rests produce no register request. Execute-music rests do.
        assert_eq!(logical.channels[CHAN5].trigger, !execute_music);
    }

    // A drum clock can leave its trigger set without issuing a hardware note.
    let mut ordinary = Sequencer::new();
    ordinary.play_music(1, &[vec![], vec![], vec![], vec![0xc3, 0xff]], 0x100);
    assert!(ordinary.channels[CHAN4]
        .flags1
        .contains(ChannelFlags1::NOISE_OR_SFX));
    let mut logical = ordinary.clone();
    let mut ordinary_apu = powered_apu();
    let mut owned_apu = ordinary_apu.clone();
    compare_frame(
        &mut ordinary,
        &mut logical,
        &mut ordinary_apu,
        &mut owned_apu,
    );
    assert!(logical.channels[CHAN4].trigger);
}

#[test]
fn logical_commit_consumes_last_volume_and_normal_resume_does_not_replay() {
    let mut ordinary = Sequencer::new();
    ordinary.play_music(
        1,
        &[
            vec![0xf0, 0x12, 0xf0, 0x23, 0x07, 0xff],
            vec![0xf0, 0x34, 0x07, 0xff],
        ],
        0x100,
    );
    ordinary.play_sfx(
        200,
        &[vec![0xf0, 0x45, 0x27, 0xa1, 0x34, 6, 0xff]],
        0,
        0x100,
    );
    ordinary.pending_nr50 = Some(0x01);
    let mut logical = ordinary.clone();
    let mut ordinary_apu = powered_apu();
    let mut owned_apu = ordinary_apu.clone();
    let outcome = compare_frame(
        &mut ordinary,
        &mut logical,
        &mut ordinary_apu,
        &mut owned_apu,
    );
    assert_eq!(outcome.nr50, Some(0x45));
    assert_eq!(logical.pending_nr50, None);

    // Both APUs now contain the prior frame's output. Switch the logical
    // owner back to ordinary update, including nonzero oscillator phases.
    for _ in 0..89 {
        ordinary_apu.tick();
        owned_apu.tick();
    }
    take_writes();
    ordinary.update_frame(&mut ordinary_apu);
    let expected = take_writes();
    logical.update_frame(&mut owned_apu);
    assert_eq!(take_writes(), expected);
    assert_eq!(logical, ordinary);
    assert_eq!(owned_apu.playback_state(), ordinary_apu.playback_state());
    assert!(expected.iter().all(|&(address, _)| address != 0xff24));
    assert!(expected.iter().all(|&(address, value)| !matches!(
        address,
        0xff14 | 0xff19 | 0xff1e | 0xff23
    ) || value & 0x80 == 0));
}

#[test]
fn logical_commit_takes_pending_volume_even_with_no_active_channels() {
    let mut sequencer = Sequencer::new();
    sequencer.pending_nr50 = Some(0x67);
    assert_eq!(sequencer.advance_frame_without_output().nr50, Some(0x67));
    assert_eq!(sequencer.advance_frame_without_output().nr50, None);
    assert_eq!(sequencer.pending_nr50, None);
}
