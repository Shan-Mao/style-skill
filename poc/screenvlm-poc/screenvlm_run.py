"""Style Skill PoC: 用 ScreenVLM 对网页截图做完整屏幕解析。

输出 ScreenTag 结构化结果（嵌套层级 + 文本内容），与 ScreenParser 的
检测结果（平铺框 + 置信度）形成互补验证。

用法（在 poc/ 目录下，用 screenparser-poc 的 venv）:
    ../screenparser-poc/.venv/Scripts/python.exe screenvlm_run.py <图片路径> [--fp32]

输出:
    out/<图名>.screentag.txt   模型原始输出
    out/<图名>.vlm.json        解析后的 DetectedElement 结构（含 text 与 children）
    out/<图名>.vlm.annotated.png  可视化标注图（按层级着色）
"""

import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

import cv2
import torch

HERE = Path(__file__).parent
MODEL_DIR = HERE / "model"
OUT_DIR = HERE / "out"
NORM_SIZE = 500
MAX_NEW_TOKENS = 6192

try:
    from transformers import AutoModelForImageTextToText as ModelClass
except ImportError:
    from transformers import AutoModelForVision2Seq as ModelClass
from transformers import AutoProcessor

# 事件正则：开标签（紧随其后最多一次 4 连 loc token）/ 闭标签
# 形如 <button><loc_10><loc_20><loc_50><loc_35> 中，4 个 loc token 作为
# group(3) 与开标签一次匹配完，避免被误识别为独立元素
TOKEN_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9_]*)>((?:<loc_\d+>){4})?")


def parse_screentag(text, img_w, img_h):
    """把 ScreenTag 输出解析为嵌套元素树。loc 坐标按 [0,500] 归一化转像素。"""
    root = {"tag": "root", "children": []}
    stack = [root]
    counter = [0]

    def to_px(v, size):
        return round(max(0, min(int(v), NORM_SIZE)) / NORM_SIZE * size, 1)

    for m in TOKEN_RE.finditer(text):
        closing, tag, locs = m.group(1), m.group(2), m.group(3)
        if closing:
            # 弹栈到匹配的标签
            for i in range(len(stack) - 1, 0, -1):
                if stack[i]["tag"] == tag:
                    del stack[i:]
                    break
            continue
        if re.fullmatch(r"loc_\d+", tag):
            continue  # 游离的 loc token（格式异常时的防御）
        node = {"tag": tag, "children": [], "text": ""}
        if locs:
            nums = re.findall(r"<loc_(\d+)>", locs)
            l, t, r, b = (int(n) for n in nums[:4])
            if r < l:
                l, r = r, l
            if b < t:
                t, b = b, t
            node["bbox"] = {
                "x": to_px(l, img_w),
                "y": to_px(t, img_h),
                "width": to_px(r - l, img_w),
                "height": to_px(b - t, img_h),
            }
        # 该开标签后、下一个标签前的文本属于当前节点
        after = text[m.end():]
        nxt = TOKEN_RE.search(after)
        chunk = after[: nxt.start()] if nxt else after
        node["text"] = chunk.strip()
        counter[0] += 1
        node["id"] = f"vlm-el-{counter[0]:03d}"
        stack[-1]["children"].append(node)
        stack.append(node)

    # 解包最外层 <screentag> 包裹（文档包装，不是 UI 元素）
    top = root["children"]
    if len(top) == 1 and top[0]["tag"] == "screentag":
        root = top[0]
    return root


def to_detected(node, depth=0, stats=None):
    """转换为 DetectedElement 结构（无置信度字段——生成式模型不提供）。"""
    if stats is None:
        stats = {"count": 0, "withText": 0, "maxDepth": 0}
    out = []
    for child in node.get("children", []):
        el = {
            "id": child["id"],
            "label": child["tag"],
            "bbox": child.get("bbox"),
            "text": child.get("text") or None,
        }
        stats["count"] += 1
        if el["text"]:
            stats["withText"] += 1
        stats["maxDepth"] = max(stats["maxDepth"], depth + 1)
        children = to_detected(child, depth + 1, stats)
        if children:
            el["children"] = children
        out.append(el)
    return out


