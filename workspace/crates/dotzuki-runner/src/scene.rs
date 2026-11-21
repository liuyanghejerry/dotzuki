//! Scene activation shared by the native and JavaScript backends.
use crate::LoadedProject;
use dotzuki_engine_dsl::ast::{Expression, GameScene, StoryStmt, VariableDecl};
use dotzuki_engine_dsl::core_host::{
    dispatch_core_async, is_core_function, CORE_ASYNC_FUNCTIONS, CORE_STATEFUL_FUNCTIONS,
};
use dotzuki_engine_dsl::interpreter::{HostCall, Interpreter, ScriptHost, Value};
use dotzuki_engine_script::{engine::ScriptEngine, CommandResult, ScriptCommand};
use std::collections::HashMap;

pub(crate) struct NativeScene {
    functions: HashMap<String, Vec<StoryStmt>>,
    variables: Vec<VariableDecl>,
}

impl NativeScene {
    pub(crate) fn from_ast(scene: GameScene) -> Option<Self> {
        let variables = scene.variables.map(|v| v.decls).unwrap_or_default();
        if !variables.iter().all(|d| native_expression(&d.value, true)) {
            return None;
        }
        let mut functions = HashMap::new();
        for story in scene.storylines {
            if !native_block(&story.statements) {
                return None;
            }
            functions.insert(format!("storyline_{}", story.name), story.statements);
        }
        if let Some(on_load) = scene.on_load {
            if !native_block(&on_load.statements) {
                return None;
            }
            functions.insert(format!("{}OnLoad", scene.name), on_load.statements);
        }
        Some(Self {
            functions,
            variables,
        })
    }

    pub(crate) fn function(&self, name: &str) -> Option<&[StoryStmt]> {
        self.functions
            .get(name)
            .or_else(|| self.functions.get(&format!("storyline_{name}")))
            .map(Vec::as_slice)
    }
}

fn native_call(name: &str, args: &[Expression]) -> bool {
    if CORE_ASYNC_FUNCTIONS.contains(&name) {
        // Boa coerces inputs (e.g. delay("2")); the generic AST host validates
        // them strictly. Only switch when both accept the structured arguments.
        let Some(values) = args.iter().map(literal_value).collect::<Option<Vec<_>>>() else {
            return false;
        };
        return dispatch_core_async(name, &values).is_ok();
    }
    name != "getPlayerPosition"
        && (is_core_function(name)
            || matches!(
                name,
                "startBattle" | "startWildBattle" | "setWeather" | "clearWeather"
            ))
}

fn literal_value(expr: &Expression) -> Option<Value> {
    Some(match expr {
        Expression::StringLit(s) => Value::Text(s.clone()),
        Expression::Localized(pairs) => Value::Text(pairs.first()?.1.clone()),
        Expression::NumberLit(n) => Value::Number(*n),
        Expression::BoolLit(b) => Value::Bool(*b),
        Expression::ArrayLit(xs) => {
            Value::Array(xs.iter().map(literal_value).collect::<Option<_>>()?)
        }
        _ => return None,
    })
}

fn native_expression(expr: &Expression, synchronous: bool) -> bool {
    use Expression::*;
    match expr {
        Call { callee, args } => {
            native_call(callee, args)
                && (!synchronous
                    || (callee != "showRandomText"
                        && CORE_STATEFUL_FUNCTIONS.contains(&callee.as_str())))
                && args.iter().all(|e| native_expression(e, true))
        }
        ObjectLit(_) => false,
        ArrayLit(values) => values.iter().all(|e| native_expression(e, true)),
        UnaryOp { operand, .. } => native_expression(operand, true),
        BinaryOp { left, right, .. } => {
            native_expression(left, true) && native_expression(right, true)
        }
        TernaryOp {
            condition,
            then_expr,
            else_expr,
        } => [condition, then_expr, else_expr]
            .iter()
            .all(|e| native_expression(e, true)),
        StringLit(_) | Localized(_) | NumberLit(_) | BoolLit(_) | Variable(_) => true,
    }
}

fn native_block(body: &[StoryStmt]) -> bool {
    body.iter().all(|stmt| match stmt {
        StoryStmt::Run { .. } => false,
        StoryStmt::Speaker { name, .. } | StoryStmt::Say { name, .. } => {
            native_expression(name, true)
        }
        StoryStmt::Assign { value, .. } => native_expression(value, false),
        StoryStmt::Command { name, args, .. } => {
            native_call(name, args) && args.iter().all(|e| native_expression(e, true))
        }
        StoryStmt::If {
            condition,
            then_branch,
            else_branch,
            ..
        } => {
            native_expression(condition, true)
                && native_block(then_branch)
                && native_block(else_branch)
        }
        StoryStmt::Each { source, body, .. } => {
            native_expression(source, true) && native_block(body)
        }
        StoryStmt::Choice { options, .. } => options.iter().all(|o| native_block(&o.body)),
        StoryStmt::Return { .. } => true,
    })
}

