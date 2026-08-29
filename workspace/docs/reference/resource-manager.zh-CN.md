# 资源管理器参考

> 本文是 `reference/resource-manager.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

`dotzuki-renderer` 的 PNG → tile 数据管线
（`crates/dotzuki-renderer/src/resource.rs`）：灰度 PNG 转 [2bpp](./glossary.md)
[tileset](./glossary.md) 数据、1bpp 字体、4bpp/RGBA 转换、经由
`AssetRoot` 的 `gfx/` 路径解析，以及带缓存的 `ResourceManager`。

## Feature 开关

该模块位于 `dotzuki-renderer` 的 `resource` feature 之后
（`resource = ["dep:image"]`；底层依赖 `image` 0.25 以
`default-features = false` 加 PNG 编解码构建）：

| Feature | 效果 | 默认 |
|---|---|---|
| `resource` | 编译 `dotzuki_renderer::resource` | 关闭 |
| `gpu` | 包含 `resource` | 开启（`default = ["gpu"]`） |

使用 `default-features = false` 且未列出 `resource` 的消费方——例如运行
器只启用 `image-assets`——会把这个模块整个编译掉。

## 错误

所有可失败的调用都返回基于 `ResourceError` 的 `resource::Result<T>`：

| 变体 | 原因 |
|---|---|
| `AssetRootNotFound(PathBuf)` | 构造或自动探测时找不到素材目录 |
| `PngNotFound(PathBuf)` | `resolve_checked` 未命中；在 wasm/移动端也表示没有对应的内嵌条目 |
| `ImageError` | PNG 解码失败（来自 `image::ImageError`） |
| `InvalidDimensions { width, height }` | 像素尺寸不是 8 的倍数 |
| `InvalidGrayscale { value, x, y }` | 为做严格校验的调用方声明；模块自带的转换器做吸附而不会抛出它 |
| `Io` | 文件系统错误（来自 `std::io::Error`） |

## 灰度约定

经典 GB PNG 只使用四个灰度级。`grayscale_to_color_index` 把每个像素吸附到
最近的档位：

| 灰度值 | 吸附区间 | 颜色索引 |
|---|---|---|
| 255（白） | 213–255 | 0（最浅） |
| 170 | 128–212 | 1 |
| 85 | 43–127 | 2 |
| 0（黑） | 0–42 | 3（最深） |

变体：`grayscale_to_color_index_strict` 只接受精确的锚点值
（255/170/85/0），其余返回 `None`；`bw_to_color_index` 面向 1bpp 素材，
≥128 映射为 0（白），<128 映射为 3（黑）；`grayscale_to_16_levels` 面向
4bpp，按 `(value * 16) / 256` 映射到 0–15，并以 15 封顶。

## 编码与转换器

每个转换器都按 8×8 tile 单元从左到右、从上到下读取图像；两个维度都必须
是 8 的倍数，否则报 `InvalidDimensions`。

- **2bpp**——`png_to_2bpp` 每个 tile 产出 16 字节：每行先 lo 字节后 hi
  字节，bit 7 是最左边的像素。`png_to_tileset_2bpp` 把字节包进
  `TileSet::from_2bpp`。
- **1bpp**——`png_to_1bpp` 每个 tile 产出 8 字节，每行一个字节；bit 1 =
  黑（颜色 3）。`png_to_tileset_1bpp` 包装它。用于字体。
- **4bpp**——`png_to_4bpp` 每个 tile 产出 32 字节，由两个顺序排列的
  2bpp 式位面组成：plane 0 = 低 2 位，plane 1 = 高 2 位（GBA 风格）。
  `png_to_tileset_4bpp` 包装它。
- **RGBA**——`png_to_rgba` 返回行主序的扁平 `Vec<Rgba>`，不做
  [调色板](./glossary.md)重映射；`png_to_tileset_rgba` 包装它。

自由函数加载单个文件且不缓存：`load_tileset_from_png`、
`load_tileset_from_png_1bpp`、`load_2bpp_from_png`、`load_1bpp_from_png`。

```rust
use dotzuki_renderer::resource::png_to_2bpp;

