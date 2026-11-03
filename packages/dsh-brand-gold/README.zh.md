# dsh-brand-gold · DeepSeek Harness 的抛光黄金品牌字标

[English](README.md) | 中文

<p align="center">
  <strong>侧栏品牌组合的黄金版本：鲸鱼图标、deepseek 字标与 HARNESS 铭牌</strong><br>
  <em>原始矢量 · 分层金属材质 · SDR 安全高光 · 默认静态</em>
</p>

纯浏览器半区的 DSH Web GUI 插件：把外壳声明的两个侧栏品牌槽位
（`sidebar.brand.mark` 与 `sidebar.brand.name`）填成原始 DeepSeek Harness
矢量的抛光黄金版本。不改任何 DSH 源码，host 半区无行为。

## 是什么

- 鲸鱼轮廓、全部镂空、字标字形与圆角 HARNESS 铭牌都直接取自外壳自带的矢量数据，
  原样落在 `src/client/paths.ts`；不重画、不从截图裁剪、不替换字体。
- 几何与官方版本完全一致：同样的 viewBox（`0 0 23.16 17.04` 与
  `26 0 156 24`）、同样的 24px 高度、同样的 `宽度 = 高度 × 宽高比`，
  侧栏那一行不会回流。
- 材质分层都裁剪在图形内部：暖金基础渐变（主光在左上、右下留深金棕暗部）、
  一道贯穿整个组合的窄条柔光箱高光、一圈极细的倒角亮边，以及很轻的接触阴影。
- HARNESS 铭牌保留圆角矩形与深色字：文字压在牌面之上，绝不会被填成同一种金色。
- 两个席位都以优先级 `-1` 注册，比官方品牌包低一档——槽位注册表渲染优先级最低的
  那一份，因此黄金版本覆盖显示，而原有注册仍在册；停用本插件即刻交还，无需刷新。
- 跟随主题：深色底用一套黄金调色板；外壳切到浅色主题
  （`body:not([data-ds-dark-theme])`）时整体下沉一档，白底上仍读作金属而不是发白。
- 遵守 `prefers-reduced-motion`；唯一的动效是可选的高光悬停微亮，不改变尺寸与布局。

## 安装

### 本地检出

```sh
cd packages/dsh-brand-gold && ../../node_modules/.bin/tsdown
```

然后把包装进桌面 profile 并加入插件行（`~/.dsh/profiles/desktop/package.json`
的 bundles 与 profile 的 `cordis.patch.yml`）。本包自带的插件行：

```yaml
- insert:
    - id: ui-brand-gold
      name: '@linxin666/dsh-client-ui-brand-gold'
```

### 从 npm 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-brand-gold@latest
```

## 材质旋钮

一共两处，都刻意做得很少：

| 层 | 位置 | 控制什么 |
|---|---|---|
| 调色板 | `src/client/brand-gold.module.css` | `--bg-gold-0…7`（鲸鱼与字标）、`--bg-gold-plate-0…5`（铭牌）、`--bg-gold-ink`（牌面文字），以及浅色主题覆盖 |
| 反射几何 | `GoldBrandMark.tsx` / `GoldBrandName.tsx` | 基础渐变方向、柔光条位置与宽度、倒角亮边、暗部梯度 |

想把高光调亮，是改窄高光渐变里的某一档，而不是再叠一层：反射结构固定为三层，
24px 下才不会变成斑马纹。

## 已验证与未验证

已在运行中的桌面客户端按原生 24px 高度验证（宽侧栏），以及窄侧栏与折叠态；
并用无头 Chrome 以 1x 与 4x 渲染同一份组件输出，深色与浅色主题各一枚。

未宣称：真正的 HDR 输出。高光只是 SVG 里的普通 SDR 色标，按普通显示器调到像金属；
不涉及 HDR 色彩空间、没有 Display P3 声明、也没有 brightness 滤镜，HDR 面板上浏览器
色彩映射的仍是同一批 SDR 值。

## 许可

Apache-2.0
