# Style Skill

从参考截图提取 Web UI 视觉设计语言，并生成可交付给 AI 编程助手使用的 Agent Skill。

核心原则：**算法只做确定性测量，不猜测设计意图**。所有图像特征由浏览器本地
计算（无 AI API、无云端服务、不上传图片）；"这个颜色是什么用途、重要不重要"
由用户在规则编辑器中人工确认；只有已确认的规则才会进入最终导出物。

## 主要功能

- **参考素材导入**：文件选择或拖拽导入 PNG / JPEG / WebP（单张 ≤ 10 MB），
  支持格式校验、可解码性检查与大小限制；图片仅在本地浏览器中读取。
- **单图视觉分析**（确定性 Canvas 算法）：颜色分布（量化 + 聚类）、明度分布
  （Rec.709 加权 + 直方图 + 对比度）、边缘密度（Sobel 算子）、线条方向、4×4
  空间分布网格。
- **多图对比**：跨图颜色匹配、明暗/对比度/复杂度对比、空间分布差异，以及基于
  ScreenParser 检测结果的 UI 类别计数、归一化尺寸与行列对齐模式对比。
- **结构识别（可选，本地模型）**：ScreenParser v2（55 类 UI 元素）通过本地
  HTTP 服务运行，检测结果作为证据展示（检测框叠加 + 类别统计 + 置信度），
  并可生成待人工确认的结构规则候选；模型失败时其余功能不受影响。
- **设计规则编辑器**：从分析结果生成待确认规则（实测/推断徽章 + 依据指标 +
  关联图片），支持修改、确认、忽略、手动新增；用户改动不会被重新计算覆盖。
- **设计令牌与 Skill 导出**：把「已确认且有值」的规则转换为
  `tokens.css` / `tokens.json`，并打包成含 SKILL.md 与参考文档的
  Agent Skill ZIP（生成、预览、复制、下载均本地完成）。

## 技术栈

- 前端：Vite + React 19 + TypeScript，原生 CSS（无 UI 框架）
- 桌面：Tauri 2（脚手架就绪，见 `docs/tauri-integration-plan.md`）
- 本地推理：Python + ONNX Runtime（默认）/ PyTorch + Ultralytics（回退）

## 安装与开发启动

要求：Node.js（建议 20+）、Python 3.13+（本地结构识别用）。

```bash
npm install
npm run dev        # Web 开发模式，默认 http://localhost:5173
```

如需启用结构识别，另开一个终端启动本地推理服务（默认端口 8765，仅绑定
127.0.0.1；后端可用 `--backend pytorch` 切换）：

```bash
npm run detect:server
```

桌面模式（需要 Rust stable-msvc 工具链与 MSVC Build Tools）：

```bash
npx tauri dev      # 会自动通过 STYLE_SKILL_DEV_ROOT 拉起推理服务
```

## 构建与测试

```bash
npm run build      # tsc -b && vite build（类型检查 + 产物构建）
npm run lint       # ESLint
npm run preview    # 预览构建产物
node scripts/test-structure-edges.ts   # 结构特征判定边界测试
```

Tauri 便携版构建：`npx tauri build --no-bundle` 产出
`src-tauri/target/release/style-skill.exe`，随后按
`docs/tauri-integration-plan.md` 的资源布局组装 `runtime/` 与 `resources/`。

## AI 推理模块与可选依赖

结构识别是**可选功能**：推理服务未运行时，导入、统计分析、规则编辑、
令牌生成与 Skill 导出全部正常（识别面板会显示服务不可用与启动指引）。

- 默认后端 ONNX：运行时依赖 `onnxruntime`、`numpy`、`opencv-python`、`pillow`
  （完整清单见 `inference/requirements-onnx.lock`），无需 torch。
- 回退后端 PyTorch：依赖 `ultralytics`（AGPL-3.0）+ `torch`。
- 本仓库不含权重文件，也不在运行时自动下载模型。

## ScreenParser 模型的获取与放置

| 文件 | 来源 | 校验（SHA-256） |
|---|---|---|
| `best.pt`（146MB） | https://huggingface.co/docling-project/ScreenParser | `dbcb4f583ccfdb8100a68e606525c247890a2de4c1a54b14741e0ee29ce0ab88` |
| `best.onnx`（97MB，dynamic 导出） | 由 `poc/onnx-poc/export_onnx.py` 从 best.pt 导出 | `34d929aa684e784a2cd1da858673593ae4b8b472cbec5d6401fd33f1ee0e91eb` |

放置位置（任选其一，按优先级解析）：

1. 环境变量 `SCREENPARSER_ONNX_MODEL` / `SCREENPARSER_MODEL`（ONNX / PyTorch）；
2. `inference/models/best.onnx`（ONNX）、`inference/models/best.pt`（PyTorch）；
3. 开发模式回退：`poc/onnx-poc/best.onnx`、`poc/screenparser-poc/best.pt`。

PyTorch 模型的 SHA-256 请在下载后与 Hugging Face 官方发布核对（官方未提供
单文件校验清单，此处不做转述）。

## 已知限制

- 结构识别只输出边界框、类别与置信度，**不含文本内容**（无 OCR），也不输出
  圆角、字体、阴影等无法从检测框得到的属性。
- 对齐/尺寸一致性等结构模式为经验阈值判定，检测结果均为**模型推断证据**，
  需人工确认；不要把检测结果直接当作 DOM 事实或设计规范。
- 图片与规则状态保存在内存中，刷新页面即丢失（尚未实现持久化）。
- 推理服务在 Windows 下开发；跨平台运行未验证。
- 桌面安装包（NSIS）尚未制作。

## 文档

- Tauri 桌面化方案：`docs/tauri-integration-plan.md`
- ONNX 可行性 PoC（双后端对比方法与数据）：`poc/onnx-poc/README.md`

## 许可证

本项目以 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）发布。
第三方依赖与其各自的许可见仓库内依赖清单；ScreenParser / ScreenVLM 模型权重
的许可条款以 Hugging Face 模型卡为准，权重文件默认不随仓库分发。