// 8×8, first row alternates white/black → color indices [0, 3, 0, 3, ...]
let mut img = image::GrayImage::from_pixel(8, 8, image::Luma([255]));
for col in (1..8).step_by(2) {
    img.put_pixel(col, 0, image::Luma([0]));
}
let data = png_to_2bpp(&image::DynamicImage::ImageLuma8(img)).unwrap();
assert_eq!(data.len(), 16); // one tile
assert_eq!((data[0], data[1]), (0x55, 0x55)); // row 0: lo byte, hi byte
```

*Verified by `png_to_2bpp_alternating_colors` in
`crates/dotzuki-renderer/src/resource.rs`.*

## AssetKind——游戏自有的类别

```rust
pub trait AssetKind: Copy + Eq + std::hash::Hash {
    fn subdir(self) -> &'static str;
    fn is_1bpp(self) -> bool { false }
}
```

*Verified by `resource_manager_category_default_encoding` in
`crates/dotzuki-renderer/src/resource.rs`.*

游戏为自己的类别枚举实现 `AssetKind`，因此目录布局归游戏所有。字体类类
别重写 `is_1bpp`，让默认解码走 1bpp。

## AssetRoot——路径解析

`AssetRoot` 指向素材目录（惯例为 `gfx/`）：

- `AssetRoot::new(gfx_dir)`——路径不是目录时报 `AssetRootNotFound`。
- `AssetRoot::from_parent(parent)`——拼接 `parent` 下的 `gfx/`。
- `AssetRoot::new_wasm()`——跳过文件系统校验（占位 `gfx`）；在 wasm32
  上加载走内嵌加载器，从不访问该路径。
- `AssetRoot::auto_detect()`——解析顺序：
  1. 指向 `gfx/` 目录的 `DOTZUKI_GFX_DIR` 环境变量（无效时告警并继续往
     下探测），
  2. `<cwd>/gfx`，
  3. cwd 各级父目录中的 `gfx/`，最多向上走 5 层，
  4. `<exe-dir>/gfx`，
  全部失败时报 `AssetRootNotFound`。

查询：`gfx_dir()`；`resolve(category, filename)` 拼出
`gfx/<subdir>/<filename>`；`resolve_checked` 在文件缺失时再报
`PngNotFound`；`list_pngs(category)` 返回该类别下排序后的 PNG 文件（子目
录不存在时返回空列表）。

## ResourceManager——加载与缓存

`ResourceManager<K: AssetKind>` 按需加载，并用一个
`HashMap<(K, String), CachedTileSet>` 缓存。没有淘汰策略——假定游戏的素
材总量有界。`CachedTileSet` 携带 `tileset`、`source_size` 与
`tile_count`（均为 pub 字段）。

| 方法 | 行为 |
|---|---|
| `new(root)`、`root()` | 构造与访问器 |
| `load_asset(category, filename)` | 按类别默认编码；文件名原样使用 |
| `load_asset_2bpp`、`load_asset_1bpp` | 强制编码，分别以 `:2bpp` / `:1bpp` 后缀键缓存 |
| `load_tileset_4bpp(category, name)` | 4bpp，以 `:4bpp` 键缓存；返回 `Result<&TileSet, String>` |
| `load_tileset_rgba_tileset(category, name)` | RGBA `TileSet`，以 `:rgba` 键缓存；走内嵌接缝 |
| `load_tileset_rgba(category, name)` | `RgbaTileSet`；不缓存，裸 `std::fs`，无内嵌路径 |
| `load(category, name)` | 缺少 `.png` 时自动补上，再走 `load_asset` |
| `is_cached`、`cache_size`、`evict`、`clear_cache` | 缓存检视与控制 |
| `preload_category(category)` | 批量加载；单文件错误被忽略，返回成功数量 |
| `set_embedded_loader(loader)` | 注册[内嵌素材加载器](./glossary.md) |

`load`、`load_tileset_4bpp`、`load_tileset_rgba_tileset` 与
`load_tileset_rgba` 会自动补 `.png`；`load_asset*` 一族原样使用文件名——
向 `load_asset` 传 `"a"` 找的是名为 `a` 的文件，并且错过 `"a.png"` 的缓
存条目。

`LoadedPng` 是解码后的中间形态：`load(path)` 从磁盘加载，
`load_from_bytes(&[u8])` 用于内嵌字节，之后可 `to_2bpp()`、`to_1bpp()`、
`to_tileset(is_1bpp)`、`tiles_x()`、`tiles_y()`。

### 内嵌素材接缝

在 wasm32、Android、iOS 上，底层加载器把 `"{subdir}/{filename}"` 解析到
已注册的 `EmbeddedAssetLoader`——一个把素材根相对路径映射到内嵌 PNG 字
节的 `fn(&str) -> Option<&'static [u8]>`——并经由
`LoadedPng::load_from_bytes` 解码；在原生平台则直接从磁盘读取。这些目标
上若没有注册加载器，每次加载都会报 `PngNotFound`；而 `LoadedPng::load`
在 wasm32 上总是失败（没有文件系统）。该[接缝](./glossary.md)在原生平台
上是惰性不生效的。

### 示例

```rust
use dotzuki_renderer::resource::{AssetKind, AssetRoot, ResourceManager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum TestKind { Tiles, Font }

impl AssetKind for TestKind {
    fn subdir(self) -> &'static str {
        match self { Self::Tiles => "tiles", Self::Font => "font" }
    }
    fn is_1bpp(self) -> bool { matches!(self, Self::Font) }
}

let root = AssetRoot::new("gfx")?; // gfx/tiles/a.png, gfx/font/f.png, ...
let mut mgr = ResourceManager::<TestKind>::new(root);

// Category default encoding; the filename is taken verbatim.
let tiles = mgr.load_asset(TestKind::Tiles, "a.png")?;
println!("{} tiles (source {:?})", tiles.tile_count, tiles.source_size);

// `load` appends .png itself; Font overrides is_1bpp → decoded as 1bpp.
let _font = mgr.load(TestKind::Font, "f")?;
assert!(mgr.is_cached(TestKind::Font, "f.png"));

assert!(mgr.evict(TestKind::Tiles, "a.png"));
mgr.clear_cache();
assert_eq!(mgr.cache_size(), 0);
```

*Verified by `resource_manager_caches_by_category_and_filename` and
`resource_manager_category_default_encoding` in
`crates/dotzuki-renderer/src/resource.rs`.*

## 注意事项

- 文件名处理因入口而异：`load_asset*` 原样使用；`load` 与
  `load_tileset_*` 一族自动补 `.png`。
- `load_tileset_rgba` 绕过缓存与内嵌接缝——用裸 `std::fs` 读取，只能在
  原生平台上工作。
- 在 wasm32 上，用 `set_embedded_loader` 注册加载器，并用
  `AssetRoot::new_wasm()` 构造根目录，否则每次加载都会失败。
- 引擎仓库内没有该模块的消费方：它是面向游戏的 API。
