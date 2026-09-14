//! Android export: an Android Studio project backed by the common mobile ABI.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::{bundle, export};

pub struct AndroidExportArgs {
    pub dir: PathBuf,
    pub out: Option<PathBuf>,
    pub mobile_lib: Option<PathBuf>,
    pub force: bool,
}

struct TemplateFile {
    path: &'static str,
    body: &'static str,
}

macro_rules! template {
    ($path:literal) => {
        TemplateFile {
            path: $path,
            body: include_str!(concat!("../templates/android/", $path)),
        }
    };
}

/// A template file copied byte for byte, with no `__NAME__` substitution.
struct TemplateAsset {
    path: &'static str,
    body: &'static [u8],
}

macro_rules! asset {
    ($path:literal) => {
        TemplateAsset {
            path: $path,
            body: include_bytes!(concat!("../templates/android/", $path)),
        }
    };
}

const TEMPLATES: &[TemplateFile] = &[
    template!("settings.gradle.kts"),
    template!("build.gradle.kts"),
    template!("gradle.properties"),
    template!("app/build.gradle.kts"),
    template!("app/src/main/AndroidManifest.xml"),
    template!("app/src/main/res/values/strings.xml"),
    template!("app/src/main/res/values/themes.xml"),
    template!("app/src/main/res/values/ic_launcher_background.xml"),
    template!("app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"),
    template!("app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml"),
    template!("app/src/main/cpp/CMakeLists.txt"),
    template!("app/src/main/cpp/native_bridge.cpp"),
    template!("app/src/main/java/com/dotzuki/player/NativeBridge.kt"),
    template!("app/src/main/java/com/dotzuki/player/DotzukiAudio.kt"),
    template!("app/src/main/java/com/dotzuki/player/GameSurfaceView.kt"),
    template!("app/src/main/java/com/dotzuki/player/GamepadView.kt"),
    template!("app/src/main/java/com/dotzuki/player/MainActivity.kt"),
];

/// Launcher bitmaps. `ic_launcher` and `ic_launcher_round` carry the full
/// artwork for surfaces that read the legacy icon, while
/// `ic_launcher_foreground` is the transparent mark that API 26 and later
/// compose over `@color/ic_launcher_background`. Each density keeps the
/// 108dp adaptive canvas and the 48dp legacy canvas.
const ASSETS: &[TemplateAsset] = &[
    asset!("app/src/main/res/mipmap-mdpi/ic_launcher.png"),
    asset!("app/src/main/res/mipmap-hdpi/ic_launcher.png"),
    asset!("app/src/main/res/mipmap-xhdpi/ic_launcher.png"),
    asset!("app/src/main/res/mipmap-xxhdpi/ic_launcher.png"),
    asset!("app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"),
    asset!("app/src/main/res/mipmap-mdpi/ic_launcher_round.png"),
    asset!("app/src/main/res/mipmap-hdpi/ic_launcher_round.png"),
    asset!("app/src/main/res/mipmap-xhdpi/ic_launcher_round.png"),
    asset!("app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png"),
    asset!("app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png"),
    asset!("app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png"),
    asset!("app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png"),
    asset!("app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png"),
    asset!("app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png"),
    asset!("app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png"),
];

pub fn run(args: &AndroidExportArgs) -> Result<PathBuf> {
    let diagnostics = export::gate_diagnostics(&args.dir, args.force)?;
    let files =
        bundle::collect_project_files(&args.dir).context("failed to collect project files")?;
    let mobile_lib = locate_mobile_lib(args.mobile_lib.as_deref())?;
    let out = args
        .out
        .clone()
        .unwrap_or_else(|| args.dir.join("dist").join("android"));
    let canonical_dir = fs::canonicalize(&args.dir).ok();
    let bundle_source = canonical_dir
        .as_deref()
        .unwrap_or(&args.dir)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&diagnostics.manifest.name);
    let slug = app_slug(bundle_source);
    write_project(
        &out,
        &diagnostics.manifest.name,
        &format!("com.dotzuki.{slug}"),
        &bundle::serialize_pack(&files),
        &mobile_lib,
    )?;
    println!(
        "exported Android project ({} packed file(s)) to {}",
        files.len(),
        out.display()
    );
    println!("open the directory in Android Studio and build the app module");
    Ok(out)
}

