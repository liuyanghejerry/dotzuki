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

const TEMPLATES: &[TemplateFile] = &[
    template!("AppScope/app.json5"),
    template!("AppScope/resources/base/element/string.json"),
    template!("AppScope/resources/base/media/app_icon.svg"),
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
    template!("entry/src/main/resources/base/media/app_icon.svg"),
    template!("entry/src/main/cpp/CMakeLists.txt"),
    template!("entry/src/main/cpp/dotzuki_host.cpp"),
    template!("entry/src/main/cpp/dotzuki_host.h"),
    template!("entry/src/main/cpp/napi_init.cpp"),
    template!("entry/src/main/cpp/types/libentry/index.d.ts"),
    template!("entry/src/main/cpp/types/libentry/oh-package.json5"),
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
         --mobile-lib <path> or set DOTZUKI_MOBILE_LIB"
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
        let destination = out.join(template.path);
        fs::create_dir_all(destination.parent().unwrap())?;
        let body = template
            .body
            .replace("__APP_NAME__", &json_string_contents(title))
            .replace("__BUNDLE_NAME__", bundle_name);
        fs::write(&destination, body)
            .with_context(|| format!("failed to write {}", destination.display()))?;
    }
    let rawfile = out.join("entry/src/main/resources/rawfile/game.dzpk");
    fs::create_dir_all(rawfile.parent().unwrap())?;
    fs::write(&rawfile, pack).context("failed to write HarmonyOS game.dzpk")?;

    let include = out.join("entry/src/main/cpp/include/dotzuki_runner_mobile.h");
    fs::create_dir_all(include.parent().unwrap())?;
    fs::write(
        &include,
        include_bytes!("../../dotzuki-mobile/include/dotzuki_runner_mobile.h"),
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
        let _ = fs::remove_dir_all(&root);
    }
}
