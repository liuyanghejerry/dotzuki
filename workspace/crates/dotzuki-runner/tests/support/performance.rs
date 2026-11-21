//! Callgrind collects only the marked workload. Input preparation, fixture
//! generation, boot, warmup and assertions on the final state are outside it.
use super::*;
use dotzuki_runner::{MemoryFiles, RunnerAudio};
use std::{collections::HashMap, hint::black_box};

#[inline(never)]
#[no_mangle]
fn dotzuki_measure_workload(run: &mut dyn FnMut()) {
    black_box(run)();
    black_box(());
}

#[test]
#[ignore = "run with scripts/runner-performance.py"]
fn scenario() {
    let scenario = std::env::var("DOTZUKI_PERF_SCENARIO").unwrap();
    match scenario.as_str() {
        "pcm" => pcm(),
        "scene_flags" => scene_flags(),
        "idle_map" | "scrolling" | "bag" | "battle" => frames(&scenario),
        _ => panic!("unknown performance scenario {scenario}"),
    }
}

fn frames(scenario: &str) {
    let (tmp, mut game) = navigation_game("perf");
    match scenario {
        "scrolling" => set_up_scrolling_map(&tmp, &mut game),
        "bag" => {
            let mut save: serde_json::Value =
                serde_json::from_str(&game.export_save().unwrap()).unwrap();
            save["inventory"] = serde_json::json!({"potion":2, "tent":1});
            assert!(game.import_save(&save.to_string()));
            for button in [GbButton::Start, GbButton::Down, GbButton::A] {
                frame(&mut game, button.bit_mask());
                frame(&mut game, 0);
            }
            assert!(game
                .menu_lines()
                .unwrap()
                .iter()
                .any(|line| line.to_lowercase().contains("potion")));
        }
        "battle" => {
            // The unmodified Cave fixture routes its Boss interaction to startBattle.
            let mut save: serde_json::Value =
                serde_json::from_str(&game.export_save().unwrap()).unwrap();
            save["map"] = "Cave".into();
            assert!(game.import_save(&save.to_string()));
            game.debug_place(1, 2, Direction::Up);
            press_a(&mut game);
            press_a(&mut game);
            assert!(game.battle().unwrap().in_menu());
        }
        _ => {}
    }
    let mut fb = FrameBuffer::new(RenderConfig::new(320, 240), Rgba::BLACK);
    let mut pixels = vec![0; fb.data.len()];
    game.draw_retained(&mut fb);
    let start = game.player_tile();
    let mut changed = 0;
    dotzuki_measure_workload(&mut || {
        for i in 0..60 {
            let mask = match scenario {
                "scrolling" => GbButton::Right.bit_mask(),
                "bag" | "battle" if i % 16 == 0 => GbButton::Down.bit_mask(),
                "bag" | "battle" if i % 16 == 8 => GbButton::Up.bit_mask(),
                _ => 0,
            };
            frame(&mut game, mask);
            let area = game.draw_retained(&mut fb);
            if area.present {
                fb.copy_region(area, &mut pixels);
                black_box(&pixels);
                changed += 1;
            }
        }
    });
    if scenario == "scrolling" {
        assert!(game.player_tile().0 > start.0);
    }
    if scenario == "idle_map" {
        assert_eq!(changed, 0);
    } else {
        assert!(changed > 0, "scenario never presented a changed frame");
    }
}

fn pcm() {
    let files = MemoryFiles::new(HashMap::from([(
        "data/audio/theme.json".into(),
        include_bytes!("../fixtures/theme.json").to_vec(),
    )]));
    let mut audio = RunnerAudio::from_files(&files, "data", false);
    audio.set_pcm_render(true);
    audio.play_music("theme");
    audio.update_frame();
    let mut out = [0.0; 1478];
    audio.render_samples_into(&mut out);
    assert!(out.iter().any(|s| *s != 0.0));
    dotzuki_measure_workload(&mut || {
        for i in 0..60 {
            audio.render_samples_into(&mut out[..2 * (738 + i % 2)]);
            black_box(&out);
        }
    });
}

fn scene_flags() {
    let (tmp, mut game) = boot("perf-flags");
    dismiss_dialogue(&mut game);
    fs::write(
        tmp.path().join("demo/data/maps/Town/script.scene"),
        r#"game_scene Town {
    @storyline("talk") {
        @trigger(map = "Town", npc = "Guide")
        @command("setFlag", "talked")
        @speaker("Guide") { "Hello!" }
    }
}"#,
    )
    .unwrap();
    assert!(game.reload_scenes());
    let mut save: serde_json::Value = serde_json::from_str(&game.export_save().unwrap()).unwrap();
    for i in 0..2048 {
        save["flags"][format!("flag{i}")] = true.into();
    }
    assert!(game.import_save(&save.to_string()));
    game.debug_place(2, 2, Direction::Up);
    dotzuki_measure_workload(&mut || {
        for _ in 0..200 {
            press_a(&mut game);
            assert!(game.dialogue_text().unwrap().contains("Hello!"));
            press_a(&mut game);
        }
    });
    assert!(game.flag("talked") && game.flag("flag2047"));
}