fn locate_mobile_lib(override_path: Option<&Path>) -> Result<PathBuf> {
    if let Some(path) = override_path {
        return validate_mobile_lib(path);
    }
    if let Some(path) = std::env::var_os("DOTZUKI_ANDROID_MOBILE_LIB") {
        return validate_mobile_lib(Path::new(&path));
    }
    if let Some(path) = std::env::var_os("DOTZUKI_MOBILE_LIB") {
        return validate_mobile_lib(Path::new(&path));
    }
    let candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/aarch64-linux-android/release/libdotzuki_runner_mobile.a");
    if candidate.is_file() {
        return Ok(candidate);
    }
    bail!(
        "Android mobile runtime not found; build it for aarch64-linux-android, then pass \
         --mobile-lib <path> or set DOTZUKI_ANDROID_MOBILE_LIB"
    )
}

fn validate_mobile_lib(path: &Path) -> Result<PathBuf> {
    if !path.is_file() {
        bail!("mobile runtime library does not exist: {}", path.display());
    }
    if path.file_name().and_then(|name| name.to_str()) != Some("libdotzuki_runner_mobile.a") {
        bail!(
            "mobile runtime must be named libdotzuki_runner_mobile.a: {}",
            path.display()
        );
    }
    Ok(path.to_path_buf())
}

fn write_project(
    out: &Path,
    title: &str,
    application_id: &str,
    pack: &[u8],
    mobile_lib: &Path,
) -> Result<()> {
    for template in TEMPLATES {
        let body = template
            .body
            .replace("__APP_NAME__", &xml_text(title))
            .replace("__APPLICATION_ID__", application_id);
        write_file(out, template.path, body.as_bytes())?;
    }
    for asset in ASSETS {
        write_file(out, asset.path, asset.body)?;
    }
    let rawfile = out.join("app/src/main/res/raw/game.dzpk");
    fs::create_dir_all(rawfile.parent().unwrap())?;
    fs::write(&rawfile, pack).context("failed to write Android game.dzpk")?;

    let include = out.join("app/src/main/cpp/include/dotzuki_runner_mobile.h");
    fs::create_dir_all(include.parent().unwrap())?;
    fs::write(
        &include,
        include_bytes!("../templates/mobile/dotzuki_runner_mobile.h"),
    )?;
    let library = out.join("app/src/main/jniLibs/arm64-v8a/libdotzuki_runner_mobile.a");
    fs::create_dir_all(library.parent().unwrap())?;
    fs::copy(mobile_lib, &library).with_context(|| {
        format!(
            "failed to copy mobile runtime from {}",
            mobile_lib.display()
        )
    })?;
    Ok(())
}

fn write_file(out: &Path, relative: &str, body: &[u8]) -> Result<()> {
    let destination = out.join(relative);
    fs::create_dir_all(destination.parent().unwrap())?;
    fs::write(&destination, body)
        .with_context(|| format!("failed to write {}", destination.display()))
}

fn app_slug(value: &str) -> String {
    let slug: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    if slug.is_empty() || slug.starts_with(|c: char| c.is_ascii_digit()) {
        format!("game{slug}")
    } else {
        slug
    }
}

