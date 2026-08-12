# dotzuki-editor「新建项目」流畅度分析

> 分析日期：2026-07-18。基于代码走查 + 逻辑实测，未运行动态端到端流程。

## 结论

**新人上手目前非常困难**：GUI 主路径（创建向导）因模板 id/name 不匹配必然 400 失败，功能名存实亡；唯一可行路径是手动抄 `example-wuxia.dotzuki-editor.json` 并理解 activities schema，门槛高且文档不成体系。即便修好 bug，「写进 cwd 不可选位置」和「创建后无引导」仍会让新人困惑。

## 现状流程（代码走查结果）

入口：`src/App.vue:33` —— 仅当 `GET /api/project` 失败（即当前目录没有 `.dotzuki-editor.json`）时才显示 `WelcomeScreen`。

1. **WelcomeScreen**（`src/components/WelcomeScreen.vue`）：两张卡片 —— Create New Game（打开向导）/ Open Project（手输路径文本框，浏览器里无浏览按钮）+ 最近项目列表（localStorage）。
2. **CreateGameWizard**（`src/components/CreateGameWizard.vue`）：3 步 —— ① 起名 ② 选模板（拉 `/api/project/templates`，3 个模板）③ Review → `POST /api/project/create`。
3. **服务端**（`server/api/routes/project.ts:153`）：在 `getProjectRoot()`（= `DOTZUKI_PROJECT_ROOT || process.cwd()`，`server/api/projectConfig.ts:5`）**原地铺开**：`.dotzuki-editor.json`、`Cargo.toml`、`src/main.rs`（拷自 `workspace/dotzuki-template`）、`assets/`、`data/`、`gfx/`。

## 问题清单（按严重度）

### 🔴 P0 — 向导创建 100% 失败（硬阻断 bug）

- 客户端发送的是模板 **name**：`CreateGameWizard.vue:99` `selectedTemplate = tpl.name` → `:329` payload `template: selectedTemplate.value`（值为 `"Empty Project"` 等）。
- 服务端按 **id** 匹配：`project.ts:215` `templates.find(t => t.id === template)`（id 为 `empty` / `wuxia` / `dotzuki`）。
- 已用 node 实测验证：三个模板全部 NO MATCH → 400 `Unknown template: Empty Project`。模板拉取失败时的 fallback 同样用 name，也失败。
- **新人走主路径必然卡死在最后一步。**

### 🔴 P0 — 创建位置不可选，且会污染编辑器自身目录

- 向导没有「项目位置 / 目录名」字段，服务端直接写进 cwd。
- README 让新人 `npm run dev`（从 `tools/dotzuki-editor/` 启动）→ cwd = 编辑器目录 → 若 bug 修复，`Cargo.toml`、`src/main.rs`（混进编辑器自己的 Vue `src/`）、`assets/`、`data/`、`gfx/`、`.dotzuki-editor.json` 会全部写进**编辑器仓库内部**；且此后编辑器启动永远加载这个残留项目。
- Electron 打包版更糟：`process.cwd()` 不可控（macOS 双击启动通常是 `/`），File 菜单只有 Open Project…（`electron/main.cjs:126`），没有「New Project…」原生流程。

### 🟠 P1 — Open Project 路径对新人不友好

- 浏览器端只能手输绝对路径，无目录选择器、无即时校验；选错时错误为英文后端原文（`No .dotzuki-editor.json found in ...`）。
- Electron 的 Open 要求目录里已存在 `.dotzuki-editor.json`（否则 404 弹窗），**无法选一个空文件夹初始化** —— 与「新建」之间没有桥。

### 🟠 P1 — 创建成功后的「下一步」引导缺失

- 成功后直接跳进 Maps 活动：空项目没有地图、没有 tileset；向导生成的配置不含 `tiles` 活动，但 README 说明 Backdrop / Trace to map 都依赖它。
- Empty 模板下 Data 活动 `tables: []`，新人面对空壳不知道能干嘛。
- 模板 script 活动配置是 `extension: '.js'`（`project.ts:175,196`），而仓库早已迁移到 `.scene` DSL（`.scene` 是 source of truth）—— 新脚手架上手即过时。
- 模板只含 maps/scripts/data/assets 四个活动；Story、UI、Audio、Title 等编辑器主打能力新人无从知晓。

### 🟡 P2 — 文案与文档瑕疵

- `src/locales/en.ts:172` 有 `wizard.summaryScaffold`（"Cargo.toml + src/main.rs — ready to compile"）但向导模板没渲染这条 bullet（`CreateGameWizard.vue:162-170` 只有 3 条）。
- 服务端模板的 name/description 硬编码英文，zh 界面下模板卡仍是英文（fallback 才走 i18n）。
- Welcome 页 `manualHint`「Or create a .dotzuki-editor.json file manually」无链接、无示例指引。
- `docs/` 只有 AI_AGENT_FRAMEWORK.md；README Quick Start 只覆盖手动配置路线，向导路线无文档。

## 改进建议（两档）

### 最小修复 —— 打通向导（约 10 行）

1. `CreateGameWizard.vue`：`selectedTemplate` 存 `tpl.id`（显示仍用 name），fallback 模板补 `id` 字段。
2. 顺手修 `summaryScaffold` bullet 渲染缺失。
3. 验证：起 dev server 对 `/api/project/create` 发一次真实 POST（用临时 `DOTZUKI_PROJECT_ROOT`，验证后清理）。

