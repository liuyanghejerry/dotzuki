# 等级成长

> 本文是 `reference/data-tables/levels.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

`battle.levels` 块：属性成长、EXP 奖励、升级曲线与逐成员持久化。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`levels`（可选）开启 **EXP 与等级成长**（每个键都可选，以下为默认值）：

```json
"levels":   { "expField": "exp", "levelField": "level",
              "curve": { "base": 8, "exponent": 3 }, "growth": 0.05, "maxLevel": 100 }
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `expField` | string | `"exp"` | 记录中存放被击败敌人所付 EXP 的字段（记录缺少它时按 0）。 |
| `levelField` | string | `"level"` | 记录中存放等级的字段（缺失 ⇒ 1 ⇒ ×1）。 |
| `curve.base` | number | `8` | `exp_to_next(L) = curve.base × L^curve.exponent`（整数）中的基数。 |
| `curve.exponent` | number | `3` | 升级所需经验曲线中的指数。 |
| `growth` | number | `0.05` | 属性成长倍率：`floor(raw × (1 + growth × (level − 1)))`。 |
| `maxLevel` | number | `100` | 等级上限。 |

缺失 ⇒ 维持当前的确切行为：不获得 EXP、属性永不成长，记录的 `level` 字段只供
给 RON 等级 op。存在该块时：

- **属性成长**——每一项生效属性（双方皆然，凡是读取原始记录属性的地方：战斗
  构建、RON 镜像、菜单的 Party 视图）都是
  `floor(raw × (1 + growth × (level − 1)))`，其中 `level` 来自记录的
  `levelField`（默认 `"level"`；缺失 ⇒ 1 ⇒ ×1，在数值上与无 levels 的项目完
  全相同）。一条 5 级的敌人记录确实更强。
- **EXP 奖励**——获胜时，每名**未濒死**的队伍成员获得所有被击败敌人
  `expField` 数值的总和（记录缺少它时按 0），每场战斗一次，在胜利文本之后以
  叙述呈现（`"Aria gained 8 EXP!"`）。单敌人战斗的总和就是那个敌人的数值，与
  v1 相同。
- **升级**——每名成员都记录朝下一级累积的 `exp` 进度；
  `exp_to_next(L) = curve.base × L^curve.exponent`（整数）。当
  `exp >= exp_to_next(level)` 且 `level < maxLevel` 时：升级，
  `exp -= exp_to_next(level)`（支持一次奖励连升多级），以叙述呈现（`"Aria
  grew to level 2!"`）。升级会按成长倍率重算成员的属性，并把最大 HP/MP 的
  **差值**补入当前池（最大 HP 60 → 63 时，2 级会把当前 HP 提高 3；MP 同理）。
- **持久化**——逐成员的 `level` + `exp` 搭载在运行器的队伍状态和存档上
  （`party[].level` / `party[].exp` 是 OPTIONAL 字段；缺失 ⇒ 等级 1 / 0
  EXP，因此存档版本保持为 3，旧存档仍能加载）。菜单的 Party 视图会显示 `Lv`
  和一行 `EXP <progress>/<need>`（仅在有该块时）。

`levels` 是项目清单中的一个配置块，而不是数据表：它读取的记录是队伍表与敌人
表中的 combatant 和敌人记录。战斗侧的行为见[战斗规则](../battle-rules.md)；存
档版本化见[存档兼容性](../../explanation/save-compatibility.md)。
