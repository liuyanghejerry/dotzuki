//! Optional scene artifacts in version-1 DZPK containers. Bump the artifact
//! version when the serialized AST, compiler output or interpreter contract changes.
use std::{
    borrow::Cow,
    cell::OnceCell,
    collections::BTreeMap,
    io::{BufReader, Read, Write},
    ops::Range,
    rc::Rc,
};

use anyhow::{bail, Context, Result};
use dotzuki_engine_dsl::{ast::StoryStmt, compiler::CompileReport};
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use serde::{Deserialize, Serialize};

use crate::{manifest::Manifest, project::compile_project_dsl, scene::NativeScene, ProjectFiles};

pub(crate) const VERSION: u32 = 1;
const INDEX: &str = ".dotzuki/compiled-scenes/index";
const BODIES: &str = ".dotzuki/compiled-scenes/functions";

type Programs<F> = BTreeMap<String, NativeScene<F>>;
type RuntimeDsl = (CompileReport, Programs<FunctionBody>);

#[derive(Serialize, Deserialize)]
struct SceneIndex {
    report: CompileReport,
    programs: BTreeMap<String, PackedScene>,
}

#[derive(Serialize, Deserialize)]
struct PackedScene {
    compressed: Range<usize>,
    decoded_size: usize,
    scene: NativeScene<Range<usize>>,
}

// Named functions in one scene share a compression dictionary. Inflation leaves
// each function as bytes until its own first call.
pub(crate) struct SceneBytes {
    compressed: Range<usize>,
    size: usize,
    data: OnceCell<Result<Vec<u8>, String>>,
}

impl SceneBytes {
    fn read(&self, files: &dyn ProjectFiles) -> Result<&[u8], &str> {
        self.data
            .get_or_init(|| {
                let inflate = || -> Result<Vec<u8>> {
                    let file = files.read_bytes(BODIES)?;
                    let compressed = file
                        .get(self.compressed.clone())
                        .context("scene outside pack")?;
                    let mut bytes = Vec::new();
                    ZlibDecoder::new(compressed)
                        .take((self.size as u64).saturating_add(1))
                        .read_to_end(&mut bytes)?;
                    anyhow::ensure!(bytes.len() == self.size, "incorrect decoded scene length");
                    Ok(bytes)
                };
                inflate().map_err(|err| format!("invalid {BODIES}: {err:#}"))
            })
            .as_deref()
            .map_err(String::as_str)
    }
}

pub(crate) enum FunctionBody {
    Source(Vec<StoryStmt>),
    Packed {
        scene: Rc<SceneBytes>,
        range: Range<usize>,
        decoded: OnceCell<Result<Vec<StoryStmt>, String>>,
    },
}

impl FunctionBody {
    pub(crate) fn statements(&self, files: &dyn ProjectFiles) -> Result<&[StoryStmt], &str> {
        match self {
            Self::Source(body) => Ok(body),
            Self::Packed {
                scene,
                range,
                decoded,
            } => {
                let bytes = scene.read(files)?;
                decoded
                    .get_or_init(|| {
                        let body = bytes.get(range.clone()).ok_or("function outside scene")?;
                        rmp_serde::from_slice(body)
                            .map_err(|err| format!("invalid function: {err}"))
                    })
                    .as_deref()
                    .map_err(String::as_str)
            }
        }
    }
}

// Read the exact collected bytes, including the exporter's exclusion rules.
struct Collected<'a>(&'a BTreeMap<String, Vec<u8>>);

impl ProjectFiles for Collected<'_> {
    fn read(&self, path: &str) -> Result<Vec<u8>> {
        self.read_bytes(path).map(Cow::into_owned)
    }
    fn read_bytes(&self, path: &str) -> Result<Cow<'_, [u8]>> {
        self.0
            .get(path)
            .map(|v| Cow::Borrowed(v.as_slice()))
            .with_context(|| format!("missing {path}"))
    }
    fn list(&self, prefix: &str) -> Vec<String> {
        self.0
            .keys()
            .filter(|k| {
                prefix.is_empty()
                    || k.as_str() == prefix
                    || k.strip_prefix(prefix).is_some_and(|s| s.starts_with('/'))
            })
            .cloned()
            .collect()
    }
}

