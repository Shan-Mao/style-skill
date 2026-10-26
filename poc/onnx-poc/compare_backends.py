"""PyTorch 与 ONNX 双后端对比（误差评估方法见 README）。

用法（在 poc/screenparser-poc 目录下用其 venv 运行）：
    # 仅 PyTorch 基线（不需要 onnx 依赖）：
    .venv/Scripts/python.exe ../onnx-poc/compare_backends.py --pytorch-only
    # 完整对比（需要已导出 best.onnx + 安装 onnxruntime）：
    .venv/Scripts/python.exe ../onnx-poc/compare_backends.py

输出：poc/onnx-poc/report.json（或 --pytorch-only 时 report_pytorch_baseline.json）
"""

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

POC_DIR = Path(__file__).resolve().parent
TEST_DIR = POC_DIR.parent / "screenparser-poc" / "test-images"
PT_PATH = POC_DIR.parent / "screenparser-poc" / "best.pt"
ONNX_PATH = POC_DIR / "best.onnx"
TEMP = Path(tempfile.gettempdir())
# 推理实现上移至正式模块 inference/onnx_detector.py（单一实现，避免漂移）
sys.path.insert(0, str(POC_DIR.parent / "inference"))

CONF, IOU, IMGSZ = 0.25, 0.10, 1280
MATCH_IOU = 0.5
WARMUP, RUNS = 1, 3


def make_test_cases() -> list[dict]:
    """真实截图 + 缩放分辨率图 + 纯色空图 + 非法字节。"""
    cases = []
    for png in sorted(TEST_DIR.glob("*.png")):
        cases.append({"name": png.name, "path": str(png), "kind": "real"})
    small = TEMP / "github-home-small.png"
    if small.is_file():
        cases.append({"name": small.name, "path": str(small), "kind": "resized"})
    solid = TEMP / "onnx-solid.png"
    Image.new("RGB", (400, 300), (240, 240, 244)).save(solid)
    cases.append({"name": solid.name, "path": str(solid), "kind": "empty"})
    bad = TEMP / "onnx-notimg.png"
    bad.write_bytes(b"this is not an image")
    cases.append({"name": bad.name, "path": str(bad), "kind": "invalid"})
    return cases


_PT_MODEL = None


def get_pt_model():
    global _PT_MODEL
    if _PT_MODEL is None:
        from ultralytics import YOLO

        _PT_MODEL = YOLO(str(PT_PATH))
    return _PT_MODEL


def run_pytorch(path: str) -> list[dict]:
    model = get_pt_model()
    result = model.predict(
        path, imgsz=IMGSZ, conf=CONF, iou=IOU, device="cpu", verbose=False
    )[0]
    out = []
    for box in result.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        out.append(
            {
                "label": model.names[int(box.cls[0])],
                "bbox_xyxy": [round(v, 1) for v in (x1, y1, x2, y2)],
                "confidence": round(float(box.conf[0]), 3),
            }
        )
    out.sort(key=lambda d: -d["confidence"])
    return out


def run_onnx(detector, path: str) -> list[dict]:
    img = Image.open(path)
    img.load()
    return detector.detect_array(np.asarray(img.convert("RGB")))


def iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0


