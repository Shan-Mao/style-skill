# ScreenParser ONNX 推理 PoC

验证目标：用 ONNX Runtime（CPU）替代 PyTorch + Ultralytics 运行 ScreenParser，
将最终发布包从约 1.9GB 降到约 250MB（见 docs/tauri-integration-plan.md §4 方案 B）。
**本 PoC 不改动任何正式入口**（`inference/screenparser_server.py` 与 `best.pt` 均保持原样）。

## 前置依赖（尚未安装，等待确认）

| 包 | 版本 | 下载体积 | 许可证 | 用途 |
|---|---|---|---|---|
| onnx | 1.23.2 | 7.5 MB | Apache-2.0 | 导出时的图序列化与校验 |
| onnxruntime | 1.31.0 | 14.6 MB | MIT | 独立推理 |
| ml-dtypes | 0.6.0 | 0.4 MB | Apache-2.0 | onnx 传递依赖 |
| protobuf | 7.36.2 | 0.4 MB | BSD-3 | onnx 传递依赖 |
| flatbuffers | 25.12.19 | <0.1 MB | Apache-2.0 | onnx 传递依赖 |

安装位置：仅 `poc/screenparser-poc/.venv`（实验环境），不影响 Web 应用与系统环境。

## 已确认的模型与处理链路（源码审查结论）

- 模型：YOLO11-L Detect 头，55 类，stride [8,16,32]，`best.pt`（153,259,543 字节）。
- 预处理（实测探针修正）：ultralytics 对 `.pt` 的 predict 使用**最小矩形 LetterBox**
  （`engine/predictor.py:236` 的 `auto=... and format=='pt'`）——1280×800 输入实际按
  `(1,3,800,1280)` 零填充推理，而非方形 1280×1280。因此 ONNX 必须 `dynamic=True`
  导出并用相同的自动矩形 letterbox，两后端才能逐像素同输入（静态方形导出
  曾导致 Δconf≈0.05 与大量漏检/误检，是本 PoC 定位出的差异根源）。
- 后处理：Detect 头在图中完成 DFL 解码与类别 sigmoid → 输出 `(1, 4+nc, N)`，
  框为 letterbox 坐标系下的 xywh（像素）；NMS（`ultralytics/utils/nms.py:13`）：
  conf/iou 阈值、按类（非 agnostic）、`max_det=300`；`scale_boxes` 去除
  padding/ratio 并裁剪回原图坐标。
- 导出要求：`exporter.py:1137` 需 `import onnx`；`simplify=False` 时不需 onnxslim。

## 最终实测结论（report.json）

dynamic 导出（96.8MB，best.pt 原样保留）后，8 用例全部通过：
- 5 张真实截图 + 960×600 缩放图：**116/116 检测全部匹配，0 漏检 0 误检，
  Δcoord = 0（0.1px 精度内）、Δconf = 0（0.001 精度内）**；
- 纯色空图：双后端均 0 检测；非法字节：双后端均拒绝（ultralytics 以空结果拒绝，
  独立推理器抛 ValueError，正式服务在 PIL 解码层统一拦截）；
- 速度（预热后 3 次均值，含读图与 letterbox）：ONNX 885–990ms vs PyTorch 903–1182ms，
  ONNX 快约 5–20%，且免 torch 加载；
- 内存（进程 RSS 粗测）：ONNX 增量约 363MB vs PyTorch 约 808MB。

## 误差评估方法（预先设定，可复现）

两后端使用**完全相同的调用参数**：`imgsz=1280, conf=0.25, iou=0.10, device=cpu`，
同一组测试图（`poc/screenparser-poc/test-images/*.png` + 一张缩放图 + 纯色空图 + 非法字节）。

- **匹配规则**：同类别的检测框，按 PyTorch 侧置信度降序做贪心匹配，IoU ≥ 0.5 才算同一目标。
- **指标**：每图 `n_pt / n_onnx / matched / 漏检(pt-only) / 误检(onnx-only)`；
  matched 对的坐标差（x1y1x2y2 的均值与最大值，像素与图片长边百分比）、置信度差均值；
  推理耗时（预热 1 次 + 3 次平均）；内存（进程 RSS 前后差，粗粒度参考）。
- **通过标准（建议值）**：mean 坐标差 ≤ 0.5% 长边、max ≤ 2%、mean Δconf ≤ 0.01；
  conf ≥ 0.5 的检测无漏检误检；空图双后端均 0 检测；非法输入均报错不崩溃。
- **已知误差来源**：浮点后端数值差异、独立 NMS 实现与 torchvision 的平局处理差异
  （低分密集区域可能产生少量 extra/missing，按置信度分层统计核对）。

## 运行方式（依赖确认安装后）

```bash
cd poc/screenparser-poc
.venv/Scripts/python.exe ../onnx-poc/export_onnx.py        # 导出 best.onnx（不覆盖 best.pt）
.venv/Scripts/python.exe ../onnx-poc/compare_backends.py   # 双后端对比 + report.json
# 仅 PyTorch 基线（无需 onnx 依赖，已可用）：
.venv/Scripts/python.exe ../onnx-poc/compare_backends.py --pytorch-only
```
