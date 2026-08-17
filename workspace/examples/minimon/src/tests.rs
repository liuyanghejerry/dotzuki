//! minimon's hand-specified outcome assertions (design §6.1/§6.2 "Generality").
//!
//! NO parity oracle — each test asserts a **hand-derived** expected
//! `BattleState` outcome (the way Showdown unit-tests an ability). The point is
//! to prove the 5 authored systems produce the right results on the engine's
//! effect-stack with **no engine edit**.
//!
//! Damage formula (minimon, deliberately tiny + deterministic, no rolls):
//!   `damage = power * eff_atk / eff_def`, eff_X = base scaled by stat stage
//!   (`apply_stage`: `+n` ⇒ `×(2+n)/2`, `-n` ⇒ `×2/(2+n)`).

use super::*;
use dotzuki_engine::battle::stack::EffectHost;

/// A defender whose Def (50) differs from its SpD (100) so a physical move and a
/// special move of equal power deal **different** damage.
fn split_defender() -> BattlerState<MinimonProvider> {
    battler(
        Species::plain(),
        100,
        /*atk*/ 50,
        /*def*/ 50,
        /*spa*/ 50,
        /*spd*/ 100,
        /*spe*/ 50,
        vec![],
    )
}

/// An attacker with Atk == SpA == 100 (so only the *defensive* stat read differs).
fn split_attacker(moves: Vec<Move>) -> BattlerState<MinimonProvider> {
    battler(Species::plain(), 100, 100, 50, 100, 50, 50, moves)
}

// ── System 1: the physical/special split (design §5/§6.1 #1). ──
//
// Same power (40), same attacker (Atk = SpA = 100), same defender — only the
// move category differs, so the engine-invisible `P::Stat` split produces two
// distinct outcomes. Physical reads Def(50) → 40*100/50 = 80; special reads
// SpD(100) → 40*100/100 = 40.

#[test]
fn physical_and_special_moves_deal_different_damage_via_the_split() {
    // Physical (Tackle): reads defender Def = 50.
    let mut phys = Battle::new(
        MinimonProvider::default(),
        split_attacker(vec![TACKLE]),
        split_defender(),
    );
    phys.fire_move(BattlerRef::PLAYER, &TACKLE);
    let phys_dmg = 100 - phys.battler_ref(BattlerRef::OPPONENT).hp;
    assert_eq!(phys_dmg, 80, "physical move read Atk/Def: 40*100/50 = 80");

    // Special (Ember): reads defender SpD = 100.
    let mut spec = Battle::new(
        MinimonProvider::default(),
        split_attacker(vec![EMBER]),
        split_defender(),
    );
    spec.fire_move(BattlerRef::PLAYER, &EMBER);
    let spec_dmg = 100 - spec.battler_ref(BattlerRef::OPPONENT).hp;
    assert_eq!(spec_dmg, 40, "special move read SpA/SpD: 40*100/100 = 40");

    // The split is real: the SAME power deals DIFFERENT damage by category.
    assert_ne!(
        phys_dmg, spec_dmg,
        "phys vs special outcomes differ → the split works"
    );
}

// ── System 2: Intimidate (design §4.2b/§6.1 #2). ──
//
// SwitchIn → effect_for_ability → the entrant's Intimidate fires a TryBoost on
// the foe → -1 Atk stage → the foe's physical move now hits softer.

#[test]
fn intimidate_drops_foe_attack_so_its_physical_move_hits_softer() {
    let intimidator = battler(
        Species::plain().with_ability(Ability::Intimidate),
        100,
        50,
        50,
        50,
        50,
        50,
        vec![],
    );
    // The FOE (opponent) is the attacker whose Atk gets dropped.
    let foe = battler(Species::plain(), 100, 100, 50, 50, 50, 50, vec![TACKLE]);

    let mut b = Battle::new(MinimonProvider::default(), intimidator, foe);
    // The intimidator (player) switches in → drops the opponent's Atk one stage.
    b.switch_in(BattlerRef::PLAYER);
    assert_eq!(
        b.battler_ref(BattlerRef::OPPONENT)
            .stat_stages
            .get(Stat::Atk)
            .copied(),
        Some(-1),
        "Intimidate routed a -1 Atk through TryBoost (no veto) → foe Atk = -1 stage"
    );

    // Now the foe attacks the intimidator (Def 50). eff_atk = 100*2/3 = 66 →
    // 40*66/50 = 52.8 → 52 (truncated). Without Intimidate it would be 80.
    b.fire_move(BattlerRef::OPPONENT, &TACKLE);
    let dmg = 100 - b.battler_ref(BattlerRef::PLAYER).hp;
    assert_eq!(
        dmg, 52,
        "Intimidated foe (Atk -1) deals 40*66/50 = 52, softer than 80"
    );
    assert!(dmg < 80, "softer than the un-intimidated 80");
}

