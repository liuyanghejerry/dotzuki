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

首个发布版本（crates.io）。引擎 workspace 的版本线从 v0.5.x 预发布 tag
（`v0.5.0`、`v0.5.1`）重置为 `0.1.0`；每个 `dotzuki-*` crate 以 0.1.0 发布，
并落地 tag 驱动的发布管线：`workspace/scripts/publish-crates.sh`、发布工作流与
package-check PR 门禁。tag `v0.1.0` 的代码只比 `v0.5.1` 多一个提交——这次跳跃
没有 API 变更。预发布时代的消费者按[迁移指南](migration/v0.1.0.md)把 git tag 从
`v0.5.x` 换成 `v0.1.0`（或改成 registry 形式）。
