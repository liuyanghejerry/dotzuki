# Your First Game in 15 Minutes

A guided tour from an empty machine to a JRPG project you can click around in —
no Rust, no code required. You can even **play** what you built: `dotzuki run`
boots your project in a window (overworld, dialogue, warps).

## 1. Start the editor

```bash
cd tools/dotzuki-editor
pnpm install
pnpm dev          # http://localhost:5174
```

Started from the editor's own repo like this, new projects are created under
**`~/jrpg-projects/<your-game>`** by default — nothing is written into the
editor repository. To put projects elsewhere, start the server with
`DOTZUKI_PROJECT_ROOT=/path/to/projects pnpm dev`.

## 2. Create the project

On the welcome screen, either:

- **Type a one-line pitch** into the hero box ("a cozy farming RPG on a
  floating island") and hit Start — the AI assistant proposes a scaffold, and
  **Apply** builds it. This needs an AI provider profile (Settings →
  providers; the key stays in your browser).
- **Or open the wizard** (the *Create with the wizard* card): name your game,
  pick a template — **Generic JRPG** is the best first choice — and confirm
  the directory name. Step 1 shows the full target path before anything is
  written.

The success panel lists what was generated and suggests first steps. Click
**Open Editor**.

## 3. Tour the starter content

A new project is not an empty shell. You get:

| Tab | What's waiting for you |
|-----|------------------------|
| **Maps** | **StartTown** — a small demo town (pond, house, plaza, flower garden) with its own starter tileset. Paint tiles, edit collision, place entities. |
| **Scripts** | `StartTown/script.scene` — the map's welcome dialogue in the Game DSL. Edit a line, save, done. |
| **Data** | Sample records: a hero (*Aria*), a monster (*Slime*), a *Potion* (dotzuki template). Add your own rows; the form is generated from the table schema. |
| **Story** | A seeded narrative bible: *Elder Mira* (character) and the *Welcome to StartTown* quest, linked to the map's scene. This is the Story Designer — bible, quest graph, consistency checks. |
| **Tiles** | The shared tile library, pre-seeded with the 16 starter tiles. |

## 4. Make it yours — three five-minute edits

1. **Change the welcome line.** Scripts tab → `StartTown/script.scene` → edit
   the dialogue inside `@speaker("Guide")`. The scene compiles with the same
   DSL `dotzuki check` validates.
2. **Reshape the town.** Maps tab → StartTown → pick tiles from the library
   and paint. Widen the pond, add a second house, move the garden.
3. **Add a character.** Story tab → new character, or Data tab → new record in
   `heroes`. The AI assistant (✨) can flesh out personalities, quests, and
   whole scenes from a one-line brief.
4. **Start a battle** (dotzuki template). Add one line to `StartTown/script.scene`
   after the welcome dialogue:

   ```
   @command("startBattle", "slime")
   ```

   `dotzuki run` suspends the scene, drops into a battle — Aria (your first
   `heroes` record) against the Slime — then resumes the scene with the
   result. Combat is fully data-driven: stats come from the record fields,
   skills from the `spells` table, and type effectiveness from
   `data/rules.ron`. The seeded Slime also knows `venom-sting`, whose
   `rules.ron` `Effect` record poisons on hit (30%) — and the `poison`
   status record's `Residual` hook chips 1/8 max HP per action, all without
   a line of Rust. Add a monster row, teach it `tackle`, and it's
   immediately fightable. Capture the outcome with
   `@let result = startBattle("slime")` + `@if`.

   Or fight the seeded **trainer**: `@command("startBattle", "bug-catcher")`
   reads the `encounters` table — an ordered enemy party (they come out one
   after another, EXP sums) with a trainer flag (Run is blocked) and a money
   reward (32 G on a win). A wild battle's **Run** root-menu entry always
   works and returns `"run"` to the scene — distinct from both `"win"` and
   `"lose"`.

## 5. Play it

The `dotzuki` CLI boots your project in a window — walk around StartTown with
the arrow keys, talk with **Z** (the A button), warp between maps:

```bash
dotzuki run ~/jrpg-projects/<your-game>
```

For CI or a quick smoke test, `--headless` runs frames without a window and
can dump a screenshot:

```bash
dotzuki run ~/jrpg-projects/<your-game> --headless --frames 240 --screenshot shot.png
```

Also compile-check every DSL file after edits — it exits non-zero and prints
diagnostics when a `.scene`/`.gui` file is broken:

```bash
dotzuki check ~/jrpg-projects/<your-game>
```

(In-editor, the Scripts tab's 🔍 lint catches dangling flags and unknown
`game.*` APIs as you type.)

## Where next

- **AI-assisted building** — the assistant can draft maps
  (`propose_map_create`), edit the manifest, refine characters, and generate
  `.scene` implementations for quests. See `docs/AI_AGENT_FRAMEWORK.md`.
- **Reference layouts** — `workspace/docs/game-project-spec.md` is the
  contract for what a game project contains, including the full `dotzuki run`
  behavior (entry resolution, scene dispatch, supported commands).
- **Current limits** — every `rules.ron` effect kind
  IS data-driven (`kind: Move`/`Status` hooks — the seeded
  `venom-sting` + `poison` show the shape — plus `kind: Ability`/`Item`/
  `Weather`: Aria's seeded `intimidate` drops the foe's attack on switch-in,
  Bryn's `leftovers` heal him after his actions, and a scene can arm the
  seeded `sandstorm` with `game.setWeather("sandstorm")` before
  `startBattle`); held items are never consumed, weather is battle-local
  (scene-armed only), and a lost battle heals the
  party and returns you to the entry map's spawn (no heal-point system yet).
  Everything else is in: enemy parties (the `encounters` table — queued
  send-outs, summed EXP), trainer battles (Run blocked, money on a win), a
  wild-only Run action (the scene sees a third outcome, `"run"`), and shop
  selling at half price.
