"""Style Skill 结构识别推理服务（ScreenParser，双后端）。

职责
----
- HTTP 模式（默认）：在 127.0.0.1 提供 GET /health 与 POST /detect，
  供前端开发模式调用。未来 Tauri 2 桌面版由后端负责启动、终止和
  管理本进程（sidecar），前端仅通过 HTTP 与之通信，不直接执行命令。
- CLI 模式（--cli <图片>）：单图推理，JSON 结果输出到 stdout，
  用于独立验证与脚本化测试。

后端选择（--backend 或环境变量 SCREENPARSER_BACKEND，默认 onnx）
----
- onnx（默认）：inference/onnx_detector.py，运行时依赖
  onnxruntime + numpy + opencv-python + pillow（无需 torch）。
  模型解析：SCREENPARSER_ONNX_MODEL > inference/models/best.onnx
  > poc/onnx-poc/best.onnx（dynamic 导出，双后端对比 116/116 全匹配）。
- pytorch（保留回退）：ultralytics，模型解析：SCREENPARSER_MODEL
  > inference/models/best.pt > poc/screenparser-poc/best.pt。

运行（开发模式，复用现有 venv）
----
    npm run detect:server                     # 默认 ONNX 后端
    npm run detect:server -- --backend pytorch  # 显式回退 PyTorch

API（两个后端契约完全一致）
----
GET  /health              -> {"ok": true, "available": bool, "backend": ..., "model": ..., "classes": 55}
POST /detect?conf=0.25&iou=0.10   请求体 = 图片二进制
                           -> {"ok": true, "image": {width, height},
                               "stats": {inference_seconds, conf, iou, model},
                               "detections": [{label, bbox_xyxy, confidence}, ...]}
                           错误 -> {"ok": false, "error": {code, message}}
                              400 invalid_image / bad_params
                              413 payload_too_large
                              500 inference_failed
                              503 model_unavailable
"""

import argparse
import io
import json
import os
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MAX_BODY_BYTES = 12 * 1024 * 1024
DEFAULT_PORT = 8765
DEFAULT_CONF = 0.25
DEFAULT_IOU = 0.10
BACKENDS = ("onnx", "pytorch")


class DetectionError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def resolve_model_path(backend: str):
    """按后端解析模型路径；返回 (path | None, 缺失时的提示信息)。"""
    if backend == "onnx":
        candidates = [
            os.environ.get("SCREENPARSER_ONNX_MODEL"),
            str(PROJECT_ROOT / "inference" / "models" / "best.onnx"),
            str(PROJECT_ROOT / "poc" / "onnx-poc" / "best.onnx"),
        ]
        hint = (
            "未找到 ONNX 模型：请设置 SCREENPARSER_ONNX_MODEL，或将 best.onnx"
            " 放到 inference/models/ 下（已验证的 dynamic 导出位于 poc/onnx-poc/best.onnx）。"
        )
    else:
        candidates = [
            os.environ.get("SCREENPARSER_MODEL"),
            str(PROJECT_ROOT / "inference" / "models" / "best.pt"),
            str(PROJECT_ROOT / "poc" / "screenparser-poc" / "best.pt"),
        ]
        hint = (
            "未找到 PyTorch 模型：请设置 SCREENPARSER_MODEL，或将 best.pt"
            " 放到 inference/models/ 下。"
        )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate), None
    return None, hint


class PyTorchBackend:
    """ultralytics 回退后端（保留原有推理入口，逻辑不变）。"""

    def __init__(self, model_path: Path, conf: float, iou: float):
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics 未安装：PyTorch 后端需要 ultralytics + torch"
                "（开发模式在 poc/screenparser-poc/.venv 中运行，或改用默认的 onnx 后端）"
            ) from exc
        self.model = YOLO(str(model_path))
        self.names = self.model.names
        self.path = model_path
        self.default_conf = conf
        self.default_iou = iou

    def detect(self, img, conf: float | None, iou: float | None) -> list[dict]:
        conf = self.default_conf if conf is None else conf
        iou = self.default_iou if iou is None else iou
        result = self.model.predict(
            img, imgsz=1280, conf=conf, iou=iou, device="cpu", verbose=False
        )[0]
        out = []
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            out.append(
                {
                    "label": self.names[int(box.cls[0])],
                    "bbox_xyxy": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                    "confidence": round(float(box.conf[0]), 3),
                }
            )
        out.sort(key=lambda d: -d["confidence"])
        return out


class OnnxBackend:
    """ONNX 正式后端：包装 inference/onnx_detector.py 的 OnnxDetector。"""

    def __init__(self, model_path: Path, conf: float, iou: float):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        try:
            from onnx_detector import OnnxDetector
        except ImportError as exc:
            raise RuntimeError(f"inference/onnx_detector.py 加载失败：{exc}") from exc
        self.detector = OnnxDetector(model_path, conf=conf, iou=iou)
        self.names = self.detector.names
        self.path = model_path

    def detect(self, img, conf: float | None, iou: float | None) -> list[dict]:
        import numpy as np

        return self.detector.detect_array(np.asarray(img), conf=conf, iou=iou)


