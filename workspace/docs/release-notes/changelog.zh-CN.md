# 变更日志

> 本文是 `release-notes/changelog.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

引擎版本历史。版本号跟随 workspace 版本（`workspace/Cargo.toml`，所有
`dotzuki-*` crate 共享）；每个 release 都附带一份 `migration/` 目录下的迁移指
南（每个 release 各建一份）。

## 格式

- 每个版本先列出 **breaking changes**（附其迁移指南的链接），然后是值得注意
  的新增与修复。
- 文档正文不提及 "since vX.Y"——本页是版本历史的唯一所在（doc-standard §10）。

## 未发布

## v0.1.0

引擎 workspace 的初始发布版本：核心引擎、战斗效果栈、`dotzuki-rules`、DSL
编译器、运行器、CLI、渲染器、UI、音频、app/tui/web shell，以及
dotzuki-editor 工具链。（若这条记录以占位形式发布，请从首次 release 之前的
git 历史回填。）
