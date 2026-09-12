//! Canonical native-AST adapter for dotzuki's generic asynchronous `game.*`
//! protocol.
//!
//! Games own synchronous state queries and game-specific extensions through
//! [`crate::interpreter::ScriptHost`]. They should call
//! [`dispatch_core_async`] first, then handle only their own verbs.

use crate::interpreter::Value;
use dotzuki_engine_script::ScriptCommand;

/// Every asynchronous `game.*` verb owned by the generic dotzuki protocol.
///
/// This catalog is also suitable for build-time capability validation by DSL
/// consumers. Stateful synchronous verbs (`getFlag`, `setFlag`, `lang`, ...)
/// intentionally are not listed: those are supplied by each host.
pub const CORE_ASYNC_FUNCTIONS: &[&str] = &[
    "showText",
    "showChoice",
    "moveNpc",
    "startNpcMove",
    "awaitNpcMove",
    "movePlayer",
    "movePlayerRelative",
    "moveNpcTo",
    "startNpcMoveTo",
    "movePlayerTo",
    "faceNpc",
    "facePlayer",
    "setNpcFrame",
    "playMusic",
    "playSound",
    "stopMusic",
    "fadeOutMusic",
    "delay",
    "warpTo",
    "heal",
    "fadeScreen",
    "showObject",
    "hideObject",
    "showObjectByName",
    "hideObjectByName",
    "setJoyIgnore",
    "clearJoyIgnore",
    "followNpc",
    "openShop",
    "showEmotionBubble",
    "setNpcPosition",
    "showScene",
    "hideScene",
    "updateUI",
];

/// Parse a generic asynchronous `game.*` call into the engine protocol.
///
/// `Ok(None)` means that `name` is not a generic dotzuki verb and should be
/// offered to the game-specific host. A recognized verb with invalid arguments
/// returns a descriptive error instead of falling through to an extension with
/// the same spelling.
pub fn dispatch_core_async(name: &str, args: &[Value]) -> Result<Option<ScriptCommand>, String> {
    let command = match name {
        "showText" => ScriptCommand::ShowText {
            text: text(required(args, 0, name, "text")?, name)?,
        },
        "showChoice" => ScriptCommand::ShowChoice {
            options: string_array(required(args, 0, name, "options")?, name)?,
        },
        "moveNpc" => ScriptCommand::MoveNpc {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            path: path(required(args, 1, name, "path")?, name)?,
        },
        "startNpcMove" => ScriptCommand::StartNpcMove {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            path: path(required(args, 1, name, "path")?, name)?,
        },
        "awaitNpcMove" => ScriptCommand::AwaitNpcMove {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
        },
        "movePlayer" => ScriptCommand::MovePlayer {
            path: path(required(args, 0, name, "path")?, name)?,
        },
        "movePlayerRelative" => ScriptCommand::MovePlayerRelative {
            steps: relative_steps(required(args, 0, name, "steps")?, name)?,
        },
        "moveNpcTo" => ScriptCommand::MoveNpcTo {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            x: u8_arg(required(args, 1, name, "x")?, name)?,
            y: u8_arg(required(args, 2, name, "y")?, name)?,
        },
        "startNpcMoveTo" => ScriptCommand::StartNpcMoveTo {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            x: u8_arg(required(args, 1, name, "x")?, name)?,
            y: u8_arg(required(args, 2, name, "y")?, name)?,
        },
        "movePlayerTo" => ScriptCommand::MovePlayerTo {
            x: u8_arg(required(args, 0, name, "x")?, name)?,
            y: u8_arg(required(args, 1, name, "y")?, name)?,
        },
        "faceNpc" => ScriptCommand::FaceNpc {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            direction: text(required(args, 1, name, "direction")?, name)?,
        },
        "facePlayer" => ScriptCommand::FacePlayer {
            direction: text(required(args, 0, name, "direction")?, name)?,
        },
        "setNpcFrame" => ScriptCommand::SetNpcFrame {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            frame: u8_arg(required(args, 1, name, "frame")?, name)?,
        },
        "playMusic" => ScriptCommand::PlayMusic {
            music_id: text(required(args, 0, name, "music")?, name)?,
        },
        "playSound" => ScriptCommand::PlaySound {
            sound_id: text(required(args, 0, name, "sound")?, name)?,
        },
        "stopMusic" => ScriptCommand::StopMusic,
        "fadeOutMusic" => ScriptCommand::FadeOutMusic,
        "delay" => ScriptCommand::Delay {
            frames: u16_arg(required(args, 0, name, "frames")?, name)?,
        },
        "warpTo" => ScriptCommand::WarpTo {
            map: text(required(args, 0, name, "map")?, name)?,
            x: u8_arg(required(args, 1, name, "x")?, name)?,
            y: u8_arg(required(args, 2, name, "y")?, name)?,
        },
        "heal" => ScriptCommand::Heal,
        "fadeScreen" => ScriptCommand::FadeScreen {
            fade_type: text(required(args, 0, name, "type")?, name)?,
        },
        "showObject" => object_toggle(required(args, 0, name, "object")?, true)?,
        "hideObject" => object_toggle(required(args, 0, name, "object")?, false)?,
        "showObjectByName" => ScriptCommand::ShowObjectByName {
            toggle_id: text(required(args, 0, name, "id")?, name)?,
        },
        "hideObjectByName" => ScriptCommand::HideObjectByName {
            toggle_id: text(required(args, 0, name, "id")?, name)?,
        },
        "setJoyIgnore" => ScriptCommand::SetJoyIgnore {
            mask: u8_arg(required(args, 0, name, "mask")?, name)?,
        },
        "clearJoyIgnore" => ScriptCommand::ClearJoyIgnore,
        "followNpc" => ScriptCommand::FollowNpc {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            target_x: u8_arg(required(args, 1, name, "x")?, name)?,
            target_y: u8_arg(required(args, 2, name, "y")?, name)?,
        },
        "openShop" => ScriptCommand::OpenShop {
            items: string_array(required(args, 0, name, "items")?, name)?,
        },
        "showEmotionBubble" => ScriptCommand::ShowEmotionBubble {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            emotion: text(required(args, 1, name, "emotion")?, name)?,
        },
        "setNpcPosition" => ScriptCommand::SetNpcPosition {
            npc_id: text(required(args, 0, name, "npc")?, name)?,
            x: u8_arg(required(args, 1, name, "x")?, name)?,
            y: u8_arg(required(args, 2, name, "y")?, name)?,
        },
        "showScene" => ScriptCommand::ShowScene {
            scene_name: text(required(args, 0, name, "name")?, name)?,
            layout_json: None,
        },
        "hideScene" => ScriptCommand::HideScene {
            scene_name: text(required(args, 0, name, "name")?, name)?,
        },
        "updateUI" => ScriptCommand::UpdateUI {
            scene_name: text(required(args, 0, name, "name")?, name)?,
            data_json: json(required(args, 1, name, "data")?),
        },
        _ => return Ok(None),
    };
    Ok(Some(command))
}

