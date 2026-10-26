"""Style Skill PoC: 用 ScreenParser 对单张网页截图做 UI 元素检测。

用法（在 poc/screenparser-poc 目录下）:
    .venv/Scripts/python.exe detect.py <图片路径>

输出:
    out/annotated.png     可视化标注图
    out/detections.json   检测结果（类别、边界框、置信度、耗时）
"""

import json
import sys
import time
from collections import Counter
from pathlib import Path

from ultralytics import YOLO

HERE = Path(__file__).parent
MODEL_PATH = HERE / "best.pt"
OUT_DIR = HERE / "out"


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("用法: detect.py <图片路径>")
    image_path = Path(sys.argv[1])
    if not image_path.is_file():
        sys.exit(f"图片不存在: {image_path}")
    if not MODEL_PATH.is_file():
        sys.exit(f"模型不存在: {MODEL_PATH}（先从 hf-mirror 下载 best.pt）")

    OUT_DIR.mkdir(exist_ok=True)

    t0 = time.perf_counter()
    model = YOLO(str(MODEL_PATH))
    load_seconds = time.perf_counter() - t0

    kwargs = dict(imgsz=1280, conf=0.10, iou=0.10, device="cpu", verbose=False)

    t0 = time.perf_counter()
    results = model.predict(str(image_path), **kwargs)
    cold_seconds = time.perf_counter() - t0

    t0 = time.perf_counter()
    results = model.predict(str(image_path), **kwargs)
    warm_seconds = time.perf_counter() - t0

    result = results[0]
    detections = []
    for box in result.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        detections.append(
            {
                "label": model.names[int(box.cls[0])],
                "bbox_xyxy": [round(v, 1) for v in (x1, y1, x2, y2)],
                "confidence": round(float(box.conf[0]), 3),
            }
        )
    detections.sort(key=lambda d: d["confidence"], reverse=True)

    import cv2

    cv2.imwrite(str(OUT_DIR / "annotated.png"), result.plot())

    report = {
        "image": image_path.name,
        "image_size_wxh": [int(result.orig_shape[1]), int(result.orig_shape[0])],
        "device": "cpu",
        "model_load_seconds": round(load_seconds, 2),
        "inference_cold_seconds": round(cold_seconds, 2),
        "inference_warm_seconds": round(warm_seconds, 2),
        "total_detections": len(detections),
        "per_class": dict(Counter(d["label"] for d in detections).most_common()),
        "detections": detections,
    }
    (OUT_DIR / "detections.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(
        json.dumps(
            {k: report[k] for k in report if k != "detections"},
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"\n前 10 个高置信度检测:")
    for d in detections[:10]:
        print(f"  {d['label']:<18} conf={d['confidence']:.3f}  bbox={d['bbox_xyxy']}")


if __name__ == "__main__":
    main()
