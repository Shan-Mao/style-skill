"""Style Skill 正式 ONNX 推理后端。

来源：由 poc/onnx-poc/onnx_detector.py 上移（该 PoC 已完成双后端对比，
116/116 检测完全匹配，见 poc/onnx-poc/README.md 与 report.json）。
PoC 对比脚本从本模块导入，避免两套实现漂移。

运行时依赖：onnxruntime、numpy、opencv-python（cv2.resize INTER_LINEAR）、
pillow——不依赖 torch / ultralytics / onnx（onnx 仅导出时需要）。

预处理与 ultralytics 对 .pt 的 predict 逐像素一致：最小矩形 LetterBox
（动态输入尺寸）→ RGB / CHW / /255 / float32；后处理为置信度过滤 +
按类 NMS（max_det=300）+ 去除 padding/ratio 的坐标还原。
"""

import ast
from pathlib import Path

import numpy as np

DEFAULT_CONF = 0.25
DEFAULT_IOU = 0.10
MAX_DET = 300


def _import_onnxruntime():
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError(
            "onnxruntime 未安装：ONNX 后端运行需要 onnxruntime"
            "（运行时依赖：onnxruntime、numpy、opencv-python、pillow）。"
            "开发模式请在 poc/screenparser-poc/.venv 中运行，"
            "独立环境安装见 docs/tauri-integration-plan.md。"
        ) from exc
    return ort