// ── System 3: Clear Body vetoes Intimidate (design §4.2/§6.1 #3). ──
//
// The foe has Clear Body → on the SAME TryBoost dispatch, BOTH Intimidate
// (the -1 request, hosted on the source) and Clear Body (the veto, hosted on the
// target) are collected and folded in comparator order; Clear Body returns Fail
// → the drop is cancelled → the foe's Atk stays 0 → full damage.

#[test]
fn clear_body_cancels_intimidate() {
    let intimidator = battler(
        Species::plain().with_ability(Ability::Intimidate),
        100,
        50,
        50,
        50,
        50,
        50,
        vec![],
    );
    let clear_body_foe = battler(
        Species::plain().with_ability(Ability::ClearBody),
        100,
        100,
        50,
        50,
        50,
        50,
        vec![TACKLE],
    );

    let mut b = Battle::new(MinimonProvider::default(), intimidator, clear_body_foe);
    b.switch_in(BattlerRef::PLAYER);
    assert_eq!(
        b.battler_ref(BattlerRef::OPPONENT)
            .stat_stages
            .get(Stat::Atk)
            .copied()
            .unwrap_or(0),
        0,
        "Clear Body vetoed the TryBoost → foe Atk stage unchanged (0)"
    );

    // Foe's physical move now deals the FULL 80 (Atk un-dropped).
    b.fire_move(BattlerRef::OPPONENT, &TACKLE);
    let dmg = 100 - b.battler_ref(BattlerRef::PLAYER).hp;
    assert_eq!(dmg, 80, "Clear Body kept Atk at 0 → full 40*100/50 = 80");
}

/// Directly prove BOTH abilities are collected on ONE `TryBoost` dispatch, in
/// comparator (`order`) order — Clear Body (order 5) before any later
/// contributor (design §6.1 #3: "both abilities fire on one TryBoost").
#[test]
fn both_abilities_collected_on_one_try_boost_in_order() {
    let intimidator = battler(
        Species::plain().with_ability(Ability::Intimidate),
        100,
        50,
        50,
        50,
        50,
        50,
        vec![],
    );
    let clear_body_foe = battler(
        Species::plain().with_ability(Ability::ClearBody),
        100,
        100,
        50,
        50,
        50,
        50,
        vec![],
    );
    let mut b = Battle::new(MinimonProvider::default(), intimidator, clear_body_foe);

    // Build the same dispatch switch_in's step 2 fires: TryBoost on the foe
    // (target = opponent w/ Clear Body), source = the intimidator (player).
    let provider = &b.provider;
    let ctx = BattleCtx {
        state: &mut b.state,
        effects: &mut b.effects,
        mv: &mut b.mv,
        rng: &mut b.rng,
    };
    let mut hs = Vec::new();
    collect_handlers(
        &ctx,
        provider,
        None,
        Event::TryBoost,
        BattlerRef::OPPONENT,
        BattlerRef::PLAYER,
        &mut hs,
    );
    // Only Clear Body subscribes to TryBoost (Intimidate subscribes to SwitchIn
    // and *fires* TryBoost via the driver) — so the veto is present on the foe's
    // boost dispatch, hosted on the TARGET (cross-source collection across
    // battlers, the prefix-synthesis path of design §2.2).
    hs.sort_by(dotzuki_engine::battle::stack::compare);
    let orders: Vec<u32> = hs.iter().map(|h| h.order).collect();
    assert_eq!(
        orders,
        vec![5],
        "Clear Body (order 5) collected on the foe's TryBoost"
    );
    // And it is hosted on the TARGET (the foe), proving cross-battler collection.
    assert_eq!(hs[0].target, BattlerRef::OPPONENT);
}