pub(crate) struct RunnerHost {
    flags: HashMap<String, bool>,
    lang: String,
    position: (u8, u8),
    rng: dotzuki_engine_script::ScriptRng,
}

impl ScriptHost for RunnerHost {
    fn lang(&self) -> &str {
        // Compiled @t literals go through game.t(en, zh).
        if self.lang == "zh" {
            "zh"
        } else {
            "en"
        }
    }
    fn call(&mut self, name: &str, args: &[Value]) -> Result<HostCall, String> {
        if let Some(command) = dispatch_core_async(name, args)? {
            return Ok(HostCall::Command(command));
        }
        let first = || args.first().map(Value::to_text).unwrap_or_default();
        let value = match name {
            "showRandomText" => {
                let options = match args {
                    [Value::Array(values)] => values.as_slice(),
                    _ => args,
                };
                let text = self
                    .rng
                    .choose_index(options.len())
                    .map(|i| options[i].to_text())
                    .unwrap_or_default();
                return Ok(HostCall::Command(ScriptCommand::ShowText { text }));
            }
            "lang" => Value::Text(self.lang.clone()),
            "t" => args
                .get(usize::from(self.lang == "zh"))
                .map(|v| Value::Text(v.to_text()))
                .unwrap_or_else(|| Value::Text("undefined".into())),
            "getPlayerX" => Value::Number(f64::from(self.position.0)),
            "getPlayerY" => Value::Number(f64::from(self.position.1)),
            "getFlag" | "setFlag" | "resetFlag" => {
                let flag = args.first().unwrap_or(&Value::Undefined).to_text();
                if name == "getFlag" {
                    Value::Bool(self.flags.get(&flag).copied().unwrap_or(false))
                } else {
                    self.flags.insert(flag, name == "setFlag");
                    Value::Undefined
                }
            }
            _ => {
                let cmd = match name {
                    "startBattle" => ScriptCommand::StartBattle {
                        trainer_id: first(),
                    },
                    "startWildBattle" => ScriptCommand::StartWildBattle {
                        species: first(),
                        level: args.get(1).map_or(1, |v| v.to_number() as u8),
                    },
                    "setWeather" => ScriptCommand::SetWeather {
                        weather: Some(first()),
                    },
                    "clearWeather" => ScriptCommand::SetWeather { weather: None },
                    _ => return Err(format!("unknown runner call {name}")),
                };
                return Ok(HostCall::Command(cmd));
            }
        };
        Ok(HostCall::Value(value))
    }
}

pub(crate) enum SceneVm {
    Native(Interpreter<RunnerHost>),
    Boa(Box<ScriptEngine>),
}

impl SceneVm {
    pub(crate) fn start(
        project: &LoadedProject,
        scene: &str,
        function: &str,
        flags: &HashMap<String, bool>,
        lang: &str,
        position: (u8, u8),
    ) -> Result<(Self, Option<ScriptCommand>), String> {
        if let Some(native) = project.native_scenes.get(scene) {
            let body = native
                .function(function)
                .ok_or_else(|| format!("missing function {function}"))?;
            let host = RunnerHost {
                flags: flags.clone(),
                lang: lang.to_owned(),
                position,
                rng: Default::default(),
            };
            let mut vm = Interpreter::new(host);
            vm.load_scene_function(body, &native.variables)?;
            let cmd = vm.tick()?;
            Ok((Self::Native(vm), cmd))
        } else {
            let js = project
                .scripts()
                .get_script(scene)
                .ok_or_else(|| format!("missing scene {scene}"))?;
            let mut vm = boa_engine();
            vm.seed_flags(flags);
            vm.set_lang(lang);
            vm.set_player_position(position.0, position.1);
            vm.load_script(js).map_err(|e| e.to_string())?;
            if !vm.has_function(function) {
                return Err(format!("missing function {function}"));
            }
            let cmd = vm
                .call_function_no_args(function)
                .map_err(|e| e.to_string())?;
            Ok((Self::Boa(Box::new(vm)), cmd))
        }
    }