fn required<'a>(
    args: &'a [Value],
    index: usize,
    name: &str,
    field: &str,
) -> Result<&'a Value, String> {
    args.get(index)
        .ok_or_else(|| format!("{name}: missing {field}"))
}

fn text(value: &Value, what: &str) -> Result<String, String> {
    match value {
        Value::Text(value) => Ok(value.clone()),
        Value::Number(value) => Ok(format!("{value}")),
        Value::Bool(value) => Ok(if *value { "true" } else { "false" }.to_string()),
        other => Err(format!(
            "{what}: expected string, got {}",
            other.type_name()
        )),
    }
}

fn number(value: &Value, what: &str) -> Result<f64, String> {
    match value {
        Value::Number(value) => Ok(*value),
        other => Err(format!(
            "{what}: expected number, got {}",
            other.type_name()
        )),
    }
}

fn u8_arg(value: &Value, what: &str) -> Result<u8, String> {
    number(value, what).map(|value| value as u8)
}

fn u16_arg(value: &Value, what: &str) -> Result<u16, String> {
    number(value, what).map(|value| value as u16)
}

fn string_array(value: &Value, what: &str) -> Result<Vec<String>, String> {
    match value {
        Value::Array(values) => values
            .iter()
            .map(|value| text(value, &format!("{what} element")))
            .collect(),
        other => Err(format!("{what}: expected array, got {}", other.type_name())),
    }
}

fn path(value: &Value, what: &str) -> Result<Vec<(u8, u8)>, String> {
    match value {
        Value::Array(points) => points
            .iter()
            .enumerate()
            .map(|(index, point)| match point {
                Value::Array(pair) if pair.len() == 2 => Ok((
                    u8_arg(&pair[0], &format!("{what}[{index}].x"))?,
                    u8_arg(&pair[1], &format!("{what}[{index}].y"))?,
                )),
                other => Err(format!(
                    "{what}[{index}]: expected [x, y] pair, got {}",
                    other.type_name()
                )),
            })
            .collect(),
        other => Err(format!("{what}: expected array, got {}", other.type_name())),
    }
}

