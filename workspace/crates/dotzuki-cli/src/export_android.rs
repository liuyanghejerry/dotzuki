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

const TEMPLATES: &[TemplateFile] = &[
    template!("settings.gradle.kts"),
    template!("build.gradle.kts"),
    template!("gradle.properties"),
    template!("app/build.gradle.kts"),
    template!("app/src/main/AndroidManifest.xml"),
    template!("app/src/main/res/values/strings.xml"),
    template!("app/src/main/res/values/themes.xml"),
    template!("app/src/main/cpp/CMakeLists.txt"),
    template!("app/src/main/cpp/native_bridge.cpp"),
    template!("app/src/main/java/com/dotzuki/player/NativeBridge.kt"),
    template!("app/src/main/java/com/dotzuki/player/DotzukiAudio.kt"),
    template!("app/src/main/java/com/dotzuki/player/GameSurfaceView.kt"),
    template!("app/src/main/java/com/dotzuki/player/GamepadView.kt"),
    template!("app/src/main/java/com/dotzuki/player/MainActivity.kt"),
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
        let destination = out.join(template.path);
        fs::create_dir_all(destination.parent().unwrap())?;
        let body = template
            .body
            .replace("__APP_NAME__", &xml_text(title))
            .replace("__APPLICATION_ID__", application_id);
        fs::write(&destination, body)
            .with_context(|| format!("failed to write {}", destination.display()))?;
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
        let _ = fs::remove_dir_all(&root);
    }
}
