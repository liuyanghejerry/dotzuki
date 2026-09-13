impl Battle {
    /// A 1v1 battle between two already-built combatants (no RON hooks, no
    /// items — the unit-test shape).
    pub fn new(
        player: Combatant,
        enemy: Combatant,
        chart: TypeChart,
        rng: Box<dyn BattleRng>,
    ) -> Self {
        Self::with_hooks(player, enemy, chart, rng, None)
    }

    /// A battle between two already-built combatants, with the RON hook
    /// state when the project compiled one.
    pub fn with_hooks(
        player: Combatant,
        enemy: Combatant,
        chart: TypeChart,
        rng: Box<dyn BattleRng>,
        hooks: Option<HookState>,
    ) -> Self {
        Self::full(
            vec![player],
            0,
            enemy,
            Vec::new(),
            HashMap::new(),
            chart,
            rng,
            hooks,
        )
    }

    /// The full constructor: the party + its active member, the enemy, the
    /// usable items and the inventory counts.
    #[allow(clippy::too_many_arguments)]
    pub fn full(
        party: Vec<Combatant>,
        active: usize,
        enemy: Combatant,
        items: Vec<BattleItem>,
        inventory: HashMap<String, u32>,
        chart: TypeChart,
        rng: Box<dyn BattleRng>,
        hooks: Option<HookState>,
    ) -> Self {
        Self {
            party,
            active,
            enemy,
            enemies: VecDeque::new(),
            trainer: false,
            trainer_money: 0,
            exp_pool: 0,
            currency: "G".to_string(),
            items,
            inventory,
            chart,
            rng,
            hooks,
            levels: None,
            lang: "en".to_string(),
            weather: None,
            phase: Phase::Root,
            cursor: 0,
            outcome: None,
            pending_enemy: None,
            log: Vec::new(),
        }
    }

    /// A party with no living member loses before the first frame.
    pub(crate) fn arm_loss(&mut self) {
        self.outcome = Some(BattleOutcome::Lose);
    }

    /// Arm the levels config (v2-c; [`BattleSetup::start_with`] calls this).
    pub fn set_levels(&mut self, levels: Option<LevelsSetup>) {
        self.levels = levels;
    }

    /// Set the narration language (`"en"`/`"zh"`) for the EXP/level-up
    /// lines; the runner passes its `--lang` here.
    pub fn set_lang(&mut self, lang: &str) {
        self.lang = lang.to_string();
    }

    /// Set the currency label for the trainer-money narration (the runner's
    /// `shop.currency`); default "G".
    pub fn set_currency(&mut self, currency: &str) {
        self.currency = currency.to_string();
    }

    /// Arm the enemy party extras (v2-d): the enemies queued behind the
    /// active one plus the trainer flag and the win's money reward
    /// ([`BattleSetup::start_with`] calls this; the plain constructors leave
    /// a single wild enemy).
    pub fn set_enemy_party(&mut self, rest: Vec<Combatant>, trainer: bool, money: u32) {
        self.enemies = rest.into();
        self.trainer = trainer;
        self.trainer_money = money;
    }

    /// Arm the battle-local weather (v2-e): a `kind: Weather` RON record id,
    /// `None` to clear. The runner sets this from a scene's `setWeather` /
    /// `clearWeather` before the battle begins; it is never saved and dies
    /// with the battle.
    pub fn set_weather(&mut self, weather: Option<String>) {
        self.weather = weather;
    }

    /// The armed weather record id, if any (tests, introspection).
    pub fn weather(&self) -> Option<&str> {
        self.weather.as_deref()
    }

    /// Battle-start hook pass (v2-e): narrate the armed weather's intro,
    /// then fire both active combatants' ability `SwitchIn` hooks (player
    /// first). Any produced lines queue as the battle's opening narration;
    /// with nothing to say the battle opens on the root menu exactly as v1.
    /// The runner calls this once per battle, after [`set_weather`]; the
    /// plain constructors leave it to tests. No-op without hooks or once the
    /// battle is already decided.
    pub fn begin(&mut self) {
        if self.outcome.is_some() || self.hooks.is_none() {
            return;
        }
        let mut lines = VecDeque::new();
        if let Some(weather) = self.weather.clone() {
            if self.record_has_hooks(&weather) {
                narrate(
                    &mut self.log,
                    &mut lines,
                    weather_start_line(&self.lang, &weather),
                );
            } else {
                log::warn!("weather '{weather}' names no rules.ron record — ignored");
                self.weather = None;
            }
        }
        for side in [Side::Player, Side::Enemy] {
            self.fire_switch_in(side, &mut lines);
        }
        if !lines.is_empty() {
            self.phase = Phase::Narrate {
                lines,
                after: After::Menu,
            };
        }
    }

    /// Whether any compiled hook is sourced from record `id` (any kind).
    fn record_has_hooks(&self, id: &str) -> bool {
        GenericProvider::rules_host()
            .is_some_and(|host| host.compiled.hooks.values().any(|h| h.source_id == id))
    }

    /// Fire one side's ability `SwitchIn` hooks (v2-e): at battle start, on a
    /// voluntary/forced switch-in, and when an encounter sends out the next
    /// enemy. An intro line (`"Aria's Intimidate!"`) narrates first when the
    /// ability record subscribes to `SwitchIn`; the state changes ride the
    /// snapshot-diff narration. No-op without an ability or a subscription.
    fn fire_switch_in(&mut self, side: Side, lines: &mut VecDeque<String>) {
        if self.hooks.is_none() {
            return;
        }
        let combatant = match side {
            Side::Player => &self.party[self.active],
            Side::Enemy => &self.enemy,
        };
        let Some(ability) = combatant.ability.clone() else {
            return;
        };
        if !self.subscribes(&ability, Event::SwitchIn) {
            return;
        }
        let name = combatant.name.clone();
        narrate(
            &mut self.log,
            lines,
            ability_intro_line(&self.lang, &name, &ability),
        );
        self.sync_to_mirrors();
        let who = HookState::battler_ref(side);
        let before = snap_mirrors(self.hooks.as_ref().unwrap());
        self.fire(Event::SwitchIn, &[&ability], who, who, RelayVar::Unit);
        self.narrate_diffs(&before, lines, false);
        self.sync_from_mirrors();
    }

    // ── introspection (runner, tests) ───────────────────────────────────────

    /// The active player combatant.
    pub fn player(&self) -> &Combatant {
        &self.party[self.active]
    }
    /// The whole party (index 0 fights unless switched).
    pub fn party(&self) -> &[Combatant] {
        &self.party
    }
    /// The active member's index in [`party`](Self::party).
    pub fn active_index(&self) -> usize {
        self.active
    }
    /// The enemy combatant.
    pub fn enemy(&self) -> &Combatant {
        &self.enemy
    }
    /// How many enemies still wait behind the active one (v2-d encounters).
    pub fn enemies_remaining(&self) -> usize {
        self.enemies.len()
    }
    /// Whether this is a trainer battle (Run is blocked).
    pub fn is_trainer(&self) -> bool {
        self.trainer
    }
    /// The money the runner pays the player on a win (0 for wild battles).
    pub fn trainer_money(&self) -> u32 {
        self.trainer_money
    }
    /// The result, once the battle has ended (set when the last narration
    /// line is dismissed).
    pub fn outcome(&self) -> Option<BattleOutcome> {
        self.outcome
    }
    /// The full narration history.
    pub fn log(&self) -> &[String] {
        &self.log
    }
    /// The RON hook state, when this battle compiled one (tests, debug).
    pub fn hooks(&self) -> Option<&HookState> {
        self.hooks.as_ref()
    }
    /// The live inventory (record id → count).
    pub fn inventory(&self) -> &HashMap<String, u32> {
        &self.inventory
    }
    /// The persistent party state (v2-b) for the runner to keep between
    /// battles: every member's current HP/MP and status — plus level/exp
    /// (v2-c).
    pub fn party_state(&self) -> Vec<PartyMemberState> {
        self.party
            .iter()
            .map(|c| PartyMemberState {
                id: c.id.clone(),
                hp: c.hp,
                mp: c.mp,
                status: c.status.clone(),
                level: c.level,
                exp: c.exp,
            })
            .collect()
    }
    /// `true` while a player menu owns input.
    pub fn in_menu(&self) -> bool {
        !matches!(self.phase, Phase::Narrate { .. }) && self.outcome.is_none()
    }
    /// The narration line currently on screen.
    pub fn current_line(&self) -> Option<&str> {
        match &self.phase {
            Phase::Narrate { lines, .. } => lines.front().map(String::as_str),
            _ => None,
        }
    }
    /// The current menu's labels (marked `×` entries are unselectable).
    pub fn menu_items(&self) -> Vec<String> {
        match &self.phase {
            Phase::Root => self.root_items(),
            Phase::Skills => self.skill_items(),
            Phase::Party | Phase::ForcedSwitch => self.party_items(),
            Phase::Items => self.item_items(),
            Phase::Narrate { .. } => Vec::new(),
        }
    }

    /// The root menu (Item only when the project configures usable items;
    /// Run always — v2-d).
    fn root_items(&self) -> Vec<String> {
        let mut items = vec!["Fight".to_string(), "Party".to_string()];
        if !self.items.is_empty() {
            items.push("Item".to_string());
        }
        items.push("Run".to_string());
        items
    }

    /// The skill-menu labels (name + cost; unaffordable entries are marked).
    fn skill_items(&self) -> Vec<String> {
        self.player()
            .skills
            .iter()
            .map(|s| {
                let label = if s.cost > 0 {
                    format!("{} {}MP", s.name, s.cost)
                } else {
                    s.name.clone()
                };
                if s.cost > self.player().mp {
                    format!("× {label}")
                } else {
                    label
                }
            })
            .collect()
    }

    /// The party-list labels (name + HP + status; the active member and
    /// fainted members are marked `×` and cannot be picked).
    fn party_items(&self) -> Vec<String> {
        self.party
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let mut label = format!("{} {}/{}", c.name, c.hp, c.max_hp);
                if let Some(status) = &c.status {
                    label.push_str(&format!(" ({status})"));
                }
                if i == self.active || c.hp == 0 {
                    format!("× {label}")
                } else {
                    label
                }
            })
            .collect()
    }

    /// The item-list labels (name + count) for items still in the inventory.
    fn item_items(&self) -> Vec<String> {
        self.usable_items()
            .iter()
            .map(|&i| {
                let item = &self.items[i];
                let count = self.inventory.get(&item.id).copied().unwrap_or(0);
                format!("{} ×{count}", item.name)
            })
            .collect()
    }

    /// Indexes into `items` of the items with a positive inventory count.
    fn usable_items(&self) -> Vec<usize> {
        self.items
            .iter()
            .enumerate()
            .filter(|(_, item)| self.inventory.get(&item.id).copied().unwrap_or(0) > 0)
            .map(|(i, _)| i)
            .collect()
    }

    /// The first party index a switch may target (living, not active).
    fn first_switchable(&self) -> usize {
        self.party
            .iter()
            .enumerate()
            .position(|(i, c)| i != self.active && c.hp > 0)
            .unwrap_or(0)
    }

    /// Move a cursor over `n` entries with Up/Down.
    fn move_cursor(&mut self, input: &InputState, n: usize) {
        let n = n.max(1);
        if input.is_just_pressed(GbButton::Up) {
            self.cursor = (self.cursor + n - 1) % n;
        } else if input.is_just_pressed(GbButton::Down) {
            self.cursor = (self.cursor + 1) % n;
        }
    }

    // ── per-frame update ────────────────────────────────────────────────────

    /// Advance the battle one frame: menu cursor / confirm / cancel, or
    /// narration paging. Sets [`outcome`](Self::outcome) when the battle
    /// resolves.
    pub fn update(&mut self, input: &InputState) {
        match std::mem::replace(&mut self.phase, Phase::Root) {
            Phase::Root => {
                let n = self.root_items().len();
                self.move_cursor(input, n);
                if input.is_just_pressed(GbButton::A) {
                    if self.cursor == n - 1 {
                        // The last entry is always Run (v2-d).
                        self.try_run();
                        return;
                    }
                    self.phase = match self.cursor {
                        0 => Phase::Skills,
                        1 => {
                            self.cursor = self.first_switchable();
                            Phase::Party
                        }
                        _ => Phase::Items,
                    };
                    if !matches!(self.phase, Phase::Party) {
                        self.cursor = 0;
                    }
                }
            }
            Phase::Skills => {
                if input.is_just_pressed(GbButton::B) {
                    self.phase = Phase::Root;
                    self.cursor = 0;
                    return;
                }
                let n = self.player().skills.len();
                self.move_cursor(input, n);
                if input.is_just_pressed(GbButton::A) {
                    // Unaffordable skills are unselectable.
                    if self.player().skills[self.cursor].cost <= self.player().mp {
                        let pick = self.cursor;
                        self.execute_round(pick);
                        return;
                    }
                }
                self.phase = Phase::Skills;
            }
            Phase::Party => {
                if input.is_just_pressed(GbButton::B) {
                    self.phase = Phase::Root;
                    self.cursor = 0;
                    return;
                }
                let n = self.party.len();
                self.move_cursor(input, n);
                if input.is_just_pressed(GbButton::A) && self.switch_legal(self.cursor) {
                    let pick = self.cursor;
                    self.execute_switch_round(pick);
                    return;
                }
                self.phase = Phase::Party;
            }
            Phase::Items => {
                if input.is_just_pressed(GbButton::B) {
                    self.phase = Phase::Root;
                    self.cursor = 0;
                    return;
                }
                let n = self.usable_items().len();
                self.move_cursor(input, n);
                if input.is_just_pressed(GbButton::A) && n > 0 {
                    let pick = self.cursor;
                    self.execute_item_round(pick);
                    return;
                }
                self.phase = Phase::Items;
            }
            Phase::ForcedSwitch => {
                let n = self.party.len();
                self.move_cursor(input, n);
                if input.is_just_pressed(GbButton::A) && self.switch_legal(self.cursor) {
                    let pick = self.cursor;
                    self.forced_switch_to(pick);
                    return;
                }
                self.phase = Phase::ForcedSwitch;
            }
            Phase::Narrate { mut lines, after } => {
                if input.is_just_pressed(GbButton::A) {
                    lines.pop_front();
                }
                if lines.is_empty() && input.is_just_pressed(GbButton::A) {
                    match after {
                        After::Menu => {
                            self.phase = Phase::Root;
                            self.cursor = 0;
                        }
                        After::ForcedSwitch => {
                            self.cursor = self.first_switchable();
                            self.phase = Phase::ForcedSwitch;
                        }
                        After::End(o) => self.outcome = Some(o),
                    }
                } else {
                    self.phase = Phase::Narrate { lines, after };
                }
            }
        }
    }

    /// Whether party index `idx` is a legal switch target (living, not the
    /// active member).
    fn switch_legal(&self, idx: usize) -> bool {
        idx != self.active && self.party.get(idx).is_some_and(|c| c.hp > 0)
    }

    /// The Run root entry (v2-d): a wild battle ends on the spot with the
    /// `"run"` outcome (no EXP/money; the party state carries over); a
    /// trainer battle REFUSES — the line narrates and the turn is NOT
    /// consumed (back to the root menu).
    fn try_run(&mut self) {
        let mut lines = VecDeque::new();
        if self.trainer {
            narrate(&mut self.log, &mut lines, run_blocked_line(&self.lang));
            self.phase = Phase::Narrate {
                lines,
                after: After::Menu,
            };
        } else {
            narrate(&mut self.log, &mut lines, run_safe_line(&self.lang));
            self.phase = Phase::Narrate {
                lines,
                after: After::End(BattleOutcome::Run),
            };
        }
    }

    /// One full round: the player's pick vs the enemy AI's pick, faster side
    /// first (eff speed; ties go to the player), resolving each action in
    /// order and queueing the narration. After each action the acting side's
    /// status residuals fire (RON hooks), then the faint checks run.
    fn execute_round(&mut self, player_pick: usize) {
        let player_skill = self.player().skills[player_pick].clone();
        let enemy_skill = ai_pick(&self.enemy);
        let player_first = self.player().eff_speed() >= self.enemy.eff_speed();
        let order = if player_first {
            [Side::Player, Side::Enemy]
        } else {
            [Side::Enemy, Side::Player]
        };

        let mut lines = VecDeque::new();
        let mut after = After::Menu;
        for (pos, side) in order.iter().enumerate() {
            if self.player().hp == 0 || self.enemy.hp == 0 {
                break; // a faint mid-round cancels the remaining action
            }
            let skill = match side {
                Side::Player => player_skill.clone(),
                Side::Enemy => enemy_skill.clone(),
            };
            self.perform(*side, &skill, &mut lines);
            match self.faint_flow(&mut lines) {
                FaintFlow::Continue => {}
                FaintFlow::SentOut => {
                    // The replacement never acts the turn it comes in.
                    after = After::Menu;
                    break;
                }
                FaintFlow::Switch => {
                    // The enemy's action still resolves — against the
                    // replacement, once picked.
                    if order.get(pos + 1) == Some(&Side::Enemy) {
                        self.pending_enemy = Some(enemy_skill);
                    }
                    after = After::ForcedSwitch;
                    break;
                }
                FaintFlow::End(o) => {
                    after = After::End(o);
                    break;
                }
            }
            self.residual(*side, &mut lines);
            match self.faint_flow(&mut lines) {
                FaintFlow::Continue => {}
                FaintFlow::SentOut => {
                    after = After::Menu;
                    break;
                }
                FaintFlow::Switch => {
                    if order.get(pos + 1) == Some(&Side::Enemy) {
                        self.pending_enemy = Some(enemy_skill);
                    }
                    after = After::ForcedSwitch;
                    break;
                }
                FaintFlow::End(o) => {
                    after = After::End(o);
                    break;
                }
            }
        }
        self.phase = Phase::Narrate { lines, after };
    }

    /// The faint check after an action or residual: narrates the faint and
    /// decides what follows — the next queued enemy (v2-d), a forced
    /// replacement while the party has living members, else the win/lose
    /// ending.
    fn faint_flow(&mut self, lines: &mut VecDeque<String>) -> FaintFlow {
        if self.enemy.hp == 0 {
            narrate(
                &mut self.log,
                lines,
                format!("{} fainted!", self.enemy.name),
            );
            // v2-d: the EXP of every defeated enemy accumulates into the
            // end-of-battle award.
            self.exp_pool = self.exp_pool.saturating_add(self.enemy.exp_reward);
            if let Some(next) = self.enemies.pop_front() {
                self.send_out(next, lines);
                return FaintFlow::SentOut;
            }
            narrate(&mut self.log, lines, "You won the battle!".to_string());
            self.award_exp(lines);
            self.award_trainer_money(lines);
            FaintFlow::End(BattleOutcome::Win)
        } else if self.player().hp == 0 {
            let name = self.player().name.clone();
            narrate(&mut self.log, lines, format!("{name} fainted!"));
            if self.party.iter().any(|c| c.hp > 0) {
                FaintFlow::Switch
            } else {
                narrate(&mut self.log, lines, "You lost the battle…".to_string());
                FaintFlow::End(BattleOutcome::Lose)
            }
        } else {
            FaintFlow::Continue
        }
    }

    /// Send out the next queued enemy (v2-d): a fresh combatant (its own
    /// stats/level, no status); the RON opponent mirror is rebuilt and the
    /// old enemy's volatiles drop. The round then ends (the replacement
    /// never acts the turn it comes in).
    fn send_out(&mut self, next: Combatant, lines: &mut VecDeque<String>) {
        self.enemy = next;
        if let Some(hooks) = &mut self.hooks {
            hooks.state.opponent_battlers[0] = hooks::mirror_of(
                &self.enemy,
                &hooks.stat_names,
                &hooks.status_names,
                hooks.has_resource,
            );
            let enemy_ref = HookState::battler_ref(Side::Enemy);
            hooks.effects.retain(|e| e.host != enemy_ref);
        }
        let name = self.enemy.name.clone();
        narrate(&mut self.log, lines, sent_out_line(&self.lang, &name));
        // The incoming enemy's ability fires on switch-in (v2-e).
        self.fire_switch_in(Side::Enemy, lines);
    }

    /// The EXP award on a win (v2-c): every NON-fainted party member gains
    /// the SUM of every defeated enemy's `expField` value (v2-d; a wild
    /// battle's single enemy, identical to v1), then levels up while
    /// its progress covers the curve (`exp_to_next(L) = base × L^exponent`,
    /// capped at `maxLevel`), each level-up recomputing its stats and
    /// healing the max-HP/MP deltas. No `levels` block ⇒ nothing happens
    /// (v1 behavior, byte-for-byte).
    fn award_exp(&mut self, lines: &mut VecDeque<String>) {
        let Some(levels) = self.levels.clone() else {
            return;
        };
        let reward = self.exp_pool;
        let lang = self.lang.clone();
        for i in 0..self.party.len() {
            if self.party[i].hp == 0 {
                continue; // fainted members gain nothing
            }
            let name = self.party[i].name.clone();
            narrate(&mut self.log, lines, gained_exp_line(&lang, &name, reward));
            let c = &mut self.party[i];
            c.exp = c.exp.saturating_add(reward);
            loop {
                let need = levels.exp_to_next(c.level);
                if c.exp < need || c.level >= levels.max_level {
                    break;
                }
                c.exp -= need;
                c.level += 1;
                c.recompute_stats(&levels);
                narrate(&mut self.log, lines, level_up_line(&lang, &name, c.level));
            }
        }
    }

    /// The trainer-money narration on a win (v2-d): the runner reads
    /// [`trainer_money`](Self::trainer_money) and pays it when the battle
    /// ends in a win; here we only narrate. Wild battles award nothing.
    fn award_trainer_money(&mut self, lines: &mut VecDeque<String>) {
        if self.trainer_money > 0 {
            let line = trainer_money_line(&self.lang, self.trainer_money, &self.currency);
            narrate(&mut self.log, lines, line);
        }
    }

    /// A voluntary switch (the Party menu): costs the player's turn — the
    /// enemy acts after the new member comes in.
    fn execute_switch_round(&mut self, idx: usize) {
        let mut lines = VecDeque::new();
        let old_name = self.player().name.clone();
        narrate(&mut self.log, &mut lines, format!("Come back, {old_name}!"));
        self.switch_to(idx, &mut lines);
        let after = self.enemy_turn(&mut lines);
        self.phase = Phase::Narrate { lines, after };
    }

    /// An item use (the Item menu): heals the active member (capped at max),
    /// decrements the inventory, and costs the player's turn.
    fn execute_item_round(&mut self, pick: usize) {
        let usable = self.usable_items();
        let Some(&item_idx) = usable.get(pick) else {
            return;
        };
        let item = self.items[item_idx].clone();
        let mut lines = VecDeque::new();
        let before = self.player().hp;
        let healed = (before + item.heal).min(self.player().max_hp);
        self.party[self.active].hp = healed;
        if let Some(count) = self.inventory.get_mut(&item.id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.inventory.remove(&item.id);
            }
        }
        let name = self.player().name.clone();
        narrate(
            &mut self.log,
            &mut lines,
            format!("{name} used {}!", item.name),
        );
        narrate(
            &mut self.log,
            &mut lines,
            format!("{name} recovered {} HP!", healed - before),
        );
        let after = self.enemy_turn(&mut lines);
        self.phase = Phase::Narrate { lines, after };
    }

    /// The enemy's half of a switch/item round: its AI pick, then its
    /// residuals, with the faint checks between.
    fn enemy_turn(&mut self, lines: &mut VecDeque<String>) -> After {
        let skill = ai_pick(&self.enemy);
        self.perform(Side::Enemy, &skill, lines);
        match self.faint_flow(lines) {
            FaintFlow::SentOut => After::Menu,
            FaintFlow::Switch => After::ForcedSwitch,
            FaintFlow::End(o) => After::End(o),
            FaintFlow::Continue => {
                self.residual(Side::Enemy, lines);
                match self.faint_flow(lines) {
                    FaintFlow::SentOut => After::Menu,
                    FaintFlow::Switch => After::ForcedSwitch,
                    FaintFlow::End(o) => After::End(o),
                    FaintFlow::Continue => After::Menu,
                }
            }
        }
    }

    /// A forced replacement after a faint (a free action): the new member
    /// comes in, then the enemy's deferred action (if any) resolves.
    fn forced_switch_to(&mut self, idx: usize) {
        let mut lines = VecDeque::new();
        self.switch_to(idx, &mut lines);
        let mut after = After::Menu;
        if let Some(skill) = self.pending_enemy.take() {
            self.perform(Side::Enemy, &skill, &mut lines);
            match self.faint_flow(&mut lines) {
                FaintFlow::SentOut => after = After::Menu,
                FaintFlow::Switch => after = After::ForcedSwitch,
                FaintFlow::End(o) => after = After::End(o),
                FaintFlow::Continue => {
                    self.residual(Side::Enemy, &mut lines);
                    after = match self.faint_flow(&mut lines) {
                        FaintFlow::SentOut => After::Menu,
                        FaintFlow::Switch => After::ForcedSwitch,
                        FaintFlow::End(o) => After::End(o),
                        FaintFlow::Continue => After::Menu,
                    };
                }
            }
        }
        self.phase = Phase::Narrate { lines, after };
    }

    /// Bring party member `idx` in: its stat stages reset (documented), the
    /// RON mirror is re-built from the member's CURRENT state (status
    /// persists with the member), and the old battler's volatiles drop.
    fn switch_to(&mut self, idx: usize, lines: &mut VecDeque<String>) {
        self.active = idx;
        self.party[idx].stages = Stages::default();
        if let Some(hooks) = &mut self.hooks {
            hooks.state.player_battlers[0] = hooks::mirror_of(
                &self.party[idx],
                &hooks.stat_names,
                &hooks.status_names,
                hooks.has_resource,
            );
            let player_ref = HookState::battler_ref(Side::Player);
            hooks.effects.retain(|e| e.host != player_ref);
        }
        let name = self.party[idx].name.clone();
        narrate(&mut self.log, lines, format!("Go, {name}!"));
        // The incoming member's ability fires on switch-in (v2-e).
        self.fire_switch_in(Side::Player, lines);
    }

    /// Resolve one action: the MP gate (re-checked), the accuracy roll, then
    /// the skill's effect (damage / heal / stage change), narrating each step.
    /// A RON-taken-over skill runs through the stack interpreter instead
    /// ([`perform_ron`](Self::perform_ron)).
    fn perform(&mut self, side: Side, skill: &Skill, lines: &mut VecDeque<String>) {
        if skill.ron && self.hooks.is_some() {
            self.perform_ron(side, skill, lines);
            return;
        }
        let (attacker, defender) = match side {
            Side::Player => (&mut self.party[self.active], &mut self.enemy),
            Side::Enemy => (&mut self.enemy, &mut self.party[self.active]),
        };

        // The MP gate is re-checked at resolution time.
        if skill.cost > attacker.mp {
            narrate(
                &mut self.log,
                lines,
                format!("{} tried to use {}!", attacker.name, skill.name),
            );
            narrate(
                &mut self.log,
                lines,
                "But there wasn't enough MP!".to_string(),
            );
            return;
        }
        attacker.mp -= skill.cost;
        narrate(
            &mut self.log,
            lines,
            format!("{} used {}!", attacker.name, skill.name),
        );

        if !accuracy_roll(skill.accuracy, self.rng.as_mut()) {
            narrate(&mut self.log, lines, "But it missed!".to_string());
            return;
        }

        match skill.category {
            SkillCategory::Damage => {
                let mult = self
                    .chart
                    .mult(skill.element.as_deref(), defender.element.as_deref());
                let roll = damage_roll(
                    skill.power,
                    attacker.eff_attack(),
                    defender.eff_defense(),
                    mult,
                    self.rng.as_mut(),
                );
                defender.hp = defender.hp.saturating_sub(roll.damage);
                if roll.crit {
                    narrate(&mut self.log, lines, "Critical hit!".to_string());
                }
                if roll.mult_num > roll.mult_den {
                    narrate(&mut self.log, lines, "It's super effective!".to_string());
                } else if roll.mult_num < roll.mult_den {
                    narrate(&mut self.log, lines, "It's not very effective…".to_string());
                }
                narrate(&mut self.log, lines, format!("{} damage!", roll.damage));
            }
            SkillCategory::Heal => {
                let before = attacker.hp;
                attacker.hp = (attacker.hp + skill.power).min(attacker.max_hp);
                narrate(
                    &mut self.log,
                    lines,
                    format!("{} recovered {} HP!", attacker.name, attacker.hp - before),
                );
            }
            SkillCategory::Buff => {
                attacker.stages.bump(&skill.stat, 1);
                narrate(
                    &mut self.log,
                    lines,
                    format!("{}'s {} rose!", attacker.name, stat_label(&skill.stat)),
                );
            }
            SkillCategory::Debuff => {
                defender.stages.bump(&skill.stat, -1);
                narrate(
                    &mut self.log,
                    lines,
                    format!("{}'s {} fell!", defender.name, stat_label(&skill.stat)),
                );
            }
        }
    }

    // ── RON effect hooks (v2-a) ─────────────────────────────────────────────

    /// Fire one stack event for the hooks sourced from ANY of `source_ids`
    /// (a skill id plus — v2-e — the acting combatant's ability / held-item
    /// record ids, or a status / weather record id), threading `relay`
    /// through the fold (the minimon/wuxia harness shape: per-record filter →
    /// `collect_handlers` → `run_event`). Returns the fold's output relay.
    fn fire(
        &mut self,
        event: Event,
        source_ids: &[&str],
        target: BattlerRef,
        source: BattlerRef,
        relay: RelayVar,
    ) -> RelayVar {
        let hooks = self.hooks.as_mut().expect("fire requires hook state");
        let host = GenericProvider::rules_host().expect("rules host installed");
        let provider = GenericProvider;
        let mut adapter = hooks::RngAdapter(self.rng.as_mut());
        let mut ctx = BattleCtx {
            state: &mut hooks.state,
            effects: &mut hooks.effects,
            mv: &mut hooks.mv,
            rng: &mut adapter,
        };
        let mut hs = Vec::new();
        for eff in &hooks.registry {
            let matches = host
                .compiled
                .hook(eff.id)
                .map(|h| source_ids.contains(&h.source_id.as_str()))
                .unwrap_or(false);
            if matches {
                collect_handlers(&ctx, &provider, Some(eff), event, target, source, &mut hs);
            }
        }
        run_event(&mut ctx, hs, relay, false)
    }

    /// Copy the live pools (HP/MP/stats/stages/status) into the engine mirrors.
    fn sync_to_mirrors(&mut self) {
        let Some(hooks) = &mut self.hooks else { return };
        let (stat_names, status_names, has_resource) =
            (&hooks.stat_names, &hooks.status_names, hooks.has_resource);
        hooks::sync_to_mirror(
            &self.party[self.active],
            &mut hooks.state.player_battlers[0],
            stat_names,
            status_names,
            has_resource,
        );
        hooks::sync_to_mirror(
            &self.enemy,
            &mut hooks.state.opponent_battlers[0],
            stat_names,
            status_names,
            has_resource,
        );
    }

    /// Copy the pools back from the engine mirrors after a fire.
    fn sync_from_mirrors(&mut self) {
        let Some(hooks) = &mut self.hooks else { return };
        let (stat_names, status_names, has_resource) =
            (&hooks.stat_names, &hooks.status_names, hooks.has_resource);
        hooks::sync_from_mirror(
            &hooks.state.player_battlers[0],
            &mut self.party[self.active],
            stat_names,
            status_names,
            has_resource,
        );
        hooks::sync_from_mirror(
            &hooks.state.opponent_battlers[0],
            &mut self.enemy,
            stat_names,
            status_names,
            has_resource,
        );
    }

    /// Narrate the state changes a fire produced (status inflicted/cured,
    /// stat stages, HP/MP moved) by diffing the mirror snapshots. `residual`
    /// flavors HP loss as the status chip ("… is hurt by poison!").
    fn narrate_diffs(
        &mut self,
        before: &[MirrorSnap; 2],
        lines: &mut VecDeque<String>,
        residual: bool,
    ) {
        let names = [self.player().name.clone(), self.enemy.name.clone()];
        let Some(hooks) = &self.hooks else { return };
        let produced = diff_lines(hooks, before, [&names[0], &names[1]], residual);
        for line in produced {
            narrate(&mut self.log, lines, line);
        }
    }

    /// Resolve one RON-taken-over skill: the v1 MP gate + accuracy roll, then
    /// the stack event sequence over the mirrored battlers — `BeforeMove`
    /// gate (when subscribed) → damage precompute (the v1 formula into
    /// `ctx.mv.damage`) → `ModifyDamage` → `Effectiveness` → `Damage` → apply
    /// → `DamagingHit` → `AfterMove` (the minimon/wuxia fire order).
    fn perform_ron(&mut self, side: Side, skill: &Skill, lines: &mut VecDeque<String>) {
        let (attacker, defender) = match side {
            Side::Player => (&mut self.party[self.active], &mut self.enemy),
            Side::Enemy => (&mut self.enemy, &mut self.party[self.active]),
        };

        // The MP gate is re-checked at resolution time (v1 parity); the RON
        // record's `cost:` already fed `skill.cost` at load.
        if skill.cost > attacker.mp {
            narrate(
                &mut self.log,
                lines,
                format!("{} tried to use {}!", attacker.name, skill.name),
            );
            narrate(
                &mut self.log,
                lines,
                "But there wasn't enough MP!".to_string(),
            );
            return;
        }
        attacker.mp -= skill.cost;
        narrate(
            &mut self.log,
            lines,
            format!("{} used {}!", attacker.name, skill.name),
        );

        if !accuracy_roll(skill.accuracy, self.rng.as_mut()) {
            narrate(&mut self.log, lines, "But it missed!".to_string());
            return;
        }

        let eff_atk = attacker.eff_attack();
        let eff_def = defender.eff_defense();
        let def_element = defender.element.clone();
        // v2-e: the acting combatant's ability and held-item records join its
        // per-action event sequence (an ability hooking `ModifyDamage` etc.
        // fires alongside the skill's own hooks).
        let ability = attacker.ability.clone();
        let held_item = attacker.held_item.clone();
        let mut ids: Vec<&str> = vec![skill.id.as_str()];
        if let Some(a) = &ability {
            ids.push(a);
        }
        if let Some(i) = &held_item {
            ids.push(i);
        }
        let source = HookState::battler_ref(side);
        let target = HookState::battler_ref(match side {
            Side::Player => Side::Enemy,
            Side::Enemy => Side::Player,
        });

        self.sync_to_mirrors();

        // BeforeMove gate — only when the record subscribes. Relay starts
        // `Bool(true)`; a `Fail` (`VetoIf` / unaffordable `PayResource`)
        // yields `Bool(false)`, a silent veto `Unit`.
        if self.subscribes_any(&ids, Event::BeforeMove) {
            let before = snap_mirrors(self.hooks.as_ref().unwrap());
            let out = self.fire(
                Event::BeforeMove,
                &ids,
                target,
                source,
                RelayVar::Bool(true),
            );
            self.narrate_diffs(&before, lines, false);
            match out {
                RelayVar::Bool(false) => {
                    narrate(&mut self.log, lines, "But it failed!".to_string());
                    self.sync_from_mirrors();
                    return;
                }
                RelayVar::Unit => {
                    self.sync_from_mirrors();
                    return;
                }
                _ => {}
            }
        }

        // When the record subscribes to `Effectiveness` the hooks own the
        // scaling (author `ApplyTypeChart` for the chart); otherwise the v1
        // direct chart application applies in the precompute.
        let has_effectiveness_hooks = self.subscribes_any(&ids, Event::Effectiveness);

        if skill.power > 0 {
            let mult = if has_effectiveness_hooks {
                (1, 1)
            } else {
                self.chart
                    .mult(skill.element.as_deref(), def_element.as_deref())
            };
            let roll = damage_roll(skill.power, eff_atk, eff_def, mult, self.rng.as_mut());
            self.hooks.as_mut().unwrap().mv.damage = roll.damage.min(u32::from(u16::MAX)) as u16;
            if roll.crit {
                narrate(&mut self.log, lines, "Critical hit!".to_string());
            }
            if !has_effectiveness_hooks {
                if roll.mult_num > roll.mult_den {
                    narrate(&mut self.log, lines, "It's super effective!".to_string());
                } else if roll.mult_num < roll.mult_den {
                    narrate(&mut self.log, lines, "It's not very effective…".to_string());
                }
            }

            // ModifyDamage fold (ScaleRelay/SetDamage ride here).
            let before = snap_mirrors(self.hooks.as_ref().unwrap());
            let in_damage = self.hooks.as_ref().unwrap().mv.damage;
            let out = self.fire(
                Event::ModifyDamage,
                &ids,
                target,
                source,
                RelayVar::Damage(in_damage),
            );
            self.narrate_diffs(&before, lines, false);
            match out {
                RelayVar::Damage(d) => self.hooks.as_mut().unwrap().mv.damage = d,
                RelayVar::Bool(false) => {
                    narrate(&mut self.log, lines, "But it failed!".to_string());
                    self.sync_from_mirrors();
                    return;
                }
                RelayVar::Unit => {
                    self.sync_from_mirrors();
                    return;
                }
                _ => {}
            }

            // Effectiveness fold (ApplyTypeChart; effectiveness narrated from
            // what the fold actually did to the number).
            if has_effectiveness_hooks {
                let before = snap_mirrors(self.hooks.as_ref().unwrap());
                let in_damage = self.hooks.as_ref().unwrap().mv.damage;
                let out = self.fire(
                    Event::Effectiveness,
                    &ids,
                    target,
                    source,
                    RelayVar::Damage(in_damage),
                );
                self.narrate_diffs(&before, lines, false);
                match out {
                    RelayVar::Damage(d) => {
                        self.hooks.as_mut().unwrap().mv.damage = d;
                        if d > in_damage {
                            narrate(&mut self.log, lines, "It's super effective!".to_string());
                        } else if d < in_damage {
                            narrate(&mut self.log, lines, "It's not very effective…".to_string());
                        }
                    }
                    RelayVar::Bool(false) => {
                        narrate(&mut self.log, lines, "But it failed!".to_string());
                        self.sync_from_mirrors();
                        return;
                    }
                    RelayVar::Unit => {
                        self.sync_from_mirrors();
                        return;
                    }
                    _ => {}
                }
            }

            // The Damage fold (absorb / floor / veto hooks), then apply.
            let before = snap_mirrors(self.hooks.as_ref().unwrap());
            let in_damage = self.hooks.as_ref().unwrap().mv.damage;
            let out = self.fire(
                Event::Damage,
                &ids,
                target,
                source,
                RelayVar::Damage(in_damage),
            );
            self.narrate_diffs(&before, lines, false);
            let final_damage = match out {
                RelayVar::Damage(d) => d,
                RelayVar::Bool(false) => {
                    narrate(&mut self.log, lines, "But it failed!".to_string());
                    self.sync_from_mirrors();
                    return;
                }
                RelayVar::Unit => {
                    self.sync_from_mirrors();
                    return;
                }
                _ => in_damage,
            };
            {
                let hooks = self.hooks.as_mut().unwrap();
                let b = if target.side == 0 {
                    &mut hooks.state.player_battlers[target.slot as usize]
                } else {
                    &mut hooks.state.opponent_battlers[target.slot as usize]
                };
                b.take_damage(final_damage);
                hooks.mv.last_damage = final_damage;
            }
            narrate(&mut self.log, lines, format!("{final_damage} damage!"));
            // Keep the pools synced so the faint checks read live HP.
            self.sync_from_mirrors();
        }

        // DamagingHit (secondary effects: InflictStatus riders etc.) — fired
        // after any landed hit, damaging or not, so a power-0 status skill's
        // riders still run.
        let before = snap_mirrors(self.hooks.as_ref().unwrap());
        let last_damage = self.hooks.as_ref().unwrap().mv.last_damage;
        self.fire(
            Event::DamagingHit,
            &ids,
            target,
            source,
            RelayVar::Damage(last_damage),
        );
        self.narrate_diffs(&before, lines, false);

        // AfterMove (per-action cleanup: self-chips, volatiles).
        let before = snap_mirrors(self.hooks.as_ref().unwrap());
        self.fire(Event::AfterMove, &ids, target, source, RelayVar::Unit);
        self.narrate_diffs(&before, lines, false);

        self.sync_from_mirrors();
    }

    /// Whether the skill's RON record subscribes to `event`.
    fn subscribes(&self, skill_id: &str, event: Event) -> bool {
        self.hooks
            .as_ref()
            .is_some_and(|h| h.subscribes(skill_id, event))
    }

    /// Whether ANY of `ids` (a skill plus the acting combatant's ability /
    /// held-item records, v2-e) subscribes to `event`.
    fn subscribes_any(&self, ids: &[&str], event: Event) -> bool {
        ids.iter().any(|id| self.subscribes(id, event))
    }

    /// The end-of-action residual: the acting combatant's status record's
    /// `Residual` hooks (poison chip etc., v2-a), its held-item record's
    /// `Residual` hooks (Leftovers-style heal, v2-e), and the active
    /// weather's `FieldResidual` hooks with this side as the target (v2-e —
    /// so on a full round each side ticks once). No-op without hooks.
    fn residual(&mut self, side: Side, lines: &mut VecDeque<String>) {
        if self.hooks.is_none() {
            return;
        }
        // The mirror must see the action's results first (a v1-path action
        // mutates the Combatant directly).
        self.sync_to_mirrors();
        let who = HookState::battler_ref(side);

        // 1. The persistent status's residual (v2-a).
        let status_id = {
            let hooks = self.hooks.as_ref().unwrap();
            hooks
                .battler(side)
                .status
                .clone()
                .and_then(|hooks::StatusId(idx)| hooks.status_names.get(idx as usize).cloned())
        };
        if let Some(source_id) = status_id {
            let before = snap_mirrors(self.hooks.as_ref().unwrap());
            self.fire(Event::Residual, &[&source_id], who, who, RelayVar::Unit);
            self.narrate_diffs(&before, lines, true);
        }

        // 2. The held item's residual (v2-e): persistent — never consumed.
        let held_item = match side {
            Side::Player => self.party[self.active].held_item.clone(),
            Side::Enemy => self.enemy.held_item.clone(),
        };
        if let Some(item_id) = held_item {
            let before = snap_mirrors(self.hooks.as_ref().unwrap());
            self.fire(Event::Residual, &[&item_id], who, who, RelayVar::Unit);
            self.narrate_diffs(&before, lines, false);
        }

        // 3. The weather's field residual (v2-e).
        if let Some(weather) = self.weather.clone() {
            let before = snap_mirrors(self.hooks.as_ref().unwrap());
            self.fire(Event::FieldResidual, &[&weather], who, who, RelayVar::Unit);
            self.narrate_diffs(&before, lines, false);
        }

        self.sync_from_mirrors();
    }

    // ── rendering ───────────────────────────────────────────────────────────

    /// Draw the battle screen: a two-tone field with placeholder combatant
    /// blobs, an enemy panel (name, element, HP bar) up top, a player panel
    /// (name, HP bar, MP) below, and the current menu or narration line at
    /// the bottom.
    pub fn draw(&self, fb: &mut FrameBuffer) {
        // Field.
        fb.fill_rect(
            0,
            0,
            SCREEN_W as u32,
            SCREEN_H as u32,
            Rgba::rgb(0x18, 0x18, 0x28),
        );
        fb.fill_rect(
            0,
            130,
            SCREEN_W as u32,
            SCREEN_H as u32 - 130,
            Rgba::rgb(0x20, 0x2A, 0x20),
        );

        // Placeholder combatants (colored blobs, palette from the record id).
        draw_blob(fb, 228, 28, 56, blob_color(&self.enemy.id));
        draw_blob(fb, 52, 108, 64, blob_color(&self.player().id));

        // Enemy panel: name + element + HP bar.
        draw_panel(fb, 8, 8, 184, 46);
        text(fb, &self.enemy.name, 16, 14, Rgba::rgb(0xF0, 0xF0, 0xF0));
        if let Some(element) = &self.enemy.element {
            text(fb, element, 16, 26, Rgba::rgb(0x90, 0xA8, 0xC8));
        }
        draw_bar(fb, 80, 28, 104, 6, self.enemy.hp, self.enemy.max_hp);

        // Player panel (the ACTIVE member): name + HP bar + numbers + MP.
        draw_panel(fb, 132, 136, 180, 46);
        text(
            fb,
            &self.player().name,
            140,
            142,
            Rgba::rgb(0xF0, 0xF0, 0xF0),
        );
        draw_bar(fb, 140, 156, 104, 6, self.player().hp, self.player().max_hp);
        text(
            fb,
            &format!("{}/{}", self.player().hp, self.player().max_hp),
            250,
            154,
            Rgba::rgb(0xC8, 0xC8, 0xC8),
        );
        text(
            fb,
            &format!("MP {}/{}", self.player().mp, self.player().max_mp),
            140,
            168,
            Rgba::rgb(0x90, 0xA8, 0xC8),
        );

        // Bottom: the current menu (+prompt) or the current narration line.
        match &self.phase {
            Phase::Root => {
                draw_textbox(fb, "What will you do?");
                self.draw_menu(fb);
            }
            Phase::Skills => {
                draw_textbox(fb, "Choose a skill!");
                self.draw_menu(fb);
            }
            Phase::Party => {
                draw_textbox(fb, "Switch to whom?");
                self.draw_menu(fb);
            }
            Phase::Items => {
                draw_textbox(fb, "Use which item?");
                self.draw_menu(fb);
            }
            Phase::ForcedSwitch => {
                draw_textbox(fb, "Choose your next fighter!");
                self.draw_menu(fb);
            }
            Phase::Narrate { lines, .. } => {
                if let Some(line) = lines.front() {
                    draw_textbox(fb, line);
                }
            }
        }
    }

    /// The current menu above the dialogue area (the cursor marks the
    /// selection; entries marked `×` cannot be confirmed).
    fn draw_menu(&self, fb: &mut FrameBuffer) {
        let items = self.menu_items();
        let n = items.len() as u32;
        if n == 0 {
            return;
        }
        let max_len = items.iter().map(|o| o.chars().count()).max().unwrap_or(1) as u32;
        // +4: left/right border, cursor column, one padding column.
        let w = (max_len + 4).clamp(10, 24);
        let h = n + 2;
        let tx = (40 - w) as i32;
        let ty = DIALOG_AREA.ty as i32 - h as i32;
        let config = MenuConfig::new(
            TileRect::new(tx.max(0) as u32, ty.max(0) as u32, w, h),
            None,
            TileRect::new(tx.max(0) as u32 + 1, ty.max(0) as u32 + 1, w - 2, n),
            Default::default(),
        );
        let state = FlexMenuState {
            cursor: self.cursor,
            scroll_offset: 0,
        };
        let mut painter = FrameBufferPainter::new(fb);
        let mut ui = Ui::new(&mut painter);
        draw_flex_menu(&items, &[config], &state, items.len(), &mut ui);
    }
}
