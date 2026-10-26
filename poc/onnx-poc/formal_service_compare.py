"""正式服务双后端 HTTP 对比：ONNX(8765) vs PyTorch(8766)。

同时拉起两个 inference/screenparser_server.py 实例（默认 onnx / --backend pytorch），
对同一批图片逐项比较 /detect 输出：检测数量、匹配率（同类 IoU≥0.5）、漏检/误检、
坐标差、置信度差，以及冷启动（进程启动→/health OK）、首请求与热请求耗时。
另测：非法图片 400、超限（>12MB）413、/health 字段。

用法：
    # 默认：双后端都用 poc venv
    .venv/Scripts/python.exe ../onnx-poc/formal_service_compare.py
    # ONNX 用独立环境 inference/.venv（发布验证）：
    .venv/Scripts/python.exe ../onnx-poc/formal_service_compare.py \
        --onnx-python ../../inference/.venv/Scripts/python.exe
"""

import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

POC_DIR = Path(__file__).resolve().parent
PROJECT = POC_DIR.parent.parent  # 项目根
TEST_DIR = PROJECT / "poc" / "screenparser-poc" / "test-images"
TEMP = Path(tempfile.gettempdir())
PY = PROJECT / "poc" / "screenparser-poc" / ".venv" / "Scripts" / "python.exe"
SERVER = PROJECT / "inference" / "screenparser_server.py"
MATCH_IOU = 0.5
WARM_RUNS = 3


def wait_health(port: str, timeout: float = 120.0) -> tuple[float, dict]:
    started = time.perf_counter()
    deadline = started + timeout
    while time.perf_counter() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as r:
                data = json.loads(r.read().decode("utf-8"))
                return time.perf_counter() - started, data
        except Exception:
            time.sleep(0.3)
    raise TimeoutError(f"port {port} 健康检查超时")


def detect(port: str, image: Path) -> tuple[float, dict]:
    data = image.read_bytes()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/detect", data=data, headers={"Content-Type": "image/png"}
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=180) as r:
        payload = json.loads(r.read().decode("utf-8"))
    return (time.perf_counter() - t0) * 1000, payload


def detect_expect_error(port: str, body: bytes, content_type: str) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/detect", data=body, headers={"Content-Type": content_type}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


def compare(pt: list, onnx: list, long_side: int) -> dict:
    used = [False] * len(onnx)
    matched = []
    for p in pt:
        best_j, best_v = -1, MATCH_IOU
        for j, o in enumerate(onnx):
            if used[j] or o["label"] != p["label"]:
                continue
            v = iou(p["bbox_xyxy"], o["bbox_xyxy"])
            if v >= best_v:
                best_j, best_v = j, v
        if best_j >= 0:
            used[best_j] = True
            diffs = [abs(x - y) for x, y in zip(p["bbox_xyxy"], onnx[best_j]["bbox_xyxy"])]
            matched.append({"diffs": diffs, "conf": abs(p["confidence"] - onnx[best_j]["confidence"])})
    all_d = [d for m in matched for d in m["diffs"]]
    return {
        "n_pt": len(pt),
        "n_onnx": len(onnx),
        "matched": len(matched),
        "missing": len(pt) - len(matched),
        "extra": len(onnx) - len(matched),
        "coord_diff_max_px": max(all_d) if all_d else 0,
        "coord_diff_mean_pct": (sum(all_d) / len(all_d) / long_side * 100) if all_d else 0,
        "conf_diff_max": max((m["conf"] for m in matched), default=0),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx-python", default=str(PY), help="ONNX 服务使用的 Python 解释器")
    parser.add_argument("--pt-python", default=str(PY), help="PyTorch 服务使用的 Python 解释器")
    args = parser.parse_args()

    procs = {}
    report = {}
    try:
        for name, port, extra, python in (
            ("onnx", "8765", [], args.onnx_python),
            ("pytorch", "8766", ["--backend", "pytorch"], args.pt_python),
        ):
            procs[name] = subprocess.Popen(
                [python, str(SERVER), "--port", port, *extra],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            cold, health = wait_health(port)
            report[f"{name}_cold_start_s"] = round(cold, 2)
            report[f"{name}_health"] = health
        print(f"冷启动: onnx {report['onnx_cold_start_s']}s | pytorch {report['pytorch_cold_start_s']}s")
        print(
            f"health: onnx backend={report['onnx_health'].get('backend')}"
            f" model={Path(report['onnx_health'].get('model', '')).name}"
            f" | pytorch backend={report['pytorch_health'].get('backend')}"
        )

        images = sorted(TEST_DIR.glob("*.png"))
        small = TEMP / "github-home-small.png"
        if small.is_file():
            images.append(small)
        solid = TEMP / "onnx-solid.png"
        if solid.is_file():
            images.append(solid)

        first = True
        cases = []
        for img in images:
            entry = {"image": img.name}
            # 首请求（会话预热）只对第一张图分别记录
            ms_pt, p = detect("8766", img)
            ms_ox, o = detect("8765", img)
            if first:
                report["onnx_first_request_ms"] = round(ms_ox, 1)
                report["pytorch_first_request_ms"] = round(ms_pt, 1)
                first = False
            t0 = time.perf_counter()
            for _ in range(WARM_RUNS):
                _, p = detect("8766", img)
            entry["pytorch_warm_ms"] = round((time.perf_counter() - t0) / WARM_RUNS * 1000, 1)
            t0 = time.perf_counter()
            for _ in range(WARM_RUNS):
                _, o = detect("8765", img)
            entry["onnx_warm_ms"] = round((time.perf_counter() - t0) / WARM_RUNS * 1000, 1)
            long_side = max(p["image"]["width"], p["image"]["height"])
            entry["comparison"] = compare(p["detections"], o["detections"], long_side)
            cases.append(entry)
            c = entry["comparison"]
            print(
                f"{img.name:<26} pt={c['n_pt']:>2} onnx={c['n_onnx']:>2} matched={c['matched']:>2} "
                f"miss={c['missing']} extra={c['extra']} | Δcoord max {c['coord_diff_max_px']}px "
                f"({c['coord_diff_mean_pct']}%) | Δconf max {c['conf_diff_max']} | "
                f"warm pt={entry['pytorch_warm_ms']}ms onnx={entry['onnx_warm_ms']}ms"
            )
        report["cases"] = cases

        # 错误路径（ONNX 服务）
        code, body = detect_expect_error("8765", b"not an image", "image/png")
        report["invalid_http"] = {"status": code, "code": body.get("error", {}).get("code")}
        big = TEMP / "oversize.png"
        if not big.is_file():
            big.write_bytes(b"\x89PNG" + b"0" * (13 * 1024 * 1024))
        code, body = detect_expect_error("8765", big.read_bytes(), "image/png")
        report["oversize_http"] = {"status": code, "code": body.get("error", {}).get("code")}
        print(f"非法图片 HTTP: {report['invalid_http']} | 超限 HTTP: {report['oversize_http']}")

        out = POC_DIR / "formal_service_report.json"
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入 {out}")
    finally:
        for proc in procs.values():
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