fn relative_steps(value: &Value, what: &str) -> Result<Vec<(i16, i16)>, String> {
    match value {
        Value::Array(steps) => steps
            .iter()
            .enumerate()
            .map(|(index, step)| match step {
                Value::Text(direction) => match direction.to_ascii_lowercase().as_str() {
                    "up" | "north" => Ok((0, -1)),
                    "down" | "south" => Ok((0, 1)),
                    "left" | "west" => Ok((-1, 0)),
                    "right" | "east" => Ok((1, 0)),
                    other => Err(format!("{what}[{index}]: unknown direction '{other}'")),
                },
                Value::Array(pair) if pair.len() == 2 => Ok((
                    number(&pair[0], &format!("{what}[{index}].dx"))? as i16,
                    number(&pair[1], &format!("{what}[{index}].dy"))? as i16,
                )),
                other => Err(format!(
                    "{what}[{index}]: expected direction string or [dx, dy], got {}",
                    other.type_name()
                )),
            })
            .collect(),
        other => Err(format!("{what}: expected array, got {}", other.type_name())),
    }
}

fn object_toggle(value: &Value, show: bool) -> Result<ScriptCommand, String> {
    match value {
        Value::Text(toggle_id) if show => Ok(ScriptCommand::ShowObjectByName {
            toggle_id: toggle_id.clone(),
        }),
        Value::Text(toggle_id) => Ok(ScriptCommand::HideObjectByName {
            toggle_id: toggle_id.clone(),
        }),
        Value::Number(_) if show => Ok(ScriptCommand::ShowObject {
            object_index: u8_arg(value, "showObject")?,
        }),
        Value::Number(_) => Ok(ScriptCommand::HideObject {
            object_index: u8_arg(value, "hideObject")?,
        }),
        other => Err(format!(
            "{}: expected number or string, got {}",
            if show { "showObject" } else { "hideObject" },
            other.type_name()
        )),
    }
}

fn json(value: &Value) -> String {
    match value {
        Value::Undefined => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Text(value) => serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
        Value::Array(values) => {
            let mut output = "[".to_string();
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                output.push_str(&json(value));
            }
            output.push(']');
            output
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_value(value: &str) -> Value {
        Value::Text(value.to_string())
    }

    #[test]
    fn dispatches_core_commands_and_leaves_extensions_to_the_game() {
        assert_eq!(
            dispatch_core_async("movePlayerTo", &[Value::Number(3.0), Value::Number(4.0)]),
            Ok(Some(ScriptCommand::MovePlayerTo { x: 3, y: 4 }))
        );
        assert_eq!(dispatch_core_async("startBattle", &[]), Ok(None));
    }

    #[test]
    fn recognized_command_errors_do_not_fall_through() {
        let error = dispatch_core_async("warpTo", &[text_value("PALLET_TOWN")]).unwrap_err();
        assert_eq!(error, "warpTo: missing x");
    }

    #[test]
    fn parses_paths_relative_steps_and_object_names() {
        let path = Value::Array(vec![Value::Array(vec![
            Value::Number(1.0),
            Value::Number(2.0),
        ])]);
        assert_eq!(
            dispatch_core_async("movePlayer", &[path]),
            Ok(Some(ScriptCommand::MovePlayer { path: vec![(1, 2)] }))
        );
        let steps = Value::Array(vec![
            text_value("north"),
            Value::Array(vec![Value::Number(2.0), Value::Number(0.0)]),
        ]);
        assert_eq!(
            dispatch_core_async("movePlayerRelative", &[steps]),
            Ok(Some(ScriptCommand::MovePlayerRelative {
                steps: vec![(0, -1), (2, 0)]
            }))
        );
        assert_eq!(
            dispatch_core_async("showObject", &[text_value("door")]),
            Ok(Some(ScriptCommand::ShowObjectByName {
                toggle_id: "door".to_string()
            }))
        );
    }

    #[test]
    fn catalog_and_dispatch_stay_in_sync() {
        for name in CORE_ASYNC_FUNCTIONS {
            assert_ne!(
                dispatch_core_async(name, &[]),
                Ok(None),
                "missing dispatcher arm for {name}"
            );
        }
    }
}