pub(crate) fn artifacts(
    files: &BTreeMap<String, Vec<u8>>,
    manifest: &Manifest,
) -> Result<Option<[(&'static str, Vec<u8>); 2]>> {
    if files.contains_key(INDEX) || files.contains_key(BODIES) {
        bail!("project contains a reserved compiled scene path");
    }
    let (report, source) = compile_project_dsl(&Collected(files), manifest);
    // An export forced past DSL diagnostics keeps the normal source-loader error.
    if !report.diagnostics.is_empty() || report.files.is_empty() {
        return Ok(None);
    }
    let mut bodies = Vec::new();
    let mut programs = BTreeMap::new();
    for (scene, program) in source {
        let mut raw = Vec::new();
        let program = program.map_functions(|stmts| {
            let start = raw.len();
            rmp_serde::encode::write(&mut raw, &stmts)?;
            Ok::<_, rmp_serde::encode::Error>(start..raw.len())
        })?;
        let start = bodies.len();
        let mut encoder = ZlibEncoder::new(&mut bodies, Compression::fast());
        encoder.write_all(&raw)?;
        encoder.finish()?;
        programs.insert(
            scene,
            PackedScene {
                compressed: start..bodies.len(),
                decoded_size: raw.len(),
                scene: program,
            },
        );
    }
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    // Named fields preserve RouteEntry's optional, omitted fields.
    rmp_serde::encode::write_named(&mut encoder, &SceneIndex { report, programs })?;
    let index = encoder.finish()?;
    Ok(Some([(INDEX, index), (BODIES, bodies)]))
}

pub(crate) fn from_source(files: &dyn ProjectFiles, manifest: &Manifest) -> RuntimeDsl {
    let (report, programs) = compile_project_dsl(files, manifest);
    (
        report,
        programs
            .into_iter()
            .map(|(name, scene)| (name, scene.map(FunctionBody::Source)))
            .collect(),
    )
}

pub(crate) fn load(files: &dyn ProjectFiles, manifest: &Manifest) -> Result<RuntimeDsl> {
    if files.compiled_scene_version() != Some(VERSION) {
        return Ok(from_source(files, manifest));
    }
    let bytes = files.read_bytes(INDEX)?;
    let index: SceneIndex = rmp_serde::from_read(BufReader::new(ZlibDecoder::new(bytes.as_ref())))
        .with_context(|| format!("invalid {INDEX}"))?;
    let programs = index
        .programs
        .into_iter()
        .map(|(name, packed)| {
            let bytes = Rc::new(SceneBytes {
                compressed: packed.compressed,
                size: packed.decoded_size,
                data: OnceCell::new(),
            });
            let scene = packed.scene.map(|range| FunctionBody::Packed {
                scene: Rc::clone(&bytes),
                range,
                decoded: OnceCell::new(),
            });
            (name, scene)
        })
        .collect();
    Ok((index.report, programs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        pack::{encode_pack, encode_project_pack, PackFiles},
        project::MANIFEST_FILE,
        scene::SceneVm,
        LoadedProject,
    };
    use dotzuki_engine_script::{CommandResult, ScriptCommand};
    use std::{cell::Cell, rc::Rc, sync::Arc};

    fn corpus(count: usize, stories: usize) -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::from([(
            MANIFEST_FILE.into(),
            br#"{"name":"test","dataRoot":"data"}"#.to_vec(),
        )]);
        for n in 0..count {
            let mut source = format!("game_scene Test{n} {{\n");
            for f in 0..stories {
                source.push_str(&format!("    @storyline(\"talk{f}\") {{\n        @speaker(\"Guide\") {{ \"Visit {n}, story {f}.\" }}\n    }}\n"));
            }
            source.push('}');
            files.insert(format!("assets/scenes/test{n}.scene"), source.into_bytes());
        }
        files
    }

    struct CountReads {
        pack: PackFiles,
        version: Option<u32>,
        sources: Cell<usize>,
        bodies: Cell<usize>,
    }

    impl ProjectFiles for CountReads {
        fn compiled_scene_version(&self) -> Option<u32> {
            self.version
        }
        fn read(&self, path: &str) -> Result<Vec<u8>> {
            self.read_bytes(path).map(Cow::into_owned)
        }
        fn read_bytes(&self, path: &str) -> Result<Cow<'_, [u8]>> {
            if path.ends_with(".scene") {
                self.sources.set(self.sources.get() + 1);
            }
            if path == BODIES {
                self.bodies.set(self.bodies.get() + 1);
            }
            self.pack.read_bytes(path)
        }
        fn list(&self, prefix: &str) -> Vec<String> {
            self.pack.list(prefix)
        }
    }

    fn run(project: &LoadedProject, scene: &str, name: &str) -> String {
        let (mut vm, first) =
            SceneVm::start(project, scene, name, &Rc::default(), "en", (0, 0)).unwrap();
        let Some(ScriptCommand::ShowText { text }) = first else {
            panic!("expected dialogue")
        };
        assert_eq!(vm.signal_done(CommandResult::Void).unwrap(), None);
        text
    }

    #[test]
    fn packed_routes_and_function_lookup_leave_bodies_lazy() {
        let mut files = corpus(2, 2);
        let path = "assets/scenes/test0.scene";
        let with_routes = String::from_utf8(files[path].clone())
            .unwrap()
            .replace(
                "@storyline(\"talk0\") {",
                "@storyline(\"talk0\") {\n        @trigger(map = \"Town\", npc = \"Guide\")",
            )
            .replace(
                "@storyline(\"talk1\") {",
                "@storyline(\"talk1\") {\n        @trigger(map = \"Town\", on_enter = true)",
            );
        files.insert(path.into(), with_routes.into_bytes());
        files.insert(
            "assets/scenes/raw.scene".into(),
            br#"game_scene Raw {
    @storylines {
        @run { game.setFlag("raw"); }
        @speaker("Guide") { "JavaScript" }
    }
}"#
            .to_vec(),
        );
        let bytes = encode_project_pack(&files, serde_json::Value::Null).unwrap();
        assert_eq!(
            bytes,
            encode_project_pack(&files, serde_json::Value::Null).unwrap()
        );
        let pack = PackFiles::from_bytes(bytes.clone()).unwrap();
        assert_eq!(pack.compiled_scene_version(), Some(VERSION));
        let backend = Arc::new(CountReads {
            pack,
            version: Some(VERSION),
            sources: Cell::new(0),
            bodies: Cell::new(0),
        });
        let project = LoadedProject::load_with_files(backend.clone()).unwrap();
        assert!(project.native_scenes["Test0"].function("talk1").is_some());
        assert_eq!((backend.sources.get(), backend.bodies.get()), (0, 0));
        assert!(run(&project, "Raw", "main").contains("JavaScript"));
        assert_eq!(backend.bodies.get(), 0);
        for _ in 0..2 {
            assert!(run(&project, "Test0", "talk1").contains("Visit 0, story 1."));
            assert_eq!(backend.bodies.get(), 1);
        }
        assert!(run(&project, "Test0", "talk0").contains("Visit 0, story 0."));
        assert_eq!(
            backend.bodies.get(),
            1,
            "one inflated chunk per active scene"
        );
        assert_eq!(project.routes().len(), 2);
        assert!(project
            .routes()
            .iter()
            .any(|r| r.npc.as_deref() == Some("Guide")));
        assert!(project.routes().iter().any(|r| r.on_enter));
        assert!(run(&project, "Test1", "talk0").contains("Visit 1, story 0."));
        assert_eq!((backend.sources.get(), backend.bodies.get()), (0, 2));

        let older = LoadedProject::load_with_files(Arc::new(
            PackFiles::from_bytes(encode_pack(&files, serde_json::Value::Null)).unwrap(),
        ))
        .unwrap();
        assert_eq!(project.report().scenes, older.report().scenes);
        assert_eq!(project.report().files, older.report().files);
        assert_eq!(
            project.scripts().get_script("Raw"),
            older.scripts().get_script("Raw")
        );
        let newer = Arc::new(CountReads {
            pack: PackFiles::from_bytes(bytes).unwrap(),
            version: Some(VERSION + 1),
            sources: Cell::new(0),
            bodies: Cell::new(0),
        });
        let fallback = LoadedProject::load_with_files(newer.clone()).unwrap();
        assert!(run(&fallback, "Test1", "talk1").contains("Visit 1, story 1."));
        assert_eq!((newer.sources.get(), newer.bodies.get()), (3, 0));
    }

    #[test]
    fn invalid_body_range_reports_the_requested_scene_and_function() {
        let files = corpus(1, 2);
        let (report, mut programs) = compile_project_dsl(
            &Collected(&files),
            &serde_json::from_slice(&files[MANIFEST_FILE]).unwrap(),
        );
        let program = programs.remove("Test0").unwrap().map(|_| 0..1);
        let scene = PackedScene {
            compressed: 1..2,
            decoded_size: 1,
            scene: program,
        };
        let mut buffer = ZlibEncoder::new(Vec::new(), Compression::fast());
        rmp_serde::encode::write_named(
            &mut buffer,
            &SceneIndex {
                report,
                programs: BTreeMap::from([("Test0".into(), scene)]),
            },
        )
        .unwrap();
        let mut damaged = files;
        damaged.insert(INDEX.into(), buffer.finish().unwrap());
        damaged.insert(BODIES.into(), Vec::new());
        let backend = CountReads {
            pack: PackFiles::from_bytes(encode_pack(&damaged, serde_json::Value::Null)).unwrap(),
            version: Some(VERSION),
            sources: Cell::new(0),
            bodies: Cell::new(0),
        };
        let project = LoadedProject::load_with_files(Arc::new(backend)).unwrap();
        let err = SceneVm::start(&project, "Test0", "talk1", &Rc::default(), "en", (0, 0))
            .err()
            .unwrap();
        assert!(
            err.contains("Test0::talk1") && err.contains("outside pack"),
            "{err}"
        );
    }

    #[test]
    fn invalid_dsl_preserves_source_diagnostics_in_forced_exports() {
        let mut files = corpus(0, 0);
        files.insert("assets/scenes/bad.scene".into(), b"invalid scene".to_vec());
        let pack =
            PackFiles::from_bytes(encode_project_pack(&files, serde_json::Value::Null).unwrap())
                .unwrap();
        assert_eq!(pack.compiled_scene_version(), None);
        let err = LoadedProject::load_with_files(Arc::new(pack))
            .err()
            .unwrap();
        assert!(err.to_string().contains("bad.scene"));
    }

    #[test]
    #[ignore = "reports project boot through first dialogue and pack size"]
    fn measure_exported_scene_startup() {
        use std::time::Instant;
        let files = corpus(128, 12);
        let sources = encode_pack(&files, serde_json::Value::Null);
        let compiled = encode_project_pack(&files, serde_json::Value::Null).unwrap();
        for (name, bytes) in [("source", sources), ("compiled", compiled)] {
            let mut timings = Vec::new();
            for _ in 0..13 {
                let input = bytes.clone();
                let t = Instant::now();
                let pack = PackFiles::from_bytes(input).unwrap();
                let project = LoadedProject::load_with_files(Arc::new(pack)).unwrap();
                assert!(run(&project, "Test0", "talk0").contains("Visit 0"));
                timings.push(t.elapsed());
            }
            timings.sort();
            eprintln!(
                "{name}: {} bytes; median project load + first dialogue {:?}",
                bytes.len(),
                timings[timings.len() / 2]
            );
        }
    }
}