    pub(crate) fn signal_done(
        &mut self,
        result: CommandResult,
    ) -> Result<Option<ScriptCommand>, String> {
        match self {
            Self::Native(vm) => vm.signal_done(result),
            Self::Boa(vm) => vm.signal_done(result).map_err(|e| e.to_string()),
        }
    }

    pub(crate) fn set_flag(&mut self, flag: &str, value: bool) {
        match self {
            Self::Native(vm) => {
                vm.host_mut().flags.insert(flag.to_owned(), value);
            }
            Self::Boa(vm) => vm.set_flag(flag, value),
        }
    }

    pub(crate) fn into_flags(self) -> HashMap<String, bool> {
        match self {
            Self::Native(mut vm) => std::mem::take(&mut vm.host_mut().flags),
            Self::Boa(vm) => vm.get_all_flags(),
        }
    }
}

fn boa_engine() -> ScriptEngine {
    let mut engine = ScriptEngine::new();
    engine.register_async_fn("startBattle", |args, ctx| {
        let trainer_id = match args.first() {
            Some(v) => v.to_string(ctx)?.to_std_string_lossy(),
            None => String::new(),
        };
        Ok(ScriptCommand::StartBattle { trainer_id })
    });
    engine.register_async_fn("startWildBattle", |args, ctx| {
        let species = match args.first() {
            Some(v) => v.to_string(ctx)?.to_std_string_lossy(),
            None => String::new(),
        };
        let level = match args.get(1) {
            Some(v) => v.to_number(ctx)? as u8,
            None => 1,
        };
        Ok(ScriptCommand::StartWildBattle { species, level })
    });
    // Weather is runner-local too (the wuxia pattern): `setWeather(id)`
    // arms a `kind: Weather` rules.ron record for the NEXT battle,
    // `clearWeather()` cancels a previously armed one.
    engine.register_async_fn("setWeather", |args, ctx| {
        let weather = match args.first() {
            Some(v) => v.to_string(ctx)?.to_std_string_lossy(),
            None => String::new(),
        };
        Ok(ScriptCommand::SetWeather {
            weather: Some(weather),
        })
    });
    engine.register_async_fn("clearWeather", |_args, _ctx| {
        Ok(ScriptCommand::SetWeather { weather: None })
    });
    engine
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MemoryFiles;
    use std::sync::Arc;

    fn project(source: &str) -> LoadedProject {
        let files = MemoryFiles::new(HashMap::from([
            (
                ".dotzuki-editor.json".into(),
                br#"{"name":"Scene test","dataRoot":"data","activities":[]}"#.to_vec(),
            ),
            (
                "assets/scenes/test.scene".into(),
                source.as_bytes().to_vec(),
            ),
        ]));
        LoadedProject::load_with_files(Arc::new(files)).unwrap()
    }

    const STORY: &str = r#"game_scene Test {
    @variables { guide = "Ada" }
    @storylines {
        @speaker(guide) { @t("Ready?", "准备好了吗？") }
        @choice {
            @option(@t("Fight","战斗")) {
                @if (getFlag("joined") && getPlayerX() == 7) {
                    result = startBattle("boss")
                }
            }
            @option("Exit") { return }
        }
        @if (result == "win") {
            @command("setFlag","won")
            @command("setWeather","rain")
            @command("startWildBattle","fish",3)
            @command("clearWeather")
            @speaker("") { @t("Victory","胜利") }
        }
    }
}"#;

    #[test]
    fn native_and_boa_resume_the_same_dialogue_choice_and_battle() {
        let raw = STORY.replace(
            "return",
            r#"@if (true) { @run { game.setFlag("raw"); } } return"#,
        );
        let flags = HashMap::from([("joined".into(), true)]);
        for (source, is_native) in [(STORY, true), (raw.as_str(), false)] {
            let project = project(source);
            let (mut vm, command) =
                SceneVm::start(&project, "Test", "main", &flags, "zh", (7, 8)).unwrap();
            assert_eq!(matches!(vm, SceneVm::Native(_)), is_native);
            assert_eq!(
                command,
                Some(ScriptCommand::ShowText {
                    text: "Ada: 准备好了吗？".into()
                })
            );
            assert_eq!(
                vm.signal_done(CommandResult::Void).unwrap(),
                Some(ScriptCommand::ShowChoice {
                    options: vec!["战斗".into(), "Exit".into()]
                })
            );
            assert_eq!(
                vm.signal_done(CommandResult::Number(0.0)).unwrap(),
                Some(ScriptCommand::StartBattle {
                    trainer_id: "boss".into()
                })
            );
            assert_eq!(
                vm.signal_done(CommandResult::Text("win".into())).unwrap(),
                Some(ScriptCommand::SetWeather {
                    weather: Some("rain".into())
                })
            );
            assert_eq!(
                vm.signal_done(CommandResult::Void).unwrap(),
                Some(ScriptCommand::StartWildBattle {
                    species: "fish".into(),
                    level: 3
                })
            );
            assert_eq!(
                vm.signal_done(CommandResult::Text("run".into())).unwrap(),
                Some(ScriptCommand::SetWeather { weather: None })
            );
            assert_eq!(
                vm.signal_done(CommandResult::Void).unwrap(),
                Some(ScriptCommand::ShowText {
                    text: "胜利".into()
                })
            );
            assert_eq!(vm.signal_done(CommandResult::Void).unwrap(), None);
            assert_eq!(
                vm.into_flags(),
                HashMap::from([("joined".into(), true), ("won".into(), true)])
            );
            // Execute the other nested choice in the JavaScript scene as well.
            if !is_native {
                let (mut vm, _) =
                    SceneVm::start(&project, "Test", "storyline_main", &flags, "en", (0, 0))
                        .unwrap();
                vm.signal_done(CommandResult::Void).unwrap();
                assert_eq!(vm.signal_done(CommandResult::Number(1.0)).unwrap(), None);
                assert_eq!(vm.into_flags().get("raw"), Some(&true));
            }
        }
    }

    #[test]
    fn scene_load_export_takes_precedence_over_a_storyline_with_the_same_name() {
        let story = r#"game_scene Test {
    @load { @speaker("") { "Loading." } }
    @storyline("TestOnLoad") { @speaker("") { "Talking." } }
}"#;
        for (name, expected) in [
            ("TestOnLoad", "Loading."),
            ("storyline_TestOnLoad", "Talking."),
        ] {
            let project = project(story);
            let (vm, cmd) =
                SceneVm::start(&project, "Test", name, &HashMap::new(), "en", (0, 0)).unwrap();
            assert!(matches!(vm, SceneVm::Native(_)));
            assert_eq!(
                cmd,
                Some(ScriptCommand::ShowText {
                    text: expected.into()
                })
            );
        }
    }

    #[test]
    fn random_text_draws_the_same_stream_for_arrays_and_variadic_arguments() {
        let story = r#"game_scene Test {
    @storylines {
        @command("showRandomText")
        @command("showRandomText",["x","y","z"])
        @command("showRandomText","x","y","z")
        @command("showRandomText",[["nested",3]])
    }
}"#;
        let boa = story.replace("@storylines {", "@storylines { @run { }");
        let run = |source: &str, is_native: bool| {
            let project = project(source);
            let (mut vm, first) =
                SceneVm::start(&project, "Test", "main", &HashMap::new(), "en", (0, 0)).unwrap();
            assert_eq!(matches!(vm, SceneVm::Native(_)), is_native);
            let mut commands = vec![first.unwrap()];
            while let Some(cmd) = vm.signal_done(CommandResult::Void).unwrap() {
                commands.push(cmd);
            }
            commands
        };
        let commands = run(story, true);
        assert_eq!(commands.len(), 4);
        assert_eq!(
            commands[3],
            ScriptCommand::ShowText {
                text: "nested,3".into()
            }
        );
        assert_eq!(commands, run(&boa, false));
    }

    #[test]
    fn inputs_that_require_javascript_coercion_keep_their_behavior() {
        let project = project(r#"game_scene Test { @storylines { @command("delay","2") } }"#);
        let (vm, cmd) =
            SceneVm::start(&project, "Test", "main", &HashMap::new(), "en", (0, 0)).unwrap();
        assert!(matches!(vm, SceneVm::Boa(_)));
        assert_eq!(cmd, Some(ScriptCommand::Delay { frames: 2 }));
    }

    #[test]
    #[ignore = "reports activation timing on the local machine"]
    fn measure_short_scene_activations() {
        let source = r#"game_scene Test { @storylines { @speaker("Guide") { "Welcome." } } }"#;
        let raw = source.replace("@speaker", "@run { } @speaker");
        for (label, project) in [("native", project(source)), ("Boa", project(&raw))] {
            let flags = HashMap::new();
            let activate = || {
                let (vm, command) =
                    SceneVm::start(&project, "Test", "main", &flags, "en", (0, 0)).unwrap();
                assert!(matches!(command, Some(ScriptCommand::ShowText { .. })));
                std::hint::black_box(vm);
            };
            activate();
            let start = std::time::Instant::now();
            for _ in 0..200 {
                activate();
            }
            eprintln!("{label}, 200 activations: {:?}", start.elapsed());
        }
    }
}
