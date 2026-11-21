# ATMOS · WebGL2 风场实验室

一个可以直接运行和继续扩展的浏览器 GPU 风场可视化框架。使用原生 JavaScript / WebGL2 / GLSL ES 3.00，无运行时第三方依赖。

## 快速开始

安装 [Node.js](https://nodejs.org/) 22 或更新版本，在项目根目录执行：

```sh
npm start
```

打开 http://127.0.0.1:5173 。不需要安装依赖即可运行应用；浏览器必须支持 WebGL2 和 `EXT_color_buffer_float`。不要直接双击 HTML：ES Modules 需要 HTTP 服务。

## 当前功能

- 16,384 / 65,536 / 262,144 粒子；粒子状态在 GPU 上更新，不逐帧回传 CPU。
- GLSL Fragment Shader 生成动态合成风场：周期涡旋、急流、均匀流。
- RGBA32F 双缓冲粒子纹理；Euler / RK2 中点法切换。
- 手动双线性风场采样、周期边界、按物理域尺寸换算 m/s 位移。
- 速度着色、风向箭头、RGBA8 双缓冲轨迹、实际帧率与模拟时钟。
- 二维平移、倾斜平面的旋转、滚轮缩放、暂停、重新播种。
- 规则网格 JSON 导入、示例下载、输入校验、GPU 能力检查与错误提示。
- 自适应桌面 / 移动布局。

## 数据格式

参见 [`data/uniform.json`](data/uniform.json)。

```json
{
  "width": 2,
  "height": 2,
  "domain": [600000, 400000],
  "u": [18, 18, 18, 18],
  "v": [6, 6, 6, 6]
}
```

`domain` 是 X / Y 方向的实际长度，单位米。`u` 是 X 向速度，`v` 是 Y 向速度，单位 m/s。数组按行排列：`index = y * width + x`，X 向右、Y 向上，第一行对应南侧，采样点在单元中心。数据不含经纬度投影；不能把经纬度直接当成米。

网格尺寸范围为 2–1024；边长 1,000–100,000,000 m；单个速度分量绝对值 ≤ 500 m/s；文件 ≤ 32 MB。导入的是静态二维切片，导入后禁用动态风场开关，切换预设可恢复合成数据。

当前采用周期边界，所以用于真实有限区域的数据需要预处理边缘，或修改采样与粒子越界策略。颜色标尺固定为 0–45 m/s，超过 45 的值使用最高档颜色；运动仍使用原始速度。

## 计算结构

```text
合成风场 Fragment Shader / JSON 网格
                 ↓
          RGBA32F 速度纹理
                 ↓ 手动双线性采样
粒子状态 A → Euler / RK2 更新 → 粒子状态 B
                 ↓ 交换 A / B
           GL_POINTS 粒子绘制
                 ↓
        RGBA8 轨迹衰减与双缓冲
                 ↓
         网格背景 + 风向矢量
```

粒子纹理存储 `(x, y, age, seed)`，x / y 是归一化位置。位移公式为 `p += velocity / domain * dt`。默认模拟子步为 30 s；导入数据的子步取 `min(30, 0.5 * min(dx, dy) / maxSpeed)`。若安全步长小于 1 s，要求用户降低分辨率或调整物理域尺寸。

用真实经过时间累积模拟时长，渲染帧和积分子步分离；每帧最多 8 个子步，过载时丢弃积压时间、减慢模拟，不增大积分步长。页面进入后台时停止推进。时间倍率是目标倍率，过载时实际倍率会降低。

RK2 使用同一子步内冻结的速度纹理进行空间中点采样。静态平滑速度场可获得二阶时间积分精度；动态合成风场的时间采样尚未实现严格的非自治 RK2，不应据此宣称整个动态系统二阶精度。轨迹纹理是屏幕空间可视化缓存，视角改变时会清空，不能作为精确轨迹数据使用。

浮点纹理使用 NEAREST，再在着色器里手动双线性插值，不要求 `OES_texture_float_linear`。RGBA32F 渲染目标依赖 [Khronos EXT_color_buffer_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/)；两个 512² 粒子状态纹理约占 8 MiB，另有速度纹理与随视口尺寸增长的轨迹纹理。设备像素比上限 1.5。

## 目录

```text
index.html          页面与控制面板
src/main.js         交互、固定步长调度、文件导入
src/engine.js       GPU 资源、渲染与计算管线
src/shaders.js      GLSL 着色器
src/data.js         数据校验与步长计算
src/style.css       响应式界面
scripts/serve.mjs   仅本地使用的静态开发服务器
tests/              数据测试与浏览器 GPU 回读测试
```

## 测试

```sh
npm ci
npm test
npx playwright install chromium
```

先在另一个终端运行 `npm start`，再执行：

```sh
npm run test:browser
```

已安装 Chrome 时也可设置 `BROWSER_CHANNEL=chrome`（PowerShell：`$env:BROWSER_CHANNEL='chrome'`），不必安装 Playwright Chromium。

浏览器测试编译实际 GLSL，读回 GPU 粒子状态核验恒定速度位移与周期边界，检查积分精度、暂停、26 万粒子模式、视角切换、数据导入、非空画面及移动端溢出。截图输出到被 Git 忽略的 `test-results/`。测试允许 Chromium 软件 WebGL 后备，因此运行通过不等于任何设备都能达到特定帧率。

## 研究边界与下一步

这是**给定速度场上的粒子平流与可视化原型**，不是完整的大气流体求解器。动态场由解析函数生成；倾斜视图展示二维平面，不是三维大气体积；粒子定时重生以保持可视化覆盖，不适用于物质守恒分析。

后续可扩展真实气象数据解码（NetCDF / GRIB 预处理）、时间插值、投影变换、3D 风场纹理、严格的时间积分与误差评估、粒子轨迹导出、GPU 时间查询，以及具有压力投影和边界条件的流体求解器。真实性能需要在目标设备与数据规模上测量。

## 静态托管

应用不需要构建，直接托管 `index.html`、`src/`、`data/` 即可。在 GitHub 仓库 Settings → Pages 中选择从 `main` 分支的根目录部署即可使用 GitHub Pages；仓库推送和 Pages 开启是两个独立步骤。
