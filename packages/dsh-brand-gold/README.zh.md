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
| 反射几何 | `GoldBrandMark.tsx` / `GoldBrandName.tsx` | 基础渐变方向、反向补光、柔光条位置与宽度、悬停高光条、倒角亮边、暗部梯度 |

层序依次是：基础、反向补光、接触阴影、柔光反射、悬停反射、倒角亮边。其中两处比
色值更关键：

- 接触阴影画在反射**之前**。画到之后会把高光压在暗面底下——第一版看起来发闷就是
  这个原因。
- 反射核心用满不透明。`0.92` 再乘上纵向渐隐遮罩，实际覆盖只有约 `0.56`，看起来
  是一片灰白而不是反射；现在核心固定为 `1`，遮罩在受光的那半边不低于 `0.94`。

悬停时反射条会扫过金属，并交叉淡入同几何的第二条纯白高光条，因此是「高光上限抬
升」，不是把已有的高光再显示一遍。`prefers-reduced-motion` 保留更亮的那条，去掉
位移。

## 已验证与未验证

已在运行中的桌面客户端按原生 24px 高度验证（宽侧栏），以及窄侧栏与折叠态；
并用无头 Chrome 以 1x 与 4x 渲染同一份组件输出，深色与浅色主题各一枚。

未交付：真正的 HDR 输出。这条路做过、量过、被否掉了，测量本身就是退回 SDR 的理由：

| 路径 | 参考机上的实测结果 |
|---|---|
| 面板余量 | 内置 XDR 屏，`maximumPotentialExtendedDynamicRangeColorComponentValue` 为 16，当前余量约 6.3，渲染进程里 `(dynamic-range: high)` 命中 |
| CSS `color(srgb 4 4 4)` / `color(rec2100-pq …)`，带与不带 `dynamic-range-limit: no-limit` | 帧缓冲里从不超过 1.0，合成器直接钳住 |
| 不透明 WebGPU 画布，`rgba16float` + `toneMapping: 'extended'` | 直接挂在 `document.body` 下读回 4.0；同一块画布放进侧栏子树里只有 0.98，被钳成 SDR |
| 同一画布在 CSS 里遮罩、裁切，或只在 body 上做混合 | 遮罩与 `clip-path` 都会钳回 1.0；只有 body 层加 `mix-blend-mode: plus-lighter` 能保住超 1.0 的值 |

也就是说：这个渲染进程能输出超 1.0 的像素，但在 Logo 所在的这棵子树里不行——侧栏
子树会把它钳住。改用 body 级浮层试过，代价是丢掉品牌形状的裁切、或者丢掉与侧栏自身
堆叠上下文的合成关系；而只在 Logo 不该出现的区域发亮的图层，不算 HDR Logo。交付
SDR 材质——清晰、有层次、在任何屏上都正确——是这里诚实的结论。

若将来宿主的侧栏子树能保住扩展范围，接回点只是 SVG 之上再叠一层反射；几何与调色板
都不用动。

## 许可

Apache-2.0
