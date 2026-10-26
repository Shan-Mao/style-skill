"""Style Skill PoC 批量检测：5 张测试图 × conf{0.25 主, 0.10 对照}。

对每张图输出：
    out/<图名>.conf25.json   统一 DetectedElement 结构（含 children 层级）
    out/<图名>.conf10.json   对照阈值结果
    out/<图名>.annotated.png 主阈值可视化标注图

层级推导：bbox 几何包含（子框面积 ≥85% 落在父框内，父框取最小包含者）。
"""

import json
import time
from collections import Counter
from pathlib import Path

import cv2
from ultralytics import YOLO

HERE = Path(__file__).parent
IMAGES_DIR = HERE / "test-images"
OUT_DIR = HERE / "out"
MODEL_PATH = HERE / "best.pt"

CONF_PRIMARY = 0.25
CONF_COMPARE = 0.10
IOU = 0.10
IMGSZ = 1280
CONTAINMENT_RATIO = 0.85

# 55 类中语义上属于“容器/区域”的类别：v2 为 leaf 标注，这些类若缺失，
# 几何层级将只能得到很浅的树 —— 这是本 PoC 要验证的关键假设。
CONTAINER_LABELS = {
    "Window", "Screen", "Navigation Bar", "Side Bar", "List", "Menu",
    "Table", "Toolbar", "Tab Bar", "Bottom navigation", "Breadcrumb",
    "Column/Browser",
}


def area(b):
    return max(1e-6, (b[2] - b[0]) * (b[3] - b[1]))


def containment_ratio(child, parent):
    cx1, cy1, cx2, cy2 = child
    px1, py1, px2, py2 = parent
    ix = max(0.0, min(cx2, px2) - max(cx1, px1))
    iy = max(0.0, min(cy2, py2) - max(cy1, py1))
    return (ix * iy) / area(child)


def build_hierarchy(boxes):
    """parent[i] = 包含第 i 个框的最小外框下标（无则 -1）。"""
    n = len(boxes)
    areas = [area(b) for b in boxes]
    parent = [-1] * n
    for i in range(n):
        best = -1
        best_area = float("inf")
        for j in range(n):
            if i == j or areas[j] <= areas[i] + 1e-6:
                continue
            if containment_ratio(boxes[i], boxes[j]) >= CONTAINMENT_RATIO:
                if areas[j] < best_area:
                    best = j
                    best_area = areas[j]
        parent[i] = best
    return parent


def compute_depths(parent):
    n = len(parent)

    def depth(i):
        d = 0
        while parent[i] != -1 and d < n:
            i = parent[i]
            d += 1
        return d

    return [depth(i) for i in range(n)]


def run_one(model, img_path, conf, image_id):
    t0 = time.perf_counter()
    result = model.predict(
        str(img_path), imgsz=IMGSZ, conf=conf, iou=IOU, device="cpu", verbose=False
    )[0]
    elapsed = time.perf_counter() - t0

    dets = []
    for box in result.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        dets.append(
            {
                "label": model.names[int(box.cls[0])],
                "bbox_xyxy": [round(v, 1) for v in (x1, y1, x2, y2)],
                "confidence": round(float(box.conf[0]), 3),
            }
        )
    dets.sort(key=lambda d: d["confidence"], reverse=True)

    boxes = [d["bbox_xyxy"] for d in dets]
    parent = build_hierarchy(boxes)
    dep = compute_depths(parent)

    nodes = []
    for i, d in enumerate(dets):
        x1, y1, x2, y2 = d["bbox_xyxy"]
        nodes.append(
            {
                "id": f"{image_id}-el-{i + 1:03d}",
                "label": d["label"],
                "bbox": {
                    "x": round(x1, 1),
                    "y": round(y1, 1),
                    "width": round(x2 - x1, 1),
                    "height": round(y2 - y1, 1),
                },
                "confidence": d["confidence"],
            }
        )
    roots = []
    for i, node in enumerate(nodes):
        if parent[i] == -1:
            roots.append(node)
        else:
            nodes[parent[i]].setdefault("children", []).append(node)

    container_dets = [d["label"] for d in dets if d["label"] in CONTAINER_LABELS]
    report = {
        "sourceImageId": image_id,
        "imageSize": {
            "width": int(result.orig_shape[1]),
            "height": int(result.orig_shape[0]),
        },
        "detector": {
            "model": "ScreenParser v2 (best.pt)",
            "conf": conf,
            "iou": IOU,
            "imgsz": IMGSZ,
            "device": "cpu",
        },
        "stats": {
            "total": len(dets),
            "perClass": dict(Counter(d["label"] for d in dets).most_common()),
            "inferenceSeconds": round(elapsed, 2),
            "hierarchy": {
                "containmentPairs": sum(1 for p in parent if p != -1),
                "maxDepth": max(dep, default=0),
                "rootsWithChildren": sum(1 for r in roots if "children" in r),
                "containerClassDetections": dict(Counter(container_dets)),
            },
        },
        "elements": roots,
    }
    return report, result


def main():
    OUT_DIR.mkdir(exist_ok=True)
    model = YOLO(str(MODEL_PATH))
    images = sorted(IMAGES_DIR.glob("*.png"))
    summary = {}

    for img_path in images:
        image_id = img_path.stem
        summary[image_id] = {}
        for conf in (CONF_PRIMARY, CONF_COMPARE):
            report, result = run_one(model, img_path, conf, image_id)
            out_name = f"{image_id}.conf{int(conf * 100)}.json"
            (OUT_DIR / out_name).write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            if conf == CONF_PRIMARY:
                cv2.imwrite(
                    str(OUT_DIR / f"{image_id}.annotated.png"), result.plot()
                )
            summary[image_id][str(conf)] = report["stats"]
        print(f"done: {image_id}")

    (OUT_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
