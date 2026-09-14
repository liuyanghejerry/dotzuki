//! HarmonyOS export: a DevEco Studio project backed by the common mobile ABI.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::{bundle, export};

/// CLI arguments for `dotzuki export --harmony`.
pub struct HarmonyExportArgs {
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
            body: include_str!(concat!("../templates/harmony/", $path)),
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
            body: include_bytes!(concat!("../templates/harmony/", $path)),
        }
    };
}

const TEMPLATES: &[TemplateFile] = &[
    template!("AppScope/app.json5"),
    template!("AppScope/resources/base/element/string.json"),
    template!("AppScope/resources/base/media/layered_image.json"),
    template!("build-profile.json5"),
    template!("hvigor/hvigor-config.json5"),
    template!("hvigorfile.ts"),
    template!("oh-package.json5"),
    template!("entry/build-profile.json5"),
    template!("entry/hvigorfile.ts"),
    template!("entry/oh-package.json5"),
    template!("entry/src/main/module.json5"),
    template!("entry/src/main/ets/entryability/EntryAbility.ets"),
    template!("entry/src/main/ets/pages/Index.ets"),
    template!("entry/src/main/ets/types/DotzukiContext.ets"),
    template!("entry/src/main/resources/base/element/color.json"),
    template!("entry/src/main/resources/base/element/string.json"),
    template!("entry/src/main/resources/base/profile/main_pages.json"),
    template!("entry/src/main/resources/base/media/layered_image.json"),
    template!("entry/src/main/cpp/CMakeLists.txt"),
    template!("entry/src/main/cpp/dotzuki_host.cpp"),
    template!("entry/src/main/cpp/dotzuki_host.h"),
    template!("entry/src/main/cpp/napi_init.cpp"),
    template!("entry/src/main/cpp/types/libentry/index.d.ts"),
    template!("entry/src/main/cpp/types/libentry/oh-package.json5"),
];

/// Launcher and start-window bitmaps. API 11 and later take the launcher icon
/// from a layered image, so each icon directory carries a full-bleed
/// `background.png` plus a `foreground.png` whose mark stays inside the safe
/// area; `app.json5` reads the AppScope copy and `module.json5` the entry copy.
const ASSETS: &[TemplateAsset] = &[
    asset!("AppScope/resources/base/media/background.png"),
    asset!("AppScope/resources/base/media/foreground.png"),
    asset!("entry/src/main/resources/base/media/background.png"),
    asset!("entry/src/main/resources/base/media/foreground.png"),
    asset!("entry/src/main/resources/base/media/startIcon.png"),
];

pub fn run(args: &HarmonyExportArgs) -> Result<PathBuf> {
    let diagnostics = export::gate_diagnostics(&args.dir, args.force)?;
    let files =
        bundle::collect_project_files(&args.dir).context("failed to collect project files")?;
    let mobile_lib = locate_mobile_lib(args.mobile_lib.as_deref())?;
    let out = args
        .out
        .clone()
        .unwrap_or_else(|| args.dir.join("dist").join("harmony"));
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
        "exported HarmonyOS project ({} packed file(s)) to {}",
        files.len(),
        out.display()
    );
    println!("open the directory in DevEco Studio and build the entry module");
    Ok(out)
}