def compare_case(name: str, pt: list[dict], onnx: list[dict], img_w: int, img_h: int) -> dict:
    matched, missing, extra = [], [], []
    used = [False] * len(onnx)
    for p in pt:
        best_j, best_iou = -1, MATCH_IOU
        for j, o in enumerate(onnx):
            if used[j] or o["label"] != p["label"]:
                continue
            v = iou(p["bbox_xyxy"], o["bbox_xyxy"])
            if v >= best_iou:
                best_j, best_iou = j, v
        if best_j >= 0:
            used[best_j] = True
            o = onnx[best_j]
            diffs = [abs(a - b) for a, b in zip(p["bbox_xyxy"], o["bbox_xyxy"])]
            matched.append(
                {
                    "label": p["label"],
                    "iou": round(best_iou, 3),
                    "coord_diff_px": [round(d, 2) for d in diffs],
                    "conf_diff": round(abs(p["confidence"] - o["confidence"]), 4),
                    "pt_conf": p["confidence"],
                }
            )
        else:
            missing.append({"label": p["label"], "conf": p["confidence"]})
    for j, o in enumerate(onnx):
        if not used[j]:
            extra.append({"label": o["label"], "conf": o["confidence"]})

    all_diffs = [d for m in matched for d in m["coord_diff_px"]]
    long_side = max(img_w, img_h)
    return {
        "image": name,
        "n_pt": len(pt),
        "n_onnx": len(onnx),
        "matched": len(matched),
        "missing_pt_only": missing,
        "extra_onnx_only": extra,
        "coord_diff_px_mean": round(float(np.mean(all_diffs)), 3) if all_diffs else 0,
        "coord_diff_px_max": round(float(np.max(all_diffs)), 3) if all_diffs else 0,
        "coord_diff_pct_mean": round(float(np.mean(all_diffs)) / long_side * 100, 3) if all_diffs else 0,
        "conf_diff_mean": round(float(np.mean([m["conf_diff"] for m in matched])), 4) if matched else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pytorch-only", action="store_true", help="仅生成 PyTorch 基线")
    args = parser.parse_args()

    cases = make_test_cases()
    report = {"params": {"conf": CONF, "iou": IOU, "imgsz": IMGSZ, "match_iou": MATCH_IOU}, "cases": []}

    detector = None
    if not args.pytorch_only:
        from onnx_detector import OnnxDetector  # noqa: PLC0415

        if not ONNX_PATH.is_file():
            raise SystemExit(f"缺少 {ONNX_PATH}，请先运行 export_onnx.py")
        detector = OnnxDetector(ONNX_PATH, conf=CONF, iou=IOU)

    for case in cases:
        name, path, kind = case["name"], case["path"], case["kind"]
        entry = {"image": name, "kind": kind}

        # 非法图片：两后端都应报错而不是崩溃
        if kind == "invalid":
            for backend, fn in (("pytorch", run_pytorch), ("onnx", (lambda p: run_onnx(detector, p)) if detector else None)):
                if fn is None:
                    continue
                try:
                    fn(path)
                    entry[f"{backend}_invalid"] = "NO-ERROR(异常！)"
                except Exception as exc:
                    entry[f"{backend}_invalid"] = f"rejected({type(exc).__name__})"
            report["cases"].append(entry)
            continue

        img = Image.open(path)
        entry["size"] = f"{img.width}x{img.height}"

        # PyTorch
        run_pytorch(path)  # 预热
        t0 = time.perf_counter()
        for _ in range(RUNS):
            pt = run_pytorch(path)
        entry["pytorch_ms"] = round((time.perf_counter() - t0) / RUNS * 1000, 1)
        entry["pytorch"] = pt

        if args.pytorch_only:
            report["cases"].append(entry)
            continue

        # ONNX
        run_onnx(detector, path)  # 预热
        t0 = time.perf_counter()
        for _ in range(RUNS):
            onnx_dets = run_onnx(detector, path)
        entry["onnx_ms"] = round((time.perf_counter() - t0) / RUNS * 1000, 1)
        entry["onnx"] = onnx_dets

        entry["comparison"] = compare_case(name, pt, onnx_dets, img.width, img.height)
        report["cases"].append(entry)

    out_path = POC_DIR / ("report_pytorch_baseline.json" if args.pytorch_only else "report.json")
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # 摘要
    print(f"\n已写入 {out_path}")
    for c in report["cases"]:
        line = f"{c['image']:<28} {c.get('size', ''):<10} pt={c.get('pytorch_ms', '-')}ms"
        if "comparison" in c:
            k = c["comparison"]
            line += (
                f" onnx={c['onnx_ms']}ms | matched {k['matched']}/{k['n_pt']}"
                f" miss {len(k['missing_pt_only'])} extra {len(k['extra_onnx_only'])}"
                f" | Δcoord mean {k['coord_diff_px_mean']}px/{k['coord_diff_pct_mean']}%"
                f" max {k['coord_diff_px_max']}px | Δconf {k['conf_diff_mean']}"
            )
        print(line)


if __name__ == "__main__":
    main()
