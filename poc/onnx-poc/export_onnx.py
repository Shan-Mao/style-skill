"""导出 ScreenParser best.pt 为 ONNX（独立 PoC，不覆盖原模型）。

用法（依赖确认安装后）：
    cd poc/screenparser-poc
    .venv/Scripts/python.exe ../onnx-poc/export_onnx.py

行为：
- dynamic=True 导出：ONNX 接受任意 stride(32) 倍数的输入尺寸。
  原因：ultralytics 对 .pt 的 predict 使用「最小矩形 letterbox」
  （1280×800 输入实际按 (1,3,800,1280) 推理，零填充），静态方形导出
  会强制 1280×1280 补边，导致两后端预处理不一致（实测差异根源）。
  dynamic 导出后两后端可做到逐像素相同输入。
- simplify=False（避免引入 onnxslim 依赖），opset=17，fp32，CPU。
- ultralytics 默认把 best.onnx 写到 best.pt 同目录；本脚本随后将其移动到
  poc/onnx-poc/best.onnx，原 best.pt 保持不动。
"""

import shutil
from pathlib import Path

POC_DIR = Path(__file__).resolve().parent
PT_PATH = POC_DIR.parent / "screenparser-poc" / "best.pt"
OUT_PATH = POC_DIR / "best.onnx"


def main() -> None:
    if not PT_PATH.is_file():
        raise SystemExit(f"模型不存在: {PT_PATH}")

    from ultralytics import YOLO

    model = YOLO(str(PT_PATH))
    exported = model.export(
        format="onnx",
        imgsz=1280,
        opset=17,
        dynamic=True,
        simplify=False,
        half=False,
        device="cpu",
    )
    exported_path = Path(exported)
    if exported_path.resolve() == OUT_PATH.resolve():
        print(f"已导出: {OUT_PATH}")
    else:
        shutil.move(str(exported_path), str(OUT_PATH))
        print(f"已导出并移动: {exported_path} -> {OUT_PATH}")

    size = OUT_PATH.stat().st_size
    print(f"文件大小: {size:,} 字节 ({size / 1048576:.1f} MB)")


if __name__ == "__main__":
    main()