class OnnxDetector:
    """加载 dynamic 导出的 ScreenParser ONNX 模型并推理。

    Args:
        model_path: best.onnx 路径（须为 dynamic=True 导出，静态方形导出
            与 .pt 的最小矩形预处理不一致，构造时会显式报错）。
        conf / iou: 默认阈值；detect() 可按请求覆盖。
    """

    def __init__(self, model_path: str | Path, conf: float = DEFAULT_CONF, iou: float = DEFAULT_IOU):
        ort = _import_onnxruntime()
        try:
            import cv2  # noqa: F401
        except ImportError as exc:
            raise RuntimeError("opencv-python 未安装：ONNX 后端预处理依赖 cv2.resize") from exc

        self.default_conf = conf
        self.default_iou = iou
        self.sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name
        self.out_name = self.sess.get_outputs()[0].name

        meta = self.sess.get_modelmeta().custom_metadata_map
        imgsz = ast.literal_eval(meta.get("imgsz", "[1280, 1280]"))
        self.imgsz = int(imgsz[0])
        self.stride = int(ast.literal_eval(meta.get("stride", "32")) or 32)
        names_raw = meta.get("names", "{}")
        parsed = ast.literal_eval(names_raw)
        self.names = (
            {int(k): v for k, v in parsed.items()} if isinstance(parsed, dict) else dict(enumerate(parsed))
        )

        inp_shape = self.sess.get_inputs()[0].shape
        if all(isinstance(v, int) for v in inp_shape[2:]):
            raise RuntimeError(
                "该 ONNX 为静态尺寸导出，与 .pt 的最小矩形预处理不一致；"
                "请用 dynamic=True 重新导出（见 poc/onnx-poc/export_onnx.py）"
            )

    # ---- 预处理：最小矩形 LetterBox（与 ultralytics .pt predict 一致） ----

    def _letterbox(self, im_rgb: np.ndarray) -> tuple[np.ndarray, float, int, int]:
        import cv2

        ih, iw = im_rgb.shape[:2]
        r = min(self.imgsz / ih, self.imgsz / iw)
        # LetterBox(scaleup=True)：允许放大
        rh, rw = round(ih * r), round(iw * r)
        nh = round(rh / self.stride) * self.stride
        nw = round(rw / self.stride) * self.stride
        top = round((nh - rh) / 2 - 0.1)
        left = round((nw - rw) / 2 - 0.1)
        canvas = np.full((nh, nw, 3), 114, dtype=np.uint8)
        canvas[top : top + rh, left : left + rw] = cv2.resize(
            im_rgb, (rw, rh), interpolation=cv2.INTER_LINEAR
        )
        return canvas, r, top, left

    # ---- 后处理：置信度过滤 + 按类 NMS + 坐标还原 ----

    @staticmethod
    def _nms_per_class(
        boxes_xyxy: np.ndarray, scores: np.ndarray, cls_ids: np.ndarray, iou_thres: float
    ) -> list[int]:
        keep: list[int] = []
        for c in np.unique(cls_ids):
            idx = np.where(cls_ids == c)[0]
            order = idx[np.argsort(-scores[idx])]
            suppressed = np.zeros(len(order), dtype=bool)
            for i in range(len(order)):
                if suppressed[i]:
                    continue
                keep.append(int(order[i]))
                rest = order[i + 1 :]
                if len(rest) == 0:
                    continue
                xi1 = np.maximum(boxes_xyxy[order[i], 0], boxes_xyxy[rest, 0])
                yi1 = np.maximum(boxes_xyxy[order[i], 1], boxes_xyxy[rest, 1])
                xi2 = np.minimum(boxes_xyxy[order[i], 2], boxes_xyxy[rest, 2])
                yi2 = np.minimum(boxes_xyxy[order[i], 3], boxes_xyxy[rest, 3])
                inter = np.maximum(0, xi2 - xi1) * np.maximum(0, yi2 - yi1)
                area_a = (boxes_xyxy[order[i], 2] - boxes_xyxy[order[i], 0]) * (
                    boxes_xyxy[order[i], 3] - boxes_xyxy[order[i], 1]
                )
                area_b = (boxes_xyxy[rest, 2] - boxes_xyxy[rest, 0]) * (
                    boxes_xyxy[rest, 3] - boxes_xyxy[rest, 1]
                )
                iou = inter / np.maximum(area_a + area_b - inter, 1e-9)
                suppressed[i + 1 :] |= iou > iou_thres
        return keep

    def detect_array(
        self,
        im_rgb: np.ndarray,
        conf: float | None = None,
        iou: float | None = None,
    ) -> list[dict]:
        """对 RGB uint8 (H,W,3) 数组推理，返回与 PyTorch 后端同构的检测结果。"""
        conf = self.default_conf if conf is None else conf
        iou = self.default_iou if iou is None else iou
        ih, iw = im_rgb.shape[:2]
        canvas, r, top, left = self._letterbox(im_rgb)
        x = canvas.transpose(2, 0, 1)[None].astype(np.float32) / 255.0

        out = self.sess.run([self.out_name], {self.input_name: x})[0]
        pred = out[0] if out.ndim == 3 else out
        # ultralytics 导出为 (4+nc, N)；鲁棒处理 (N, 4+nc)
        if pred.shape[0] < pred.shape[1]:
            pred = pred.T

        boxes_xywh = pred[:, :4]
        class_scores = pred[:, 4:]
        cls_conf = class_scores.max(axis=1)
        cls_id = class_scores.argmax(axis=1)

        mask = cls_conf >= conf
        boxes_xywh = boxes_xywh[mask]
        confs = cls_conf[mask]
        clss = cls_id[mask]
        if len(confs) == 0:
            return []

        boxes = np.empty((len(confs), 4), dtype=np.float32)
        boxes[:, 0] = boxes_xywh[:, 0] - boxes_xywh[:, 2] / 2
        boxes[:, 1] = boxes_xywh[:, 1] - boxes_xywh[:, 3] / 2
        boxes[:, 2] = boxes_xywh[:, 0] + boxes_xywh[:, 2] / 2
        boxes[:, 3] = boxes_xywh[:, 1] + boxes_xywh[:, 3] / 2

        keep = self._nms_per_class(boxes, confs, clss, iou)
        keep = sorted(keep, key=lambda i: -confs[i])[:MAX_DET]

        detections = []
        for i in keep:
            # 去除 letterbox 的 padding 与缩放，裁剪回原图坐标（与 scale_boxes 一致）
            x1 = (boxes[i, 0] - left) / r
            y1 = (boxes[i, 1] - top) / r
            x2 = (boxes[i, 2] - left) / r
            y2 = (boxes[i, 3] - top) / r
            x1, x2 = min(max(x1, 0), iw), min(max(x2, 0), iw)
            y1, y2 = min(max(y1, 0), ih), min(max(y2, 0), ih)
            detections.append(
                {
                    "label": self.names[int(clss[i])],
                    "bbox_xyxy": [round(float(v), 1) for v in (x1, y1, x2, y2)],
                    "confidence": round(float(confs[i]), 3),
                }
            )
        detections.sort(key=lambda d: -d["confidence"])
        return detections