### 系统性改善（最小修复 + 以下）

1. 向导增加「创建位置」步骤：目录名输入（默认 slug 化的游戏名），服务端在 projectRoot 下建子目录而非原地铺开；拒绝覆盖非空目录。
2. 模板配置更新：script `extension` 改为 `.scene`；补上 `tiles` 活动；服务端模板 name/description 走 i18n。
3. Electron：File 菜单加「New Project…」（原生选目录 → 走 create API → reload）；Open Project 允许选空目录并提供「在此初始化」。
4. 创建成功后显示「下一步」引导卡（创建第一张地图 / 添加数据表 / 打开 Story）。
5. README 补向导路线的 Quick Start。

## 处置结果（2026-07-18）

- **P0 模板 id/name → 已修**：客户端改为按模板 `id` 提交（显示仍用 name）；服务端 `server/scaffold.ts` 的 `scaffoldProject` 在 projectRoot 下**子目录化**创建（不再原地铺开），目标目录非空返回 **409**。
- **P0 创建位置 → 已修**：向导第 1 步新增**目录名输入**（默认 slug 化游戏名）+ 完整路径预览（新增 `GET /api/project/root` 供预览）；Electron 增加原生「浏览…」目录选择，File 菜单加入 **New Project…**。
- **P1 Open Project → 部分改善**：错误提示加本地化前缀；Electron 端 Open 选到非工程目录时**询问是否初始化**。浏览器端仍只能手输路径（无目录选择器）——受平台限制未解决。
- **P1 创建后引导 → 已修**：向导成功后提供「进入编辑器 / 让 AI 帮我搭」下一步面板；Maps 空态新增引导卡；脚手架活动配置更新为 `extension: '.scene'` 并补齐 `tiles` 活动（maps/scripts/data/assets/tiles 五活动）。
- **P2 文案 → 已修**：`summaryScaffold` 残留移除（新工程不再生成 Cargo.toml + src/main.rs）；模板 name/description 支持 `?lang=zh` 本地化；README Quick Start 补向导路线（三条路径）。

另注两项超出原建议范围的方向性改动：

- **AI 创设路径**：助手新增三个 PROPOSE 工具 —— `draft_project_scaffold`（无工程也可用，产结构化方案卡，Apply 即建工程并自动续聊引导）、`propose_project_config`（改 `.dotzuki-editor.json`）、`propose_map_create`（建完整地图）；无工程时欢迎屏第三张卡内嵌聊天，provider profile 兜底存 `~/.dotzuki-editor/providers.json`（API key 仍只在浏览器 localStorage）。
- **零 Rust 工程方向**：新工程不再生成 Cargo.toml/src/main.rs，布局规范化为 `workspace/docs/game-project-spec.md`；新增 `workspace/crates/dotzuki-cli`（`dotzuki new` scaffold / `dotzuki check` 编译检查，经 `dotzuki-engine-dsl` 新增的运行时编译 API `compiler::compile_dirs`），引擎朝二进制壳（dotzuki CLI）方向发行。

## 第二轮:新手体验深化(2026-07-25)

第一轮修通了「能创建」,第二轮针对「创建后面对的是空壳」:

- **脚手架空壳 → 已修**:所有模板现在都带示例内容 —— StartTown 示范地图(程序生成的 16 图块 starter tileset,`tileset.png` 放地图目录,地图编辑器直接可渲染;同时种子共享图块库 `data/tiles/`)、碰撞层、per-map `script.scene`。
- **starter scene 不可见 → 已修(替代路径)**:示范地图的 `script.scene` 位于 `data/maps/`,Scripts 面板开箱即有内容;`main.scene` 仍在 `assets/scenes/`(spec 的 game.scenesDir),其注释不再指向编辑器不可见的路径。遗留:编辑器仍无展示 `assets/scenes/` 的面板(script 活动只认第一个 script 活动的单一 scriptsDir)——未来可考虑 script 路由合并多目录。
- **Story 等主打活动不可发现 → 已修**:脚手架清单加入 `story` 活动(全模板),dotzuki/wuxia 模板种子一个角色 + 一个任务(双语);`dotzuki new`(dotzuki-cli)同步补齐 story 活动与 stories 目录,保持 spec 往返一致。
- **浏览器端项目建进编辑器仓库 → 已修**:cwd 是编辑器仓库自身(按 package.json name 检测)且无 `DOTZUKI_PROJECT_ROOT` 时,默认项目根改为 `~/dotzuki-projects`;cwd 含 `.dotzuki-editor.json` 或其他目录时行为不变。
- **创建后引导 → 增强**:向导成功面板列出种子内容分组(地图/记录/场景/故事/图块)+ 本地化「第一步」提示;新增教程 `docs/first-game.md`(15 分钟上手);README Quick Start 修正漂移并链接教程。
- **验证**:473 单元测试全绿(新增 scaffold/starter-content/projectConfig 用例);三个模板脚手架产物均通过真实 `dotzuki check`(exit 0);`vue-tsc -b` 干净。

仍未解决(下一轮候选):**`dotzuki run` 不存在** —— 游戏无法从编辑器运行/试玩(spec 标注 future,需要通用 GameData provider + runner,工程量大);Scripts 面板不能浏览 `assets/scenes/`;场景编辑只有 lint 没有真实编译诊断(dotzuki-web WASM 的 `compile_scene` 可接入 ScriptActivity);浏览器端 Open Project 仍只能手输路径。