def draw_annotated(image_path, elements, out_path):
    img = cv2.imread(str(image_path))
    colors = [(80, 200, 80), (60, 200, 240), (200, 160, 60), (200, 100, 200)]

    def draw(els, depth):
        for el in els:
            b = el.get("bbox")
            if b:
                c = colors[depth % len(colors)]
                x, y = int(b["x"]), int(b["y"])
                w, h = int(b["width"]), int(b["height"])
                cv2.rectangle(img, (x, y), (x + w, y + h), c, 1)
                cv2.putText(
                    img, el["label"], (x, max(10, y - 3)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, c, 1, cv2.LINE_AA,
                )
            draw(el.get("children", []), depth + 1)

    draw(elements, 0)
    cv2.imwrite(str(out_path), img)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    fp32 = "--fp32" in sys.argv
    if len(args) != 1:
        sys.exit("用法: screenvlm_run.py <图片路径> [--fp32]")
    image_path = Path(args[0])
    if not image_path.is_file():
        sys.exit(f"图片不存在: {image_path}")

    OUT_DIR.mkdir(exist_ok=True)
    image_id = image_path.stem

    t0 = time.perf_counter()
    processor = AutoProcessor.from_pretrained(str(MODEL_DIR))
    dtype = torch.float32 if fp32 else torch.bfloat16
    model = ModelClass.from_pretrained(
        str(MODEL_DIR), dtype=dtype, attn_implementation="sdpa"
    )
    model.eval()
    load_seconds = time.perf_counter() - t0
    print(f"model loaded in {load_seconds:.1f}s (dtype={dtype})")

    from transformers.image_utils import load_image

    image = load_image(str(image_path))
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": "Generate the screen representation for this UI:"},
            ],
        }
    ]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(text=prompt, images=[image], return_tensors="pt")

    t0 = time.perf_counter()
    with torch.inference_mode():
        generated = model.generate(
            **inputs, max_new_tokens=MAX_NEW_TOKENS, use_cache=True
        )
    gen_seconds = time.perf_counter() - t0
    prompt_len = inputs.input_ids.shape[1]
    new_tokens = int(generated.shape[1] - prompt_len)
    output = processor.batch_decode(
        generated[:, prompt_len:], skip_special_tokens=False
    )[0].lstrip()

    (OUT_DIR / f"{image_id}.screentag.txt").write_text(output, encoding="utf-8")

    w, h = image.size
    root = parse_screentag(output, w, h)
    stats = {"count": 0, "withText": 0, "maxDepth": 0}
    elements = to_detected(root, 0, stats)

    labels = Counter()

    def collect(els):
        for el in els:
            labels[el["label"]] += 1
            collect(el.get("children", []))

    collect(elements)

    report = {
        "sourceImageId": image_id,
        "imageSize": {"width": w, "height": h},
        "detector": {
            "model": "ScreenVLM v2",
            "dtype": "fp32" if fp32 else "bf16",
            "maxNewTokens": MAX_NEW_TOKENS,
            "device": "cpu",
        },
        "stats": {
            "totalElements": stats["count"],
            "withText": stats["withText"],
            "maxDepth": stats["maxDepth"],
            "newTokens": new_tokens,
            "modelLoadSeconds": round(load_seconds, 1),
            "generationSeconds": round(gen_seconds, 1),
            "tokensPerSecond": round(new_tokens / gen_seconds, 1) if gen_seconds else None,
            "perClass": dict(labels.most_common()),
        },
        "elements": elements,
    }
    (OUT_DIR / f"{image_id}.vlm.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    draw_annotated(image_path, elements, OUT_DIR / f"{image_id}.vlm.annotated.png")

    print(json.dumps(report["stats"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
