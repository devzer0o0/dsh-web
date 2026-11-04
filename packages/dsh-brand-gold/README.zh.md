# dsh-brand-gold · DeepSeek Harness 品牌组合的抛光黄金材质

[English](README.md) | 中文

<p align="center">
  <strong>侧栏品牌组合的黄金版本，带周期性金属扫光</strong><br>
  <em>原始矢量 · 单一时轴的光束 · 宽金色亮带配短促香槟光芯 · 局部放大与浮起</em>
</p>

纯浏览器半区的 DSH Web GUI 插件：它填充 shell 声明的两个侧栏品牌槽位
（`sidebar.brand.mark` 与 `sidebar.brand.name`），用原始 DeepSeek Harness 品牌
矢量绘制抛光黄金版本，并每 3 秒让一道斜向光束扫过整个品牌组合。

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
| 周期（本轮开始到下一轮开始） | 3000 ms | `SWEEP_PARAMS.periodMs` |
| 单次可见窗口 | 2700 ms | `SWEEP_PARAMS.sweepMs` |
| 周期内静止 | 300 ms | `periodMs - sweepMs` |
| 材质就绪后首次扫光 | 3000 ms | `SWEEP_PARAMS.firstDelayMs` |
| A 段 入场 | 250 ms | `SWEEP_PARAMS.entryMs` |
| B 段 遍历金属 | 2200 ms | `SWEEP_PARAMS.surfaceMs` |
| C 段 退场 | 250 ms | `SWEEP_PARAMS.exitMs` |
| 方向 | 仅从左向右 | `trajectory.ts`（`centerStart` 到 `centerEnd`） |
| 相对竖直倾斜 | 25 度 | `SWEEP_PARAMS.tiltDeg` |
| 宽金色亮带 FWHM | 组合宽度的 0.55 倍 | `SWEEP_PARAMS.mainBandFwhmRatio` |
| 香槟光芯 FWHM | clamp(0.10 x W, 12, 24) CSS px | `SWEEP_PARAMS.coreFwhmRatio`、`coreFwhmMinPx`、`coreFwhmMaxPx` |
| 光带有限支撑 | 3 sigma，末端精确归零 | `SWEEP_PARAMS.supportSigmas`、`beam.ts` |
| 入场与退场行程 | 最外侧金属再向外一整个支撑半径 | `layout.ts`（`centerStart`、`centerEnd`） |
| 金属资格 | 几何遮罩决定，与亮度无关 | `geometry-mask.ts`、`surface.ts` |
| 亮带反照率下限 | 0.22 线性 | `SWEEP_PARAMS.bandAlbedoFloor` |
| 局部放大 | 峰值 1.08 倍，半径 5 CSS px | `SWEEP_PARAMS.magnifyPeak`、`magnifyRadiusPx` |
| 局部浮起 | 峰值 0.8 CSS px | `SWEEP_PARAMS.liftPx` |
| 铭牌响应 | 金属的 55% | `SWEEP_PARAMS.plateFactor` |
| 光芯请求峰值 | 短时 1600 nit | `SWEEP_PARAMS.peakNits` |

参数集中在 `src/client/sweep.ts`，几何与配光在 `beam.ts`、`light.ts`（纯算术，有单测），
着色器与之逐项对应。

**宽度是 CSS px 的可见半高全宽（FWHM），在同一水平截面上测量。** 存在倾角时，光束坐标
`u = (x - cx) + (y - cy) * tan(tilt)` 在任意固定行上每横移 1 CSS px 恰好增加 1，因此 `u` 上的
FWHM 与观察者横着量到的 FWHM 是同一个数。σ 从不作为参数出现：`beam.ts` 按
`sigma = FWHM / (2 * sqrt(ln 2))` 推导，测试量的是最终光分布而不是输入参数。

在出厂 188 x 24 CSS px 组合、DPR 2 上的实测：

| 量 | 取值 |
|---|---|
| 画布 | 392 x 64 设备 px |
| 宽亮带 FWHM | 103.4 CSS px |
| 光芯 FWHM | 18.8 CSS px |
| 光带支撑半径 | 186.3 CSS px |
| 金属在光束坐标上的范围 | 3.3 .. 194.1 CSS px |
| 中心行程 | -187.0 .. 384.4 CSS px |
| 中心穿过金属的时间 | 2200 ms（B 段） |
| 中心穿越速度 | 约 87 CSS px/s |
| 包络 | 入场 250 ms 内开启，从第一块金属到最后一块全程满幅，尾部离开后才收束 |

