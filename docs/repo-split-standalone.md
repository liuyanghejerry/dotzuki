# 仓库拆分:引擎 / pokered / wuxia(本地快照,2026-08)

> 状态:三个仓库均已推送 GitHub——引擎(无历史快照)→ [liuyanghejerry/dotzuki](https://github.com/liuyanghejerry/dotzuki),pokered → [liuyanghejerry/open-pokered](https://github.com/liuyanghejerry/open-pokered),wuxia(改名 **star-heir**)→ [liuyanghejerry/star-heir](https://github.com/liuyanghejerry/star-heir)。

## 拆分结果(本地)

| 仓库 | 位置 | 分支/提交 | 内容 |
|---|---|---|---|
| **dotzuki 引擎(本仓库,原 jrpg 引擎)** | `~/develop/dotzuki`(无历史快照;源分支 `feat/standalone-repos-split` 在旧 monorepo worktree) | `master`,tag `v0.1.0` | 15 个 `dotzuki-*` crate + `firered`/`minimon` 示例 + `dotzuki-editor` + `dotzuki-template` + 引擎 docs |
| **pokered** | `~/develop/open-pokered` | `master`,初始提交 `14c80f5`(无历史) | 8 游戏 crate + 5 平台壳 + `scene_apply` bin + pokered-editor + android/ios + scripts/docs/CI |
| **wuxia** | `~/develop/star-heir` | `master`,初始提交 `4563400`(无历史) | `starheir-app`/`starheir-data`/`starheir-battle-proto` + `scene-check` bin + 全量 data/docs/.claude |

两个游戏仓库均为**快照新建**(无历史),初始提交即全部内容。

## 引擎依赖方式

游戏仓库的 Cargo.toml 以 **git 依赖 + tag** 消费引擎 crate:

```toml
dotzuki-engine = { git = "file:///path/to/engine-checkout", tag = "v0.1.0" }
```

- Cargo 在引擎 git 仓库的 workspace 内按包名查找,15 个 `dotzuki-*` crate(含收编为 member 的 `dotzuki-app`)都可被直接依赖;同一 (repo, rev) 共享一次检出,`Cargo.lock` 钉死 commit。
- 升级引擎 = 引擎仓打新 tag → 游戏仓改 tag + `cargo update`。
- **创建 GitHub 仓库后的切换**:把每个 Cargo.toml 里的 `file:///...` 换成新仓库 URL(如 `ssh://git@github.com/<org>/dotzuki-engine.git`),`cargo update` 重解析即可。私有仓库走 SSH;CI 用 deploy key;建议消费方 `.cargo/config.toml` 设 `net.git-fetch-with-cli = true`。

## 引擎侧为拆分做的改动

1. `dotzuki-engine-script/build.rs`:删除 pokered maps 探测,`embedded-scripts` feature 恒生成空 stub(no-op,保留以便消费方转发 feature)。
2. `dotzuki-engine-script/src/loader.rs`:删除 `load_auto` 的 CWD pokered 回退;删除 3 个依赖 pokered 数据的测试;log target `pokered::overworld` → `jrpg::overworld`(engine.rs 20 处 + loader.rs 2 处)。
3. `dotzuki-engine-dsl/src/compiler.rs`:`find_search_dirs` 删除 pokered-data 分支(保留 `examples/*/assets` + `dotzuki-template/assets` + `JRPG_DSL_DIRS` 注入)。
4. `dotzuki-engine-dsl/tests/config_roundtrip.rs` → 迁至 pokered 仓(`pokered-data/tests/`,maps_dir 改为 `manifest_dir/maps`)。
5. `dotzuki-engine-dsl/src/bin/scene_apply.rs` → 迁至 pokered 仓(`crates/scene_apply/`,maps_dir 改为 `../../examples/pokered/...`)。
6. `dotzuki-renderer/src/layout_engine/deserialize.rs`:`load_layout` 删除 `pokered-data/ui_layouts` 候选路径。
7. `dotzuki-renderer/tests/gui_layout_roundtrip.rs`:改为引擎自带内联 fixture(panel/text/tile/divider/container/list/flex_list/cursor/image),不再读 pokered ui_layouts。
8. `workspace/Cargo.toml`:成员删除 pokered/wuxia 全部 crate,`dotzuki-app` 收编为 member。
9. 顺带修复:dotzuki-rules-macro 两个无法编译的 doctest 标记为 ignore(master 上既有问题,与拆分无关)。
10. pokered 侧联动:`pokered-core/src/debug_log.rs` 的 Overworld 过滤器需同时匹配 `jrpg::` target(引擎日志仍能被 `--debug-modules overworld` 捕获)——已随 pokered 仓一并改好。

## 游戏仓库侧改动

### pokered(`open-pokered`)
- 8 个游戏 crate 的 `dotzuki-*` path 依赖 → git 依赖(tag v0.1.0);内部 pokered path 依赖与 `gfx`/`assets`/`ui_layouts` 相对深度不变。
- 新增 `crates/scene_apply` bin(迁移自引擎,`.dotzuki-editor.json` 的 `validateCmd` 继续指向 `target/debug/scene_apply`)。
- `fetch-gfx.sh` 目标路径改为 `examples/pokered/gfx`;`verify_scene_translations.py`/`reflow_scene_dialogue.py` 的 MAPS 路径去掉 `workspace/` 段。
- `pokered-editor`:`build:wasm`(dotzuki-web,引擎 crate)改为容错——目录不存在时跳过并提示,`JRPG_WASM_ROOT` 可注入引擎产物;`build:wasm-pokered` 不变。
- CI:`main.yml` 去掉引擎 job 与死 job、路径去 `workspace/` 前缀;`deploy-web.yml` 去掉 dotzuki-web 构建(布局预览 wasm 需从引擎仓产物注入,已注释说明)。
- `gfx/` 未入库(同源策略,`fetch-gfx.sh` 拉取);`pokered-runner-web/pkg`、截图产物等已 gitignore。

### wuxia / star-heir(`star-heir`,crate 已改名 `starheir-*`)
- `crates/` 从 `examples/wuxia/crates/` 平铺;`wuxia-data/build.rs` 的 `../../data` 相对深度不变;`game.rs` 的 CWD fallback `examples/wuxia/data/maps` → `data/maps`(WUXIA_MAPS_DIR 机制保留)。
- 3 个 crate 的 jrpg path 依赖 → git 依赖。
- 新增 `crates/scene-check` bin(迁移自引擎 scene_check),`.dotzuki-editor.json` 的 `checkCmd` 改为 `cargo run -q -p scene-check`。
- `data/` 全量入库(1129 文件,含中文文件名资源);`.dotzuki-editor.providers.json` 保持不入库(machine-local)。

## 验证

- 引擎:`cargo build --workspace` + `cargo test --workspace` 全绿(原 master 上 dotzuki-rules-macro doctest 失败已修)。
- pokered:`cargo build --workspace`(需 gfx 已拉取;git 依赖解析自本地引擎仓)。
- wuxia:`cargo build --workspace` + `cargo test --workspace`(含 battle-proto 46 个数值测试)。

## 待办(review 后)

- [x] 游戏仓 GitHub 命名与推送:pokered → `liuyanghejerry/open-pokered`,wuxia 改名 star-heir → `liuyanghejerry/star-heir`(2026-08-09 已推 master)。
- [x] 引擎仓建仓:无历史快照 → `liuyanghejerry/dotzuki`(**私有**),tag `v0.1.0` 已推;两个游戏仓的引擎依赖已切到 `ssh://git@github.com/liuyanghejerry/dotzuki.git`(tag 不变)并 `cargo update` 重锁。
- [ ] **CI 拉取私有引擎依赖**:dotzuki 为私有仓,游戏仓 GitHub Actions 需配置认证(deploy key 或 `CARGO_NET_GIT_FETCH_WITH_CLI` + token),否则 cargo 无法 fetch。
- [ ] 引擎仓 CI 在新 runner 上跑通(当前 main.yml 为精简版,需真实 GitHub 环境验证)。
- [x] pokered 布局预览 wasm 的产物分发——已由 `crates/pokered-layout-preview`(仓内 crate,editor 直接 `wasm-pack` 构建)解决,见 Follow-up 第 3 条。
- [ ] 两份调研文档(`docs/opensource-split-plan.md`、`research/wuxia-standalone` 分支的 `docs/dotzuki-engine-separation-plan.md`)如需要可归档到引擎仓。
- [ ] 旧 monorepo(`liuyanghejerry/pokered`)的去向:PR #162(引擎化分支)与 dotzuki 快照并存,需确认是合并 PR 保历史,还是弃用旧仓。

## Follow-up(review 后第一轮修正,2026-08-09)

1. **pokered 仓拍平**:`examples/pokered/crates/*` → `crates/*`,`examples/pokered/gfx` → 仓根 `gfx/`。`../../gfx` 的 manifest 相对深度不变,build.rs/resource.rs 零代码改动;`include_str!` 的 `assets/demo/demo.tmx` 深度 5→3;workspace members、CI 路径过滤、`.dotzuki-editor.json`、editor server/scripts 全部同步。
2. **引擎仓清理**:`.sisyphus/`、`.opencode/`、`.codegraph/` 移出 git(保留本地文件,已 gitignore)。
3. **pokered 专属预览代码回归 pokered 仓**:dotzuki-web 的 `render_layout`(160×144 固定画布 + 每菜单 mock 数据)+ `preview_elements`(`custom:hp_bar`)+ DSL 编译桥迁入 pokered 新 crate `crates/pokered-layout-preview`(git 依赖引擎,wasm-pack 出 `pkg/`);pokered-editor 的 `useWasmPreview.ts`/`pokeredRoutes.ts`/`package.json build:wasm` 同步指向新 crate。dotzuki-web 只保留通用的 `render_gui`(空 custom-element registry)+ DSL 编译桥 + 音频。
4. **引擎仓 `workspace/Cargo.toml` 增加 `exclude = ["dotzuki-template"]`**(模板 `{{project-name}}` 占位包名)。注意:cargo 对**无根 Cargo.toml 的 git 依赖仓**会递归扫描所有 manifest,该错误仍以非致命噪音形式打印(build/test/update 均成功);如需彻底消除,得给模板换合法包名 + cargo-generate placeholders 配置,或给引擎仓加根 Cargo.toml。
5. tag `v0.1.0` 前移至上述提交,两个游戏仓 `cargo update` 重锁(引擎 rev `ca37b896`)。

## 品牌更名:jrpg-* → dotzuki-*(2026-08-09,v0.2.0)

- 引擎仓 15 个 crate、`tools/dotzuki-editor`、`dotzuki-template` 及全部 `jrpg_*` Rust 标识符改名;tag `v0.2.0`(破坏性更名)。
- 文件契约同步更名:项目清单 `.jrpg-editor.json` → `.dotzuki-editor.json`(runner `MANIFEST_FILE`、CLI scaffold、editor、e2e/test fixture 同步),默认存档 `.jrpg-save.json` → `.dotzuki-save.json`。
- 保留未改:`jrpg` CLI bin 名、`JRPG_*` 环境变量、`jrpg::overworld` log target(无连字符前缀;改了会让消费方静默失效)。**后续(v0.3.0,2026-08-09):这三者也已更名** —— bin `jrpg` → `dotzuki`、`JRPG_*` → `DOTZUKI_*`、log target `jrpg::overworld` → `dotzuki::overworld`(消费方已同步适配)。
- 游戏仓适配:open-pokered `7518550`、star-heir `8067161`(依赖名/标识符/tag 升级 v0.2.0,清单文件改名)。
