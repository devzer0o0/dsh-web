# dsh-brand-gold · DeepSeek Harness 品牌组合的抛光黄金材质

[English](README.md) | 中文

<p align="center">
  <strong>侧栏品牌组合的黄金版本，带周期性金属扫光</strong><br>
  <em>原始矢量 · 单一时轴的光束 · 局部放大与浮起 · 宿主保留扩展亮度时启用真实 HDR 高光</em>
</p>

纯浏览器半区的 DSH Web GUI 插件：它填充 shell 声明的两个侧栏品牌槽位
（`sidebar.brand.mark` 与 `sidebar.brand.name`），用原始 DeepSeek Harness 品牌
矢量绘制抛光黄金版本，并每 5 秒让一道斜向光束扫过整个品牌组合。

## 它是什么

- 鲸鱼轮廓、每处镂空、字标字形与圆角 HARNESS 铭牌全部来自 shell 自身的矢量数据，
  逐字复制进 `src/client/paths.ts`。没有重绘、没有从截图裁剪、没有换字体。
- 几何与官方占位完全一致：相同 viewBox（`0 0 23.16 17.04` 与 `26 0 156 24`）、
  相同 24px 高度、相同 `width = height * aspect` 规则，侧栏行永不回流。
- SVG 既是材质也是回退。它不会被隐藏、替换，也不会从隐藏状态重新序列化，因此动画层
  任何失败都只会留下静态金色组合。
- 两个占位以 priority `-1` 注册，比官方品牌包低一档，槽位注册表渲染金色版本而原有
  注册依然在场。禁用本插件即刻交还槽位，无需刷新。
- 主题自适应：默认深色面板调色板，浅色主题（`body:not([data-ds-dark-theme])`）切换为
  加深一档的调色板；主题变化会让扫光重新读取材质，而不是拿旧纹理再画一次。

## 扫光

一道光束、一条时轴、一块画布，两个占位共享。

| 参数 | 取值 | 位置 |
|---|---|---|
| 周期（本轮开始到下一轮开始） | 5000 ms | `SWEEP_PARAMS.periodMs` |
| 单次可见扫光 | 1200 ms | `SWEEP_PARAMS.sweepMs` |
| 周期内静止 | 3800 ms | `periodMs - sweepMs` |
| 就绪后首次扫光 | 5000 ms | `SWEEP_PARAMS.firstDelayMs` |
| 方向 | 仅从左向右 | `overlay.ts`（`startX` 到 `endX`） |
| 相对竖直倾斜 | 25 度 | `SWEEP_PARAMS.tiltDeg` |
| 影响区宽度 | 每侧约组合宽度的 5% | `SWEEP_PARAMS.influenceSigmaRatio` |
| 高光核心 | 约 1-2 CSS px | `SWEEP_PARAMS.coreSigmaPx` |
| 局部放大峰值 | 1.08 倍 | `SWEEP_PARAMS.magnifyPeak` |
| 局部浮起峰值 | 0.8 CSS px | `SWEEP_PARAMS.liftPx` |
| 铭牌响应 | 金属的 55% | `SWEEP_PARAMS.plateFactor` |

参数集中在 `src/client/sweep.ts`，几何在 `beam.ts`（纯算术，有单测），着色器与之逐一对应。

各部分如何协作：

1. `layout.ts` 从两个占位**实际渲染**的盒子出发，把各自 viewBox 映射进同一套画布坐标。
   两个 viewBox 从不被当成同一个空间，光束会连续穿过图标与字标之间的空隙，而不是在字标
   起点重新开始。
2. `material.ts` 在每次布局或主题变化时合成一次实时材质：每个 SVG 内联计算后的绘制属性、
   按各自变换画入同一画布，作为 `rgba8unorm-srgb` 纹理上传，sRGB 解码交给硬件。
3. `renderer.ts` 通过**逆向形变**采样该纹理。放大、浮起、高光与明暗全部来自同一个光束权重，
   材质、轮廓与边缘透明度由同一个函数形变。没有第二份轮廓、没有固定轮廓遮罩，因此不会出现
   采样空洞、新旧轮廓双影或被裁掉的笔画。
4. 画布在光束之外完全透明。静止时屏幕上只有下方那张 SVG，因此不存在两份轮廓叠加，扫光结束
   后形状、大小、位置与颜色精确恢复。
5. 逐帧绘制只发生在 1200 ms 窗口内。周期其余时间只保留一个定时器；页面或 Logo 不可见时错过
   的那一轮直接跳过、不补播，也不会出现重叠循环。

`prefers-reduced-motion: reduce` 下完全不注册：没有位移、没有放大、没有周期性强闪，
只保留静态精细金色。

## 颜色管线