// ── System 4: Leftovers heals AFTER the status chip (design §4.2c/§6.1 #4). ──
//
// One Residual dispatch collects the poison chip (status effect, order 10) AND
// the Leftovers heal (item effect, order 20). Comparator sorts by order → chip
// FIRST, heal SECOND. From full hp (100): chip 100/8 = 12 → 88, then heal
// 100/16 = 6 → 94. (If the order were reversed, heal-first at full hp is a
// no-op, then chip → 88. So 94 PROVES chip-before-heal.)

#[test]
fn leftovers_heals_after_the_status_chip_in_the_right_order() {
    let mut holder = battler(
        Species::plain().with_item(Item::Leftovers),
        100,
        50,
        50,
        50,
        50,
        50,
        vec![],
    );
    holder.status = Some(Status::Poisoned);
    let dummy = battler(Species::plain(), 100, 50, 50, 50, 50, 50, vec![]);

    let mut b = Battle::new(MinimonProvider::default(), holder, dummy);
    b.end_of_turn_residual(BattlerRef::PLAYER);

    let hp = b.battler_ref(BattlerRef::PLAYER).hp;
    assert_eq!(
        hp, 94,
        "chip (order 10) then heal (order 20): 100 - 12 + 6 = 94 \
         (heal-first would be a no-op at full hp → 88, so 94 proves the order)"
    );
}

/// Control: a poisoned holder with NO Leftovers just takes the chip (88), so the
/// +6 in the previous test is unambiguously the item firing AFTER the chip.
#[test]
fn poison_chip_alone_is_lower_than_with_leftovers() {
    let mut poisoned = battler(Species::plain(), 100, 50, 50, 50, 50, 50, vec![]);
    poisoned.status = Some(Status::Poisoned);
    let dummy = battler(Species::plain(), 100, 50, 50, 50, 50, 50, vec![]);
    let mut b = Battle::new(MinimonProvider::default(), poisoned, dummy);
    b.end_of_turn_residual(BattlerRef::PLAYER);
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).hp,
        88,
        "chip only: 100 - 12 = 88"
    );
}

// ── System 5: Sandstorm (design §4.2d/§6.1 #5). ──
//
// Field-hosted (EffectHost::Field), resolved by field_effects. FieldResidual
// chips non-Rock 1/16; WeatherModifyStat boosts Rock SpD ×1.5 (layered after the
// ModifyStat SpD read).

#[test]
fn sandstorm_chips_non_rock_and_boosts_rock_spd() {
    let normal = battler(
        Species::plain().with_type(MType::Normal),
        100,
        50,
        50,
        50,
        100,
        50,
        vec![],
    );
    let rock = battler(
        Species::plain().with_type(MType::Rock),
        100,
        50,
        50,
        50,
        100,
        50,
        vec![],
    );

    // weather_on = true → Sandstorm is live on the field.
    let mut b = Battle::new(
        MinimonProvider {
            weather_on: true,
            ..Default::default()
        },
        normal,
        rock,
    );

    // FieldResidual chip: Normal loses 100/16 = 6; Rock is immune.
    b.weather_residual();
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).hp,
        94,
        "Sandstorm chipped the Normal battler 100/16 = 6 → 94"
    );
    assert_eq!(
        b.battler_ref(BattlerRef::OPPONENT).hp,
        100,
        "Rock is immune to the Sandstorm chip"
    );

    // WeatherModifyStat: Rock SpD ×1.5 (100 → 150); Normal unchanged (100).
    let rock_spd = b.effective_spd_with_weather(BattlerRef::OPPONENT);
    let normal_spd = b.effective_spd_with_weather(BattlerRef::PLAYER);
    assert_eq!(
        rock_spd, 150,
        "Sandstorm boosts Rock SpD ×1.5 (ModifyStat→WeatherModifyStat layering)"
    );
    assert_eq!(normal_spd, 100, "non-Rock SpD unboosted");
}

/// Control: weather OFF → no chip, no SpD boost (the field_effects resolver
/// returns empty, so neither Sandstorm hook is ever collected).
#[test]
fn no_weather_means_no_chip_and_no_boost() {
    let normal = battler(
        Species::plain().with_type(MType::Normal),
        100,
        50,
        50,
        50,
        100,
        50,
        vec![],
    );
    let rock = battler(
        Species::plain().with_type(MType::Rock),
        100,
        50,
        50,
        50,
        100,
        50,
        vec![],
    );
    let mut b = Battle::new(MinimonProvider::default(), normal, rock); // weather_on = false
    b.weather_residual();
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).hp,
        100,
        "no weather → no chip"
    );
    assert_eq!(
        b.effective_spd_with_weather(BattlerRef::OPPONENT),
        100,
        "no weather → no Rock SpD boost"
    );
}

