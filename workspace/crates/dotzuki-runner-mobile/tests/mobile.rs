use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use dotzuki_runner::pack::encode_pack;
use dotzuki_runner_mobile::{
    dotzuki_mobile_copy_frame, dotzuki_mobile_create, dotzuki_mobile_destroy,
    dotzuki_mobile_frame_len, dotzuki_mobile_tick, MobileRunner,
};

fn tileset_png() -> Vec<u8> {
    let mut image = image::RgbaImage::new(64, 16);
    let colors = [
        [0xff, 0x00, 0x00, 0xff],
        [0x00, 0xff, 0x00, 0xff],
        [0x00, 0x00, 0xff, 0xff],
        [0xff, 0xff, 0x00, 0xff],
    ];
    for (tile, color) in colors.into_iter().enumerate() {
        for y in 0..16 {
            for x in 0..16 {
                image.put_pixel(tile as u32 * 16 + x, y, image::Rgba(color));
            }
        }
    }
    let mut output = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut output),
            image::ImageFormat::Png,
        )
        .unwrap();
    output
}

fn collect(dir: &Path, root: &Path, output: &mut BTreeMap<String, Vec<u8>>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            collect(&path, root, output);
        } else {
            let name = path
                .strip_prefix(root)
                .unwrap()
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            output.insert(name, fs::read(path).unwrap());
        }
    }
}

fn fixture_files() -> BTreeMap<String, Vec<u8>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../dotzuki-runner/tests/fixtures/demo");
    let mut files = BTreeMap::new();
    collect(&root, &root, &mut files);
    for map in ["Town", "Cave"] {
        files.insert(format!("data/maps/{map}/tileset.png"), tileset_png());
    }
    files
}

fn fixture_pack() -> Vec<u8> {
    encode_pack(&fixture_files(), serde_json::json!({"test": true}))
}

#[test]
fn boots_ticks_copies_frame_and_round_trips_save() {
    let runner = MobileRunner::from_pack(fixture_pack(), None).expect("boot fixture");
    assert_eq!((runner.width(), runner.height()), (320, 240));

    let mut frame = vec![0; runner.frame_len()];
    for _ in 0..10 {
        runner.tick(0);
        assert_eq!(runner.copy_frame(&mut frame), Ok(320 * 240 * 4));
    }
    assert!(frame.iter().any(|byte| *byte != 0));

    let mut save = None;
    for frame_number in 0..600 {
        runner.tick(if frame_number % 2 == 0 { 1 } else { 0 });
        if let Some(json) = runner.export_save() {
            save = Some(json);
            break;
        }
    }
    let save = save.expect("game reaches a stable state");
    assert!(runner.import_save(&save));
    assert!(!runner.import_save("not save JSON"));
}

#[test]
fn produces_pcm_for_a_playing_track() {
    const TRACK: &str = r#"{
      "id":"theme","kind":"music","tempo":256,
      "channels":[{"hw":"pulse1","commands":[
        {"type":"note_type","speed":12,"param":197},
        {"type":"octave","value":5},
        {"type":"note","pitch":0,"length":4},
        {"type":"rest","length":4},
        {"type":"sound_ret"}
      ]}]
    }"#;
    const SCENE: &str = "game_scene Town {\n\
    @storyline(\"town_enter\") {\n\
        @trigger(map = \"Town\", on_enter = true)\n\
        @command(\"playMusic\", \"theme\")\n\
    }\n\
}\n";
    let mut files = fixture_files();
    files.insert(
        "data/audio/music/theme.json".into(),
        TRACK.as_bytes().to_vec(),
    );
    files.insert(
        "data/maps/Town/script.scene".into(),
        SCENE.as_bytes().to_vec(),
    );
    let pack = encode_pack(&files, serde_json::json!({"test": true}));
    let runner = MobileRunner::from_pack(pack, None).expect("boot audio fixture");

    for _ in 0..10 {
        runner.tick(0);
    }
    let mut pcm = vec![0.0; 20_000];
    let frames = runner.fill_audio(&mut pcm);
    assert!(frames > 0);
    assert!(pcm[..frames as usize * 2]
        .iter()
        .any(|sample| *sample != 0.0));
}

#[test]
fn c_abi_drives_a_real_pack() {
    let pack = fixture_pack();
    let runner = unsafe { dotzuki_mobile_create(pack.as_ptr(), pack.len(), std::ptr::null(), 0) };
    assert!(!runner.is_null());
    let length = unsafe { dotzuki_mobile_frame_len(runner) };
    let mut frame = vec![0; length];
    assert!(unsafe { dotzuki_mobile_tick(runner, 0) });
    assert_eq!(
        unsafe { dotzuki_mobile_copy_frame(runner, frame.as_mut_ptr(), frame.len()) },
        length
    );
    unsafe { dotzuki_mobile_destroy(runner) };
}