fn locate_mobile_lib(override_path: Option<&Path>) -> Result<PathBuf> {
    if let Some(path) = override_path {
        return validate_mobile_lib(path);
    }
    if let Some(path) = std::env::var_os("DOTZUKI_HARMONY_MOBILE_LIB") {
        return validate_mobile_lib(Path::new(&path));
    }
    if let Some(path) = std::env::var_os("DOTZUKI_MOBILE_LIB") {
        return validate_mobile_lib(Path::new(&path));
    }
    let candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/aarch64-unknown-linux-ohos/release/libdotzuki_runner_mobile.a");
    if candidate.is_file() {
        return Ok(candidate);
    }
    bail!(
        "HarmonyOS mobile runtime not found; build it for aarch64-unknown-linux-ohos, then pass \
         --mobile-lib <path> or set DOTZUKI_HARMONY_MOBILE_LIB"
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
    bundle_name: &str,
    pack: &[u8],
    mobile_lib: &Path,
) -> Result<()> {
    for template in TEMPLATES {
        let body = template
            .body
            .replace("__APP_NAME__", &json_string_contents(title))
            .replace("__BUNDLE_NAME__", bundle_name);
        write_file(out, template.path, body.as_bytes())?;
    }
    for asset in ASSETS {
        write_file(out, asset.path, asset.body)?;
    }
    let rawfile = out.join("entry/src/main/resources/rawfile/game.dzpk");
    fs::create_dir_all(rawfile.parent().unwrap())?;
    fs::write(&rawfile, pack).context("failed to write HarmonyOS game.dzpk")?;

    let include = out.join("entry/src/main/cpp/include/dotzuki_runner_mobile.h");
    fs::create_dir_all(include.parent().unwrap())?;
    fs::write(
        &include,
        include_bytes!("../templates/mobile/dotzuki_runner_mobile.h"),
    )?;
    let library = out.join("entry/libs/arm64-v8a/libdotzuki_runner_mobile.a");
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

fn json_string_contents(value: &str) -> String {
    let quoted = serde_json::to_string(value).expect("serializing a string cannot fail");
    quoted[1..quoted.len() - 1].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_slug_is_bundle_safe() {
        assert_eq!(app_slug("Dotzuki Quest!"), "dotzukiquest");
        assert_eq!(app_slug("123"), "game123");
        assert_eq!(app_slug("武侠"), "game");
    }

    #[test]
    fn json_string_contents_preserves_escaped_edge_quotes() {
        assert_eq!(json_string_contents("\"Demo\""), "\\\"Demo\\\"");
    }

    #[test]
    fn templates_have_no_unresolved_names() {
        for template in TEMPLATES {
            let rendered = template
                .body
                .replace("__APP_NAME__", "Demo")
                .replace("__BUNDLE_NAME__", "com.dotzuki.demo");
            assert!(!rendered.contains("__APP_NAME__"), "{}", template.path);
            assert!(!rendered.contains("__BUNDLE_NAME__"), "{}", template.path);
        }
    }

    fn template_body(path: &str) -> &'static str {
        TEMPLATES
            .iter()
            .find(|template| template.path == path)
            .unwrap_or_else(|| panic!("{path} is not a registered template"))
            .body
    }

    /// API 11 and later draw the launcher icon from a layered image, so a
    /// single-layer `$media:app_icon` leaves the device on the system
    /// placeholder.
    #[test]
    fn templates_declare_layered_launcher_icons() {
        assert!(template_body("AppScope/app.json5").contains("\"icon\": \"$media:layered_image\""));

        let module = template_body("entry/src/main/module.json5");
        assert!(module.contains("\"icon\": \"$media:layered_image\""));
        assert!(module.contains("\"startWindowIcon\": \"$media:startIcon\""));

        for path in [
            "AppScope/resources/base/media/layered_image.json",
            "entry/src/main/resources/base/media/layered_image.json",
        ] {
            let layer = template_body(path);
            assert!(layer.contains("$media:background"), "{path}");
            assert!(layer.contains("$media:foreground"), "{path}");
        }

        for template in TEMPLATES {
            assert!(
                !template.body.contains("$media:app_icon"),
                "{}",
                template.path
            );
        }
    }

    #[test]
    fn native_host_keeps_runner_alive_during_audio_callbacks() {
        let header = template_body("entry/src/main/cpp/dotzuki_host.h");
        let host = template_body("entry/src/main/cpp/dotzuki_host.cpp");
        assert!(header.contains("std::shared_mutex runnerLifetimeMutex_"));
        assert!(host.contains(
            "std::shared_lock<std::shared_mutex> lifetimeLock(host->runnerLifetimeMutex_)"
        ));
        assert_eq!(
            host.matches("std::unique_lock<std::shared_mutex> lifetimeLock")
                .count(),
            2,
            "replace and destruction must both exclude audio callbacks"
        );
    }

    fn png_size(body: &[u8]) -> (u32, u32) {
        assert_eq!(&body[..8], b"\x89PNG\r\n\x1a\n", "asset is not a PNG");
        let width = u32::from_be_bytes(body[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(body[20..24].try_into().unwrap());
        (width, height)
    }

    #[test]
    fn layered_icon_assets_are_square_pngs() {
        for asset in ASSETS {
            let (width, height) = png_size(asset.body);
            let expected = if asset.path.ends_with("startIcon.png") {
                144
            } else {
                1024
            };
            assert_eq!((width, height), (expected, expected), "{}", asset.path);
        }
    }

    #[test]
    fn writes_deveco_project_pack_header_and_runtime() {
        let root =
            std::env::temp_dir().join(format!("dotzuki-harmony-export-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let runtime = root.join("libdotzuki_runner_mobile.a");
        fs::write(&runtime, b"archive").unwrap();

        write_project(&root, "Demo", "com.dotzuki.demo", b"pack", &runtime).unwrap();

        assert_eq!(
            fs::read(root.join("entry/src/main/resources/rawfile/game.dzpk")).unwrap(),
            b"pack"
        );
        assert!(root
            .join("entry/src/main/cpp/include/dotzuki_runner_mobile.h")
            .is_file());
        assert_eq!(
            fs::read(root.join("entry/libs/arm64-v8a/libdotzuki_runner_mobile.a")).unwrap(),
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
        assert!(fs::read_to_string(root.join("AppScope/app.json5"))
            .unwrap()
            .contains("$media:layered_image"));
        let _ = fs::remove_dir_all(&root);
    }
}