class Detector:
    """线程安全的后端门面：懒加载；加载失败记录原因而不崩溃，便于前端区分错误。"""

    def __init__(self, backend: str):
        self.backend = backend
        self._lock = threading.Lock()
        self._impl = None
        self._error = None

    def ensure_loaded(self):
        with self._lock:
            if self._impl is not None or self._error is not None:
                return
            path, hint = resolve_model_path(self.backend)
            if path is None:
                self._error = ("model_unavailable", hint)
                return
            try:
                self._impl = (
                    OnnxBackend(path, DEFAULT_CONF, DEFAULT_IOU)
                    if self.backend == "onnx"
                    else PyTorchBackend(path, DEFAULT_CONF, DEFAULT_IOU)
                )
            except Exception as exc:
                self._error = ("model_unavailable", f"模型加载失败（{self.backend}）：{exc}")

    def status(self) -> dict:
        self.ensure_loaded()
        base = {"backend": self.backend}
        if self._impl is not None:
            return {
                "available": True,
                "model": str(self._impl.path),
                "classes": len(self._impl.names),
                **base,
            }
        code, message = self._error
        return {"available": False, "code": code, "message": message, **base}

    def detect_bytes(self, data: bytes, conf: float, iou: float) -> dict:
        self.ensure_loaded()
        if self._impl is None:
            code, message = self._error
            raise DetectionError(HTTPStatus.SERVICE_UNAVAILABLE, code, message)

        from PIL import Image, UnidentifiedImageError

        try:
            img = Image.open(io.BytesIO(data))
            img.load()
            img = img.convert("RGB")
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise DetectionError(
                HTTPStatus.BAD_REQUEST, "invalid_image", f"无法解码图片：{exc}"
            )

        started = time.perf_counter()
        try:
            detections = self._impl.detect(img, conf, iou)
        except Exception as exc:
            raise DetectionError(
                HTTPStatus.INTERNAL_SERVER_ERROR, "inference_failed", f"推理失败：{exc}"
            )
        elapsed = time.perf_counter() - started

        return {
            "ok": True,
            "image": {"width": img.width, "height": img.height},
            "stats": {
                "inference_seconds": round(elapsed, 2),
                "conf": conf,
                "iou": iou,
                "model": str(self._impl.path),
            },
            "detections": detections,
        }


DETECTOR = Detector("onnx")  # main() 中按参数/环境覆写


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class Handler(BaseHTTPRequestHandler):
    server_version = "StyleSkillDetect/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[detect] %s\n" % (fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(int(status))
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True, **DETECTOR.status()})
        else:
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "error": {"code": "not_found", "message": "未知路径"}},
            )

    def do_POST(self):
        if urlparse(self.path).path != "/detect":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "error": {"code": "not_found", "message": "未知路径"}},
            )
            return

        query = parse_qs(urlparse(self.path).query)
        try:
            conf = clamp(float(query.get("conf", [str(DEFAULT_CONF)])[0]), 0.01, 1.0)
            iou = clamp(float(query.get("iou", [str(DEFAULT_IOU)])[0]), 0.01, 1.0)
        except ValueError:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": {"code": "bad_params", "message": "conf/iou 参数无效"}},
            )
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": {"code": "invalid_image", "message": "请求体为空"}},
            )
            return
        if length > MAX_BODY_BYTES:
            # 先读取并丢弃请求体再应答，避免客户端仍在发送时连接被中止
            remaining = min(length, 64 * 1024 * 1024)
            while remaining > 0:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {
                    "ok": False,
                    "error": {
                        "code": "payload_too_large",
                        "message": f"图片超过 {MAX_BODY_BYTES // 1024 // 1024} MB 上限",
                    },
                },
            )
            return

        data = self.rfile.read(length)
        try:
            payload = DETECTOR.detect_bytes(data, conf, iou)
        except DetectionError as exc:
            self._send_json(
                exc.status, {"ok": False, "error": {"code": exc.code, "message": exc.message}}
            )
            return
        except Exception as exc:  # 兜底：任何未预期异常都不能让服务崩溃
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": {"code": "internal", "message": str(exc)}},
            )
            return
        self._send_json(HTTPStatus.OK, payload)


def run_cli(image_path: str) -> int:
    path = Path(image_path)
    if not path.is_file():
        print(
            json.dumps(
                {"ok": False, "error": {"code": "invalid_image", "message": f"文件不存在：{path}"}},
                ensure_ascii=False,
            )
        )
        return 3
    try:
        payload = DETECTOR.detect_bytes(path.read_bytes(), DEFAULT_CONF, DEFAULT_IOU)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except DetectionError as exc:
        print(
            json.dumps(
                {"ok": False, "error": {"code": exc.code, "message": exc.message}},
                ensure_ascii=False,
            )
        )
        return {"model_unavailable": 2, "invalid_image": 3}.get(exc.code, 4)


def main():
    parser = argparse.ArgumentParser(description="Style Skill 结构识别推理服务")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--backend",
        choices=BACKENDS,
        default=os.environ.get("SCREENPARSER_BACKEND", "onnx"),
        help="推理后端（默认 onnx；环境变量 SCREENPARSER_BACKEND 可覆盖）",
    )
    parser.add_argument("--cli", metavar="IMAGE", help="单图推理模式：结果输出到 stdout")
    args = parser.parse_args()

    global DETECTOR  # noqa: PLW0603
    DETECTOR = Detector(args.backend)

    if args.cli:
        sys.exit(run_cli(args.cli))

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    status = DETECTOR.status()
    print(
        f"[detect] http://127.0.0.1:{args.port}  backend: {args.backend}  model: {status}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[detect] stopped", flush=True)


if __name__ == "__main__":
    main()