各部分如何协作：

1. `layout.ts` 从两个占位**实际渲染**的盒子出发，把各自 viewBox 映射进同一套画布坐标。
   两个 viewBox 从不被当成同一个空间，光束会连续穿过图标与字标之间的空隙，而不是在字标
   起点重新开始。行程按**整条光带**计算：光束坐标
   `q = x + (y - centerY) * tan(tilt)` 遍历每个金属顶点得到 `qMin/qMax`，支撑半径 `R`
   由亮带 σ 推出，中心从 `qMin - R - padding` 走到 `qMax + R + padding`。因此第一块金属
   距离入场点有整条光带那么远，最后一块金属距离退场点同样如此，而画布本身只覆盖 Logo。
2. `material.ts` 在每次布局或主题变化时合成一次实时材质：每个 SVG 内联计算后的绘制属性、
   按各自变换画入同一画布，作为 `rgba8unorm-srgb` 纹理上传，sRGB 解码交给硬件。
3. `geometry-mask.ts` 按**原始矢量**光栅出金属遮罩：鲸鱼填充区、deepseek 每个实心笔画、
   HARNESS 底板，并在底板上挖掉深色铭文、在每个字母上保留内部空洞。它是 `rgba8unorm`
   的覆盖数据而不是 sRGB 颜色图，用逐扫描线、每像素 4 次子采样的方式生成，DPR 3 也只要
   几毫秒。一个像素是不是金属由它所属的几何决定，亮度只决定它返回多少光。亮带额外乘一个
   线性反照率下限，因此最暗的金色与铭牌也会真的反光，而不是被光带跳过。
4. `renderer.ts` 通过**逆向形变**采样该纹理。距轴 `d` 的源像素落到 `d * scale` 处，因此中心附近
   的细节确实被拉开；位移被限制在 `magnifyRadiusPx` 内，宽亮带不会把远处材质拉过来。同一材质上
   GPU 与 `beam.ts` 的位移误差在 1 设备 px 以内。
5. 画布在光束之外完全透明。静止时屏幕上只有下方那张 SVG，因此不存在两份轮廓叠加，扫光结束
   后形状、大小、位置与颜色精确恢复。
6. 逐帧绘制只发生在 2700 ms 窗口内。周期其余时间只保留一个定时器；页面或 Logo 不可见时错过
   的那一轮直接跳过、不补播，也不会出现重叠循环。
7. 首次扫光在材质**与遮罩**都上传完成之后才开始计时，并且整整等一个周期，因此第一轮不会
   对着空画布运行。普通重建保留原有相位：只有首次初始化、从隐藏标签页恢复和 GPU 重置会重新
   建立原点。

`prefers-reduced-motion: reduce` 在每次重建与每次 change 事件时重新读取：没有位移、没有放大、
没有周期性高光，只保留静态精细金色，开关即时生效、无需刷新。

## 颜色管线

空间严格分开，每一步都注明自己在哪一层：

| 步骤 | 空间 | 位置 |
|---|---|---|
| CSS 绘制属性与 SVG 光栅 | sRGB 编码 | `raster.ts`、`material.ts` |
| 纹理解码 | 由 `rgba8unorm-srgb` 在硬件完成 | `renderer.ts` |
| 光照、放大、高光 | 线性光 | `renderer.ts` 中的着色器，`light.ts` 同构 |
| 输出 | sRGB 编码，1.0 以上沿用同一分支延续 | 着色器 `encode()`、`color.ts` 的 `linearToSrgb()` |
| 透明度 | 直通，最终写出时预乘 | 着色器 |

`linearToSrgb` 在白点两侧都使用 `1.055 * v^(1/2.4) - 0.055`，因此线性 4.0 编码为约 1.82，
而不是原样输出 4.0。解码是它的精确逆函数，读回值才能被当作线性光，而不是被当作线性光的
编码通道。

## 亮度：1600 nit 目标

峰值是**请求的最终线性亮度**，不是叠加在其它增益之上的增益：

```
requestedPeakLinear = peakNits / sdrReferenceWhiteNits
```

其中 `peakNits = 1600`（用户给出的屏幕短时峰值），参考白为实测或假定值。光芯只花掉上限之下
剩余的预算——`max(ceiling - lit, 0)`——因此亮带、香槟领与光芯相加不会超过目标，合成峰值在
构造上就等于目标。每个色调先按自身亮度归一化，所以「红色通道 1200」永远不能冒充「1200 nit」。