fn xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_slug_is_application_id_safe() {
        assert_eq!(app_slug("Dotzuki Quest!"), "dotzukiquest");
        assert_eq!(app_slug("123"), "game123");
        assert_eq!(app_slug("武侠"), "game");
    }

    #[test]
    fn xml_text_escapes_resource_content() {
        assert_eq!(xml_text("A&B <Game>"), "A&amp;B &lt;Game&gt;");
    }

    #[test]
    fn templates_have_no_unresolved_names() {
        for template in TEMPLATES {
            let rendered = template
                .body
                .replace("__APP_NAME__", "Demo")
                .replace("__APPLICATION_ID__", "com.dotzuki.demo");
            assert!(!rendered.contains("__APP_NAME__"), "{}", template.path);
            assert!(
                !rendered.contains("__APPLICATION_ID__"),
                "{}",
                template.path
            );
        }
    }

    fn template_body(path: &str) -> &'static str {
        TEMPLATES
            .iter()
            .find(|template| template.path == path)
            .unwrap_or_else(|| panic!("{path} is not a registered template"))
            .body
    }

    /// `android:icon` must point at the `mipmap` artwork, and API 26 and later
    /// compose the adaptive icon from the shared background color and the
    /// transparent foreground layer.
    #[test]
    fn templates_declare_adaptive_launcher_icons() {
        let manifest = template_body("app/src/main/AndroidManifest.xml");
        assert!(manifest.contains("android:icon=\"@mipmap/ic_launcher\""));
        assert!(manifest.contains("android:roundIcon=\"@mipmap/ic_launcher_round\""));

        let background = template_body("app/src/main/res/values/ic_launcher_background.xml");
        assert!(background.contains("<color name=\"ic_launcher_background\">"));

        for path in [
            "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
            "app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml",
        ] {
            let icon = template_body(path);
            assert!(
                icon.contains("<background android:drawable=\"@color/ic_launcher_background\""),
                "{path}"
            );
            assert!(
                icon.contains("<foreground android:drawable=\"@mipmap/ic_launcher_foreground\""),
                "{path}"
            );
        }
    }

    #[test]
    fn native_bridge_keeps_runner_alive_during_audio_callbacks() {
        let bridge = template_body("app/src/main/cpp/native_bridge.cpp");
        assert!(bridge.contains("std::shared_mutex runner_lifetime_mutex"));
        assert!(bridge
            .contains("std::shared_lock<std::shared_mutex> lifetime_lock(runner_lifetime_mutex)"));
        assert_eq!(
            bridge
                .matches("std::unique_lock<std::shared_mutex> lifetime_lock")
                .count(),
            2,
            "create and destroy must both exclude audio callbacks"
        );
    }

    fn png_size(body: &[u8]) -> (u32, u32) {
        assert_eq!(&body[..8], b"\x89PNG\r\n\x1a\n", "asset is not a PNG");
        let width = u32::from_be_bytes(body[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(body[20..24].try_into().unwrap());
        (width, height)
    }

    #[test]
    fn launcher_icon_assets_match_their_density() {
        for asset in ASSETS {
            let density = asset
                .path
                .split('/')
                .find(|part| part.starts_with("mipmap-"))
                .expect("asset lives in a density bucket");
            let scale = match density {
                "mipmap-mdpi" => (1, 1),
                "mipmap-hdpi" => (3, 2),
                "mipmap-xhdpi" => (2, 1),
                "mipmap-xxhdpi" => (3, 1),
                "mipmap-xxxhdpi" => (4, 1),
                other => panic!("unknown density bucket {other}"),
            };
            // The adaptive foreground covers 108dp; the legacy pair covers 48dp.
            let base = if asset.path.ends_with("_foreground.png") {
                108
            } else {
                48
            };
            let expected = base * scale.0 / scale.1;
            assert_eq!(png_size(asset.body), (expected, expected), "{}", asset.path);
        }
    }

    #[test]
    fn writes_android_project_pack_header_and_runtime() {
        let root =
            std::env::temp_dir().join(format!("dotzuki-android-export-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let runtime = root.join("libdotzuki_runner_mobile.a");
        fs::write(&runtime, b"archive").unwrap();

        write_project(&root, "Demo", "com.dotzuki.demo", b"pack", &runtime).unwrap();

        assert_eq!(
            fs::read(root.join("app/src/main/res/raw/game.dzpk")).unwrap(),
            b"pack"
        );
        assert!(root
            .join("app/src/main/cpp/include/dotzuki_runner_mobile.h")
            .is_file());
        assert_eq!(
            fs::read(root.join("app/src/main/jniLibs/arm64-v8a/libdotzuki_runner_mobile.a"))
                .unwrap(),
            b"archive"
        );
        for asset in ASSETS {
            assert_eq!(
                fs::read(root.join(asset.path)).unwrap(),
                asset.body,
                "{}",
                asset.path
            );
        }
        let _ = fs::remove_dir_all(&root);
    }
}