三个空间严格分开，每一步都注明自己在哪一层：

| 步骤 | 空间 | 位置 |
|---|---|---|
| CSS 绘制属性与 SVG 光栅 | sRGB 编码 | `raster.ts`、`material.ts` |
| 纹理解码 | 由 `rgba8unorm-srgb` 在硬件完成 | `renderer.ts` |
| 光照、放大、高光 | 线性光 | `renderer.ts` 中的着色器 |
| 输出 | 扩展 sRGB 编码 | 着色器 `encode()`、`color.ts` 的 `linearToSrgb()` |
| 透明度 | 直通，最终写出时预乘 | 着色器 |

编码在 1.0 以上线性延续，扩展值能进入帧缓冲而不是被传递函数夹断。`HDR_PEAK` 是高光项的
线性倍数，从不被当作 nits 或物理亮度声明。

## 扩展亮度：实测了什么、没实测什么

这里必须分开写，因为此前的版本把两者混为一谈。

**已在运行中的桌面客户端验证**（Electron 44.7 / Chromium 152.0.7977.130、macOS 27.2、
内置 Liquid Retina XDR）：

- 扫光运行：60 fps 录屏中连续三个周期，起点间隔 5000 ms，每轮可见窗口约 1.0 s。
- 光束依次经过鲸鱼、字标、HARNESS 铭牌；铭牌约以一半幅度受光，铭牌文字始终深色清晰。
- 静止状态完整恢复：一轮前后两帧的差异最多为若干抗锯齿采样，单通道不超过 15/255。
- 静止期没有逐帧绘制：着色器只在窗口内提交。
- 没有任何矩形覆盖：未受光像素透明，镂空、鲸鱼切口、背景与品牌间距保持暗色。

**已实现，且只在着色器层面验证**：

- 画布为 `rgba16float`，配置 `toneMapping: { mode: 'extended' }` 与显式 `colorSpace: 'srgb'`。
  每轮会有一帧被重绘到离屏 `rgba16float` 目标，并复制回映射缓冲区；读回峰值线性值大于 1.0，
  证明扩展编码在着色器自身输出中确实产生了扩展值。
- 画布状态与显示状态分开上报：提交帧时为 `drawing`，读回大于 1.02 才为 `verified`。

**未验证：额外亮度是否真的到达面板。**

- 在参考宿主上，显示器当前扩展亮度余量约为 1.2 倍，而内置 XDR 面板标称潜力为 16 倍。
  本进程可用的每条 ScreenCaptureKit 路径（截图与串流、sRGB/bgra10/半浮点像素格式、
  `captureDynamicRange` 各档位）读回都被夹在 1.0，包括全屏白色参考。缺少能保留 1.0 以上
  数值的采集路径，显示端结论在此无法测量，因此不作声明。
- 超出 1.0 的输出在着色器与存储格式中是真实的；合成器与面板是否呈现它，取决于系统当时
  给出的余量，本插件既不能控制也无法读取。

因此高光首先被调成金属反射：在 SDR 表面上同一着色器把扩展项置零并施加柔和肩部，
受光金属变亮但不会夹成白块。

## 验证

```sh
cd packages/dsh-brand-gold
pnpm test        # 31 个单测：时序、光束几何、颜色、坐标系、生命周期
../../node_modules/.bin/tsdown
```

单测覆盖的是最容易悄悄坏掉的特性：周期是开始到开始、形变可逆（无采样空洞、无重影）、
扩展编码保留 1.0 以上数值、组合塌缩时布局拒绝构建、dispose 只释放自己的监听且重复调用安全。

## 安装

### 本地检出

```sh
cd packages/dsh-brand-gold && ../../node_modules/.bin/tsdown
```

然后把包链接进 desktop profile 并加入插件行（`~/.dsh/profiles/desktop/package.json` 的
bundles 与 profile 的 `cordis.patch.yml`）。包内自带的行是：

```yaml
- insert:
    - id: ui-brand-gold
      name: '@linxin666/dsh-client-ui-brand-gold'
```

### 从 npm 安装

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-brand-gold@latest
```

## 诊断

默认关闭。在 GUI URL 加 `?dshBrandGoldDiag=1`，或
`localStorage.setItem('dsh-brand-gold:diag', '1')`，然后读取
`window.__DSH_BRAND_GOLD__.state` 与 `.records()`。状态把生命周期阶段
（`anchor-missing`、`anchor-hidden`、`zero-size`、`capability-missing`、
`gpu-init-failed`、`material-failed`、`composite-failed`、`drawing`、
`verified`）与 GPU 能力判定分开上报，缓冲区是定长环形。窗口标题从不被改写，
也不发出任何网络探针请求。

## 许可

Apache-2.0