// ── System 6: the 金木水火土 (Metal/Wood/Water/Fire/Earth) type chart (doc 12). ──
//
// The chart rides the engine's `Effectiveness` fold, fired in `fire_move` between
// ModifyDamage and the apply (doc 12 §1.0/§1.1: the POC drives `fire_move`). For
// every assertion `atk == def` (all stats 100) so base damage == power (80),
// isolating the chart fold `base * num / den` (integer-truncated, like Sandstorm).
//   super-effective 金克木  blade(80,Metal) vs Wood   [2,1] → 80*2/1 = 160
//   resisted               blade(80,Metal) vs Fire   [1,2] → 80*1/2 = 40
//   immune    水→木        torrent(80,Water) vs Wood [0,1] → 80*0/1 = 0
//   neutral (control)      blade(80,Metal) vs Earth  omitted [1,1] → 80

/// An attacker with every stat 100 (so atk == def against a 100-stat defender ⇒
/// base damage == power, per doc 12 §4).
fn chart_attacker(moves: Vec<Move>) -> BattlerState<MinimonProvider> {
    battler(Species::plain(), 100, 100, 100, 100, 100, 100, moves)
}
/// A 100-stat defender of the given element.
fn chart_defender(t: MType) -> BattlerState<MinimonProvider> {
    battler(
        Species::plain().with_type(t),
        100,
        100,
        100,
        100,
        100,
        100,
        vec![],
    )
}
/// Fire one typed move from the player at a defender of `def_type`, return the
/// damage the defender took (100 - hp).
fn run_one_hit(move_: &Move, def_type: MType) -> u16 {
    let mut b = Battle::new(
        MinimonProvider::default(),
        chart_attacker(vec![move_.clone()]),
        chart_defender(def_type),
    );
    b.fire_move(BattlerRef::PLAYER, move_);
    100 - b.battler_ref(BattlerRef::OPPONENT).hp
}

#[test]
fn metal_super_effective_doubles() {
    // 金克木: Metal vs Wood [2,1] → 80*2/1 = 160 (the defender has 100 hp, so it
    // is KO'd; damage_dealt == 100 here, but the FOLD produced 160 ≥ hp). Assert
    // against a high-hp defender so the full 160 is observable.
    let mut b = Battle::new(
        MinimonProvider::default(),
        chart_attacker(vec![BLADE]),
        battler(
            Species::plain().with_type(MType::Wood),
            500,
            100,
            100,
            100,
            100,
            100,
            vec![],
        ),
    );
    b.fire_move(BattlerRef::PLAYER, &BLADE);
    let dealt = 500 - b.battler_ref(BattlerRef::OPPONENT).hp;
    assert_eq!(dealt, 160, "金克木 super-effective: 80 * 2/1 = 160");
}

#[test]
fn metal_resisted_halves() {
    let dealt = run_one_hit(&BLADE, MType::Fire); // Metal → Fire [1,2]
    assert_eq!(dealt, 40, "resisted: 80 * 1/2 = 40");
}

#[test]
fn water_immune_to_wood_deals_zero() {
    // 水→木 [0,1]: Water cannot damage Wood ⇒ 0 ⇒ defender hp UNCHANGED.
    let mut b = Battle::new(
        MinimonProvider::default(),
        chart_attacker(vec![TORRENT]),
        chart_defender(MType::Wood),
    );
    b.fire_move(BattlerRef::PLAYER, &TORRENT);
    assert_eq!(
        b.battler_ref(BattlerRef::OPPONENT).hp,
        100,
        "immune: hp unchanged"
    );
    assert_eq!(
        100 - b.battler_ref(BattlerRef::OPPONENT).hp,
        0,
        "immune: 80 * 0/1 = 0"
    );
}