**当前宿主上已知与未知的量：**

| 量 | 取值 | 来源 |
|---|---|---|
| 屏幕峰值能力 | 1600 nit | 用户提供 |
| SDR 参考白 | 203 nit | **假定值**（macOS 默认），未在本地实测 |
| `requestedPeakLinear` | 7.88 | 由上两行推导 |
| 可用 HDR 余量 | 未知 | 本插件没有可获得该值的接口 |
| 屏幕实测亮度 | 未测量 | 见下 |

假定参考白是一个可调项（`SWEEP_PARAMS.sdrWhiteNits` 接受实测值，`assumedSdrWhiteNits` 是回落），
诊断会记录用了哪一个，因此接入实测值不需要改着色器。**本文不声称实测到 1600 nit**：插件只报告
请求的相对亮度，并明确说明绝对读数是缺失的。

## 扩展亮度：实测了什么、没实测什么

三个层级，刻意分开。

**1. 渲染目标中确实存在扩展值——已实测。**

在真实 GPU 上（Chromium 156，直接驱动出厂 `createRenderer` 的独立测试台），金色材质上一帧
扫光中期的读回为：

| 模式 | 实际生效配置 | 编码峰值 | 线性亮度峰值 | 目标 |
|---|---|---|---|---|
| 扩展 | `premultiplied` + `extended`，`rgba16float`，`srgb` | 2.50 | 7.869 | 7.882 |
| SDR | `premultiplied` + `standard` | 0.997 | 0.882 | 不适用 |

扩展一行是着色器自身输出中正确的大于 1.0 的线性值；SDR 一行是同一着色器去掉上限的结果，
两者的差异只来自色调映射模式，不是两条代码路径。

**2. 合成路径能够呈现扩展亮度——已在宿主中实测。**

在运行中的桌面客户端里，画布通过 `getConfiguration()` 回报
`toneMapping: { mode: 'extended' }`、`alphaMode: 'premultiplied'`、`format: 'rgba16float'`、
`colorSpace: 'srgb'`，控制器依据一次覆盖加权的读回（7.876 线性，按 203 nit 假定约等于 1599 nit）
发布 `displayVerified: true`。注意本宿主上 `(dynamic-range: high)` 仍然为 `false`：该媒体查询
只是显示端提示，真正决定的是画布契约。

**3. 面板实际发出 1600 nit——未测量。**

- 本地没有任何能保留 1.0 以上数值的采集路径，因此截图不能作为证据；SDR 截图在 255 处夹断，
  对 nits 一无所证。
- 插件只暴露 `displayVerified`（合成器保住了扩展值），从不把它当成物理测量。
- 物理读数需要在光芯闪亮时用校准过的亮度计对准它，并记录参考白与测量几何。本任务没有做。

在只保留标准色调映射的表面上，同一着色器把扩展上限置零并施加柔和肩部，受光金属变亮但不会
夹成白块——宽亮带与慢速穿越保持不变。

## 验证

```sh
cd packages/dsh-brand-gold
pnpm test        # 69 个单测：时序、光束几何、配光分布、颜色编解码、坐标系、
                 # 渲染接线、生命周期
../../node_modules/.bin/tsdown
```

单测针对的是最容易悄悄坏掉的特性：最终亮带的 FWHM（而不是输入参数）、光芯 FWHM、合成峰值
不越过请求上限、亮带仍保留金色、铭牌为 55%、形变向外且可逆、1.0 以上的扩展编解码往返、
组合塌缩时布局拒绝构建、行程不随亮带增长，以及渲染器确实把解析出的参数交给着色器。

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
`verified`）与 GPU 能力判定分开上报，并补充：

- `mode` / `effectiveMode`：请求值与 `getConfiguration()` 读回值，alpha 与色调映射分别列出；
- `requestedPeakLinear`、`peakLinear`、`peakComposited`、`measuredNits`；
- `displayVerified`：合成器是否保住了扩展值；
- `calibration`：参考白与余量来源（`assumed/headroom:unknown`）；
- 环形缓冲中的 `beam` 记录：每秒约十次的光束位置与包络采样，上面的穿越时间与速度即由它测得。

GPU 读回会分配纹理与映射缓冲区，因此只在开启诊断时执行，绝不在每位用户的机器上每周期跑一次。

## 许可

Apache-2.0