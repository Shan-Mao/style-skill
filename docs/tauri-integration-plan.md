# Style Skill — Tauri 2 桌面化集成方案

> 状态：设计定稿 + 脚手架就绪，**尚未编译验证**（本机缺少 Rust 与 MSVC 工具链，按约定不自动安装）。
> 脚手架位于 `src-tauri/`，工具链就绪后按文末步骤即可运行。

## 1. 环境检查结果（2026-10-25，本机）

| 依赖 | 状态 | 说明 |
|---|---|---|
| Rust / Cargo | ❌ 未安装 | `rustc`、`cargo` 均不在 PATH |
| MSVC C++ Build Tools | ❌ 未安装 | vswhere 不存在（无 Visual Studio Installer） |
| WebView2 运行时 | ✅ 155.0.4283.60 / .62 | Windows 10 22H2 自带，Tauri 直接可用 |
| Node / npm | ✅ 24.22.1 / npmmirror | 前端构建链完整 |

补齐方式（需用户手动执行）：安装 [rustup](https://rustup.rs)（默认 stable-msvc toolchain）+
Visual Studio Build Tools（勾选「使用 C++ 的桌面开发」）。两者装完前 `cargo` 相关命令均不可用。

## 2. 总体架构

```
┌─────────────────────────── Tauri 2 主进程（Rust）───────────────────────────┐
│  窗口管理（WebView2 承载前端）                                              │
│  detect_server 模块：                                                       │
│   · 启动时选择空闲端口（bind 127.0.0.1:0）                                  │
│   · 以子进程启动 Python 推理服务（inference/screenparser_server.py）         │
│   · 轮询 /health 健康检查（超时 30s，失败降级不阻断应用）                    │
│   · 退出（窗口关闭/Drop）时终止子进程                                       │
│  对前端暴露唯一命令：detect_server_url() -> Option<String>                  │
└─────────────────────────────────────────────────────────────────────────────┘
              │ IPC（invoke，仅此一个命令）        │ HTTP 127.0.0.1:<动态端口>
              ▼                                    ▼
┌────────── 前端（现有 React 应用，零改动）──────────┐   ┌─ Python 推理服务 ─┐
│  src/lib/tauriBridge.ts（桌面模式探测，~30 行）    │   │ 复用现有 server   │
│  启动时 invoke 取地址 → setDetectionServerUrl()   │──▶│ 绑定 127.0.0.1   │
│  Web 模式：桥接为空操作，默认 127.0.0.1:8765      │   │ 未运行则功能降级  │
└───────────────────────────────────────────────────┘   └───────────────────┘
```

关键约束的落实方式：

- **前端不执行任何系统命令**：前端只通过 `invoke` 读取一个 URL 字符串，所有进程操作都在 Rust 侧。
- **不写死绝对路径**：Python 与模型路径按「发布资源目录 → 开发模式相对定位」顺序解析（见 §4）。
- **保留 Web 开发模式**：`npm run dev` 行为完全不变；Tauri 相关代码全部惰性（`__TAURI_INTERNALS__` 不存在时不生效）。

## 3. Vite 构建与生产环境路由

- 应用是**纯状态切换的 SPA**（无路由库、无 URL 路径），生产构建产物为静态 `dist/`，
  Tauri 以 `frontendDist: "../dist"` 直接加载，不存在路由回退问题。
- 唯一需要注意的资源：图片预览使用 `blob:` objectURL，CSP 已放行 `img-src 'self' blob:`。
- 开发模式：Tauri CLI 注入 `TAURI_ENV`，`vite.config.ts` 据此启用 `strictPort: 5173`
  （Tauri 要求 devUrl 端口稳定）；普通 Web 开发不受影响。
- 前端到推理服务的请求：CSP `connect-src http://127.0.0.1:*` 放行动态端口。

## 4. Python 运行时 / PyTorch / 模型权重的定位与分发

### 路径解析（Rust 侧 `detect_server.rs`）

```
1. 发布模式（首选）：<exe_dir>/runtime/python.exe
   脚本：<exe_dir>/resources/inference/screenparser_server.py
   模型：SCREENPARSER_MODEL=<exe_dir>/resources/models/best.pt
2. 开发模式：环境变量 STYLE_SKILL_DEV_ROOT 指向项目根（由 tauri.conf.json dev 配置注入），
   使用 poc/screenparser-poc/.venv 与现有权重 —— 与 npm run detect:server 完全一致
3. 都找不到：不启动推理服务，应用以纯 Canvas 分析模式运行（现有降级路径）
```

### 分发方案（按优先级）

| 方案 | 体积预估 | 评估 |
|---|---|---|
| A. python-build-standalone + pip 装入 app 目录 | Python ~60MB + torch CPU ~700MB + ultralytics 栈 ~1.1GB + best.pt 146MB ≈ **1.9GB** | 可控但巨大；torch CPU 轮子是主要负担 |
| B. ScreenParser 导出 ONNX + onnxruntime | Python ~60MB + onnxruntime ~40MB + 权重 ~150MB ≈ **250MB** | **推荐目标**；需验证 ultralytics `export format=onnx` 后检测精度一致（PoC 待做） |
| C. 要求用户本机已装 Python，首次启动时 pip 安装 | 下载 ~1.1GB | 体验差、网络依赖，仅作兜底 |

现有 `.venv`（约 1.1GB）只用于开发模式，**不进入任何发布包**。方案 B 完成前，
桌面版可先用方案 A 做内测包。

## 5. 推理进程生命周期与安全边界

- **启动**：主进程 setup 阶段惰性启动（窗口就绪后再拉起，避免阻塞首屏）；子进程
  `stdout/stderr` 重定向到日志文件（`app_log_dir/detect-server.log`）。
- **端口冲突**：由 Rust 侧先 `TcpListener::bind("127.0.0.1:0")` 选定空闲端口再传给
  子进程，规避 8765 被占用问题；极端竞争窗口由健康检查兜底（Python 绑定失败即退出）。
- **健康检查**：轮询 `/health`，30 秒超时；超时杀进程并标记不可用，UI 走现有
  「识别服务不可用」降级路径（Canvas 分析 / 规则 / Skill 导出不受影响）。
- **崩溃恢复**：`detect_server_url` 返回 None 时前端显示降级；提供「重试」入口时
  由 Rust 侧重新拉起（v2 再做，脚手架预留）。
- **关闭**：`Drop for DetectServer` + 窗口 Destroyed 事件双重保障 `child.kill()`。
- **安全**：服务只绑 127.0.0.1；请求体上限 12MB（服务端已实现）；无任何外部网络访问；
  前端与服务的全部交互只经 HTTP，无命令注入面。

## 6. 便携目录结构（发布包预期，方案 A）

```
StyleSkill/
├── StyleSkill.exe                      (~10MB, Tauri 壳 + WebView2 加载器)
├── runtime/                            嵌入式 Python
│   ├── python.exe
│   └── Lib/site-packages/              torch/ultralytics 栈（~1.1GB）
├── resources/
│   ├── inference/screenparser_server.py
│   └── models/best.pt                  (146MB)
└── WebView2Loader.dll
合计 ≈ 1.9GB（方案 B 可降至 ~400MB 含前端资源）
```

## 7. 脚手架内容与待办

已就绪（未编译）：
- `src-tauri/`：Cargo.toml、build.rs、tauri.conf.json（含 CSP）、capabilities/default.json、
  src/main.rs + src/lib.rs（端口选择 / 进程管理 / 健康检查 / invoke 命令）
- `src/lib/tauriBridge.ts`：桌面模式探测（`__TAURI_INTERNALS__.invoke`，不引入 npm 依赖）
- `src/lib/detectionClient.ts`：新增 `setDetectionServerUrl()`，URL 可动态注入
- `vite.config.ts`：TAURI_ENV 感知的固定端口

工具链就绪后的验证步骤：
```bash
npm i -D @tauri-apps/cli@^2        # 唯一需要新增的 devDependency
npx tauri dev                       # 开发模式（devUrl → vite dev server）
npx tauri build                     # 产出 NSIS 安装包 / 便携 exe
```
验证清单：窗口加载 / 导入图片（blob: 预览）/ 推理服务自动拉起与动态端口 / 关窗后
python.exe 进程退出（任务管理器确认）/ 无推理服务时全功能降级。