#[test]
fn neutral_omitted_pair_deals_base() {
    // Metal → Earth is an OMITTED pair ⇒ defaults [1,1] ⇒ identity fold ⇒ base 80.
    // This is the load-bearing control: it proves the fire is correct (a true 1×),
    // not merely absent.
    let dealt = run_one_hit(&BLADE, MType::Earth);
    assert_eq!(dealt, 80, "neutral (omitted ⇒ [1,1]): 80 * 1/1 = 80");
}

/// The doc 12 §4 ordering, asserted directly: super-effective > neutral >
/// resisted > immune.
#[test]
fn chart_outcomes_are_ordered() {
    // super-effective measured on a high-hp defender (so 160 is observable).
    let super_eff = {
        let mut b = Battle::new(
            MinimonProvider::default(),
            chart_attacker(vec![BLADE]),
            battler(
                Species::plain().with_type(MType::Wood),
                500,
                100,
                100,
                100,
                100,
                100,
                vec![],
            ),
        );
        b.fire_move(BattlerRef::PLAYER, &BLADE);
        500 - b.battler_ref(BattlerRef::OPPONENT).hp
    };
    let neutral = run_one_hit(&BLADE, MType::Earth);
    let resisted = run_one_hit(&BLADE, MType::Fire);
    let immune = run_one_hit(&TORRENT, MType::Wood);
    assert_eq!((super_eff, neutral, resisted, immune), (160, 80, 40, 0));
    assert!(
        super_eff > neutral && neutral > resisted && resisted > immune,
        "super-effective(160) > neutral(80) > resisted(40) > immune(0)"
    );
}

/// Inertness witness: a `Normal`-type move (TACKLE) has NO chart edge ⇒ the
/// Effectiveness fold is a true identity ⇒ byte-identical to the pre-chart split
/// outcome (80). Pairs with the existing split test (which also expects 80).
#[test]
fn normal_move_is_inert_through_the_chart_fold() {
    let mut b = Battle::new(
        MinimonProvider::default(),
        split_attacker(vec![TACKLE]),
        split_defender(),
    );
    b.fire_move(BattlerRef::PLAYER, &TACKLE);
    assert_eq!(
        100 - b.battler_ref(BattlerRef::OPPONENT).hp,
        80,
        "Normal move: chart fold is identity (1×) ⇒ unchanged 40*100/50 = 80"
    );
}

// ── System 7: the generic MP / resource cost gate (doc 13 §4). ──
//
// A special (元素/elemental) move costs MP; a physical move costs nothing. The
// engine assigns the resource NO meaning — `move_cost` hands it an opaque
// `(id, amount)` slice. We assert: (a) an affordable special move deducts MP and
// still hits; (b) an unaffordable special move is PREVENTED (defender unharmed,
// caster MP unchanged); (c) a physical move is unaffected even with MP present.
//
// BLADE (金/Metal, power 80) costs 3 MP; TORRENT (水/Water) costs 5 MP; TACKLE
// (Normal, physical) costs nothing. The caster carries an MP pool via
// `with_resource(MP, …)`; the engine's pool defaults EMPTY (proved elsewhere).

/// A caster of the given element with `mp` MP and 100 of every stat (so atk == def
/// against a 100-stat defender ⇒ base damage == power, isolating the cost gate).
fn mp_caster(mp: u16, moves: Vec<Move>) -> BattlerState<MinimonProvider> {
    battler(Species::plain(), 100, 100, 100, 100, 100, 100, moves).with_resource(MP, mp)
}

#[test]
fn special_move_costs_mp_and_deducts_it() {
    // BLADE (金/Metal) vs an Earth defender: Metal→Earth is an OMITTED chart pair
    // ⇒ neutral 1× ⇒ base damage 80. The caster has 10 MP; BLADE costs 3 ⇒ it acts
    // (deals 80) and ends with 10 - 3 = 7 MP.
    let mut b = Battle::new(
        MinimonProvider::default(),
        mp_caster(10, vec![BLADE]),
        chart_defender(MType::Earth),
    );
    b.fire_move(BattlerRef::PLAYER, &BLADE);
    assert_eq!(
        100 - b.battler_ref(BattlerRef::OPPONENT).hp,
        80,
        "affordable special move connected (neutral 80)"
    );
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).resources.current(MP),
        Some(7),
        "BLADE deducted its 3 MP: 10 - 3 = 7"
    );
}

