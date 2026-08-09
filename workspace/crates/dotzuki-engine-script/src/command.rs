use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ScriptCommand {
    ShowText {
        text: String,
    },
    ShowChoice {
        options: Vec<String>,
    },
    GiveItem {
        item_id: String,
        quantity: u8,
    },
    GivePokemon {
        species: String,
        level: u8,
    },
    TakeItem {
        item_id: String,
        quantity: u8,
    },
    SetFlag {
        flag: String,
    },
    ResetFlag {
        flag: String,
    },
    CheckFlag {
        flag: String,
    },
    ShowObject {
        object_index: u8,
    },
    HideObject {
        object_index: u8,
    },
    ShowObjectByName {
        toggle_id: String,
    },
    HideObjectByName {
        toggle_id: String,
    },
    MoveNpc {
        npc_id: String,
        path: Vec<(u8, u8)>,
    },
    StartNpcMove {
        npc_id: String,
        path: Vec<(u8, u8)>,
    },
    AwaitNpcMove {
        npc_id: String,
    },
    MovePlayer {
        path: Vec<(u8, u8)>,
    },
    /// Relative player steps: each entry is a (dx, dy) delta applied
    /// cumulatively from the player's current position. Direction
    /// strings ("up"/"down"/"left"/"right") are converted to unit
    /// deltas at parse time.
    MovePlayerRelative {
        steps: Vec<(i16, i16)>,
    },
    MoveNpcTo {
        npc_id: String,
        x: u8,
        y: u8,
    },
    StartNpcMoveTo {
        npc_id: String,
        x: u8,
        y: u8,
    },
    MovePlayerTo {
        x: u8,
        y: u8,
    },
    FaceNpc {
        npc_id: String,
        direction: String,
    },
    FacePlayer {
        direction: String,
    },
    PlayMusic {
        music_id: String,
    },
    PlaySound {
        sound_id: String,
    },
    StopMusic,
    FadeOutMusic,
    StartBattle {
        trainer_id: String,
    },
    /// Start a wild/static battle against a single generated opponent of the
    /// given species and level (catchable, like a random encounter). Resolves
    /// to the battle outcome string ("win" | "lose" | "caught" | "fled" | ...).
    StartWildBattle {
        species: String,
        level: u8,
    },
    /// Arm the battle-local weather for the NEXT battle (`Some(id)` names a
    /// `kind: Weather` rules.ron record; `None` clears a previously armed
    /// one). Runner-local: registered by the jrpg runner's scene engine next
    /// to `startBattle`, consumed before the battle starts, cleared when the
    /// battle ends. Never saved.
    SetWeather {
        weather: Option<String>,
    },
    /// The Viridian Old-Man CATCH TUTORIAL: an auto-played, guaranteed-catch demo
    /// battle (Gen-1 `BATTLE_TYPE_OLD_MAN`). Resolves to the outcome string.
    OldManTutorial,
    /// In-game trade: give up `offered` from the party and receive `received`
    /// (nicknamed). Resolves to `true` if the party held `offered`, else `false`.
    TradePokemon {
        offered: String,
        received: String,
        nickname: String,
    },
    Delay {
        frames: u16,
    },
    WarpTo {
        map: String,
        x: u8,
        y: u8,
    },
    Heal,
    AnimateHealingMachine,
    FadeScreen {
        fade_type: String,
    },
    SetJoyIgnore {
        mask: u8,
    },
    ClearJoyIgnore,
    FollowNpc {
        npc_id: String,
        target_x: u8,
        target_y: u8,
    },
    ShowPokedexEntry {
        species: String,
    },
    OpenNamingScreen {
        species: String,
    },
    /// Open the party menu as a selector, returning the chosen party index
    /// (0-based) or -1 if the player cancelled. Used e.g. by the Name Rater.
    ChoosePartyPokemon,
    /// Write a new nickname onto the party member at `index` (0-based).
    SetPartyNickname {
        index: u8,
        nickname: String,
    },
    OpenShop {
        items: Vec<String>,
    },
    /// Open a slot-machine / gambling minigame (game-specific screen).
    /// `lucky` selects a higher-odds machine variant.
    OpenSlots {
        lucky: bool,
    },
    /// Open an elevator floor-selection menu (game-specific screen).
    /// `floors` are the selectable floor labels in order; the script receives
    /// the chosen floor index (0-based) as the command result, or -1 if the
    /// player cancelled.
    ElevatorMenu {
        floors: Vec<String>,
    },
    /// Open a filtered-bag menu (game-specific screen): of the candidate item
    /// ids, only those the player actually carries are shown; the script
    /// receives the chosen item's const name as the result ("" on cancel).
    FilterBag {
        item_ids: Vec<String>,
    },
    /// Show the full-screen "diploma" certificate (completed-POKeDEX reward).
    ShowDiploma,
    /// Open the PC storage system (game-specific screen). `kind` selects the
    /// entry point: "center" (Pokémon Center PC — full menu with Bill's PC,
    /// the player's item PC and PROF.OAK's PC), "items" (bedroom item PC),
    /// or "bills" (straight into #MON storage). The script continues
    /// immediately; the app closes the screen on its own.
    OpenPc {
        kind: String,
    },
    /// Start the Cable Club link flow (game-specific): the player used the
    /// "gameboy on the table" in the Colosseum / Trade Center
    /// (`CableClubLeftGameboy` / `CableClubRightGameboy`,
    /// engine/pokemon/bills_pc.asm). The game flags a request the app layer
    /// drains; the script continues immediately (the link session drives the
    /// rest). No-op offline — the app shows the original "Just a moment."
    /// and nothing happens, exactly like the original without a peer.
    LinkStart,
    /// Add coins to the player's casino-coin balance (capped by the game).
    GiveCoins {
        amount: u16,
    },
    /// Subtract coins from the player's casino-coin balance (saturating).
    TakeCoins {
        amount: u16,
    },
    /// Deposit the party member at `index` (0-based) into the Day Care.
    /// The game removes it from the party and stores it off-party where it
    /// gains experience while the player walks. No-op if `index` is invalid.
    DepositDaycare {
        index: u8,
    },
    /// Withdraw the Day Care Pokémon back into the party at its grown level
    /// (moves re-derived, HP restored). No-op if nothing is deposited.
    WithdrawDaycare,
    ShowEmotionBubble {
        npc_id: String,
        emotion: String,
    },
    SetNpcPosition {
        npc_id: String,
        x: u8,
        y: u8,
    },
    SetNpcFrame {
        npc_id: String,
        frame: u8,
    },
    ShowScene {
        scene_name: String,
        layout_json: Option<String>,
    },
    HideScene {
        scene_name: String,
    },
    UpdateUI {
        scene_name: String,
        data_json: String,
    },
    GiveMoney {
        amount: u32,
    },
    TakeMoney {
        amount: u32,
    },
    PlayCry {
        species: String,
    },
    GiveBadge {
        badge: u8,
    },
    /// Replace a map block at runtime. `x`, `y` are BLOCK coordinates,
    /// matching the original asm `ReplaceTileBlock`.
    ReplaceTileBlock {
        x: u8,
        y: u8,
        block_id: u8,
    },
    /// Play the S.S. Anne departure cutscene (VermilionDock) — the
    /// blocking ship-sail animation (smoke puffs + view scroll + erase).
    /// The script resumes once the cutscene completes.
    PlayShipDeparture,
    /// Record the party in the Hall of Fame and play the endgame ceremony
    /// (game-specific: the HoF roll-call movie + credits, engine/movie/
    /// hall_of_fame.asm + credits.asm). Instant effect from the script's
    /// perspective — the app runs the ceremony, saves, and resets to the
    /// title screen; the script runs on (and simply ends).
    EnterHallOfFame,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CommandResult {
    Void,
    Bool(bool),
    Number(f64),
    Text(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_show_text_command() {
        let cmd = ScriptCommand::ShowText {
            text: "Hello".to_string(),
        };
        assert_eq!(cmd, ScriptCommand::ShowText { text: "Hello".to_string() });
    }

    #[test]
    fn test_show_choice_command() {
        let cmd = ScriptCommand::ShowChoice {
            options: vec!["Yes".to_string(), "No".to_string()],
        };
        assert_eq!(
            cmd,
            ScriptCommand::ShowChoice {
                options: vec!["Yes".to_string(), "No".to_string()]
            }
        );
    }

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let cmds: Vec<ScriptCommand> = vec![
            ScriptCommand::ShowText { text: "Hello".into() },
            ScriptCommand::ShowChoice { options: vec!["A".into(), "B".into()] },
            ScriptCommand::GiveItem { item_id: "POTION".into(), quantity: 5 },
            ScriptCommand::GivePokemon { species: "PIKACHU".into(), level: 5 },
            ScriptCommand::Heal,
            ScriptCommand::StopMusic,
            ScriptCommand::ClearJoyIgnore,
            ScriptCommand::WarpTo { map: "PALLET_TOWN".into(), x: 5, y: 3 },
            ScriptCommand::Delay { frames: 60 },
            ScriptCommand::PlayMusic { music_id: "PALLET_TOWN".into() },
            ScriptCommand::PlaySound { sound_id: "SFX_BALL".into() },
            ScriptCommand::FadeOutMusic,
            ScriptCommand::FadeScreen { fade_type: "out".into() },
            ScriptCommand::SetJoyIgnore { mask: 0xFF },
            ScriptCommand::MoveNpc { npc_id: "oak".into(), path: vec![(2, 3), (4, 5)] },
            ScriptCommand::FollowNpc { npc_id: "rival".into(), target_x: 10, target_y: 8 },
            ScriptCommand::OpenShop { items: vec!["POTION".into()] },
            ScriptCommand::GiveMoney { amount: 500 },
            ScriptCommand::TakeMoney { amount: 100 },
            ScriptCommand::GiveBadge { badge: 0 },
            ScriptCommand::ReplaceTileBlock { x: 3, y: 5, block_id: 7 },
            ScriptCommand::PlayShipDeparture,
            ScriptCommand::ShowObject { object_index: 1 },
            ScriptCommand::HideObjectByName { toggle_id: "HIDDEN_ITEM".into() },
            ScriptCommand::SetWeather { weather: Some("sandstorm".into()) },
            ScriptCommand::SetWeather { weather: None },
        ];

        for cmd in &cmds {
            let json = serde_json::to_string(cmd).unwrap();
            let deserialized: ScriptCommand = serde_json::from_str(&json).unwrap();
            assert_eq!(*cmd, deserialized, "round-trip failed for {cmd:?}");
        }
    }

    #[test]
    fn test_command_result_equality() {
        assert_eq!(CommandResult::Void, CommandResult::Void);
        assert_eq!(CommandResult::Bool(true), CommandResult::Bool(true));
        assert_eq!(CommandResult::Bool(false), CommandResult::Bool(false));
        assert_ne!(CommandResult::Bool(true), CommandResult::Bool(false));
        assert_eq!(CommandResult::Number(42.0), CommandResult::Number(42.0));
        assert_ne!(CommandResult::Number(1.0), CommandResult::Number(2.0));
        assert_eq!(
            CommandResult::Text("hello".into()),
            CommandResult::Text("hello".into())
        );
        assert_ne!(
            CommandResult::Text("hello".into()),
            CommandResult::Text("world".into())
        );
    }

    #[test]
    fn test_command_result_debug() {
        let void = CommandResult::Void;
        assert!(!format!("{void:?}").is_empty());

        let b = CommandResult::Bool(true);
        assert_eq!(format!("{b:?}"), "Bool(true)");

        let n = CommandResult::Number(2.5);
        assert!(format!("{n:?}").contains("2.5"));

        let t = CommandResult::Text("result".into());
        assert_eq!(format!("{t:?}"), "Text(\"result\")");
    }

    #[test]
    fn test_give_take_money() {
        let give = ScriptCommand::GiveMoney { amount: 999 };
        let take = ScriptCommand::TakeMoney { amount: 50 };
        assert_ne!(give, take);
        if let ScriptCommand::GiveMoney { amount } = &give {
            assert_eq!(*amount, 999);
        } else {
            panic!("expected GiveMoney");
        }
    }

    #[test]
    fn test_show_hide_scene() {
        let show = ScriptCommand::ShowScene {
            scene_name: "shop".into(),
            layout_json: None,
        };
        let hide = ScriptCommand::HideScene {
            scene_name: "shop".into(),
        };
        assert_ne!(show, hide);
        assert_eq!(
            show,
            ScriptCommand::ShowScene {
                scene_name: "shop".into(),
                layout_json: None
            }
        );
    }

    #[test]
    fn test_update_ui_command() {
        let cmd = ScriptCommand::UpdateUI {
            scene_name: "bag".into(),
            data_json: r#"{"gold":500}"#.into(),
        };
        assert!(format!("{cmd:?}").contains("bag"));
        assert!(format!("{cmd:?}").contains("gold"));
    }
}