#[test]
fn insufficient_mp_prevents_the_move_and_leaves_mp_unchanged() {
    // The caster has only 2 MP; BLADE costs 3 ⇒ it CANNOT pay ⇒ the move is
    // PREVENTED: the defender takes NO damage and the caster's MP is unchanged.
    let mut b = Battle::new(
        MinimonProvider::default(),
        mp_caster(2, vec![BLADE]),
        chart_defender(MType::Earth),
    );
    b.fire_move(BattlerRef::PLAYER, &BLADE);
    assert_eq!(
        b.battler_ref(BattlerRef::OPPONENT).hp,
        100,
        "insufficient MP ⇒ move prevented ⇒ defender unharmed"
    );
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).resources.current(MP),
        Some(2),
        "prevented move deducts NOTHING ⇒ MP unchanged at 2"
    );
}

#[test]
fn physical_move_with_no_cost_is_unaffected_by_mp() {
    // TACKLE (Normal, physical) costs nothing. Even a caster with 0 MP fires it
    // normally (deals its split-aware 80 vs a Def-50 defender), and the MP pool is
    // untouched. Proves the cost gate is inert for cost-free moves.
    let mut b = Battle::new(
        MinimonProvider::default(),
        battler(Species::plain(), 100, 100, 50, 100, 50, 50, vec![TACKLE]).with_resource(MP, 0),
        split_defender(),
    );
    b.fire_move(BattlerRef::PLAYER, &TACKLE);
    assert_eq!(
        100 - b.battler_ref(BattlerRef::OPPONENT).hp,
        80,
        "physical no-cost move connected (40*100/50 = 80) despite 0 MP"
    );
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).resources.current(MP),
        Some(0),
        "no-cost move left MP untouched"
    );
}

#[test]
fn torrent_costs_5_mp_exact_balance_is_payable() {
    // TORRENT (水/Water) costs 5 MP. A caster with EXACTLY 5 MP affords it (vs an
    // Earth defender: Water→Earth is resisted [1,2] ⇒ 80*1/2 = 40) and ends at 0.
    let mut b = Battle::new(
        MinimonProvider::default(),
        mp_caster(5, vec![TORRENT]),
        chart_defender(MType::Earth),
    );
    b.fire_move(BattlerRef::PLAYER, &TORRENT);
    assert_eq!(
        100 - b.battler_ref(BattlerRef::OPPONENT).hp,
        40,
        "Water→Earth resisted: 80*1/2 = 40"
    );
    assert_eq!(
        b.battler_ref(BattlerRef::PLAYER).resources.current(MP),
        Some(0),
        "exact 5 MP paid in full ⇒ 0 left"
    );
}

// ── Agnosticism witness: the field effect routes through EffectHost::Field. ──
//
// Proves the design §3.1 EffectHost::Field scope is the host minimon's weather
// uses — a small direct assertion that the engine's 3-way host scope is exercised
// by a real (non-engine-test) game.
#[test]
fn sandstorm_is_field_hosted() {
    // The Sandstorm effect is resolved via field_effects (the EffectHost::Field
    // path), NOT via a battler/side resolver. Witness: it is absent from
    // effect_for_ability/item and present in field_effects when weather_on.
    let provider = MinimonProvider {
        weather_on: true,
        ..Default::default()
    };
    let mut state = BattleState::new(
        vec![battler(Species::plain(), 100, 50, 50, 50, 50, 50, vec![])],
        vec![battler(Species::plain(), 100, 50, 50, 50, 50, 50, vec![])],
    );
    let mut effects: Vec<EffectState<MinimonProvider>> = Vec::new();
    let mut mv = MoveContext::default();
    let mut rng = ScriptedRng::new(vec![]);
    let ctx = BattleCtx {
        state: &mut state,
        effects: &mut effects,
        mv: &mut mv,
        rng: &mut rng,
    };
    let fields = provider.field_effects(&ctx);
    assert_eq!(fields.len(), 1, "Sandstorm is the one live field effect");
    assert_eq!(
        fields[0].id, SANDSTORM.id,
        "and it is the Sandstorm effect (field-hosted)"
    );

    // EffectHost::Field is a distinct scope from Battler/Side (the widened
    // 3-way addressing).
    assert_ne!(EffectHost::Field, EffectHost::Side(0));
    assert_ne!(EffectHost::Field, EffectHost::Battler(BattlerRef::PLAYER));
}
