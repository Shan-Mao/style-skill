/**
 * 结构特征判定边界的独立测试脚本。
 *
 * 运行方式（Node 24+ 原生支持 TS 类型剥离）：
 *   node scripts/test-structure-edges.ts
 *
 * 覆盖：对齐聚类容差边界、尺寸一致性阈值边界、用量覆盖阈值、
 * 空检测/单元素、跨分辨率归一化等价。阈值本身为经验值，
 * 本脚本锁定其当前行为，防止无意变更。
 */

import {
  compareStructures,
  extractStructureFeatures,
} from '../src/lib/structureFeatures.ts'
import type { DetectionSuccess } from '../src/lib/detectionClient.ts'

let passed = 0

function assert(name: string, condition: boolean) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`)
  }
  passed += 1
  console.log(`  ok  ${name}`)
}

function det(label: string, x: number, y: number, w: number, h: number) {
  return { label, confidence: 0.8, bbox: { x, y, width: w, height: h } }
}

function makeResult(width: number, height: number, detections: ReturnType<typeof det>[]) {
  return {
    ok: true,
    imageSize: { width, height },
    detections,
    stats: { inferenceSeconds: 1, conf: 0.25, iou: 0.1, model: 'test' },
  } as DetectionSuccess
}

console.log('1) 空检测与单元素')
{
  const empty = extractStructureFeatures(makeResult(1000, 800, []))
  assert('空检测: 0 元素/0 类别/0 对齐', empty.totalDetections === 0 && empty.classes.length === 0 && empty.alignments.length === 0)
  const single = extractStructureFeatures(makeResult(1000, 800, [det('Button', 100, 100, 80, 30)]))
  assert('单元素: 不产生对齐簇', single.alignments.length === 0)
}

console.log('2) 行对齐容差边界（2.5% 页高）')
{
  // 注：精确等于容差（cy 差恰为 0.025）时结果受浮点表示影响
  // （0.525-0.5 在二进制中略大于 0.025），因此用例取容差内侧/外侧的确定值
  const inside = extractStructureFeatures(
    makeResult(1000, 1000, [det('Text', 0, 490, 50, 20), det('Text', 200, 514, 50, 20)]),
  )
  const row = inside.alignments.find((a) => a.axis === 'row')
  assert('cy 差 2.4% → 聚为一行', row !== undefined && row.count === 2)
  const outside = extractStructureFeatures(
    makeResult(1000, 1000, [det('Text', 0, 490, 50, 20), det('Text', 200, 516, 50, 20)]),
  )
  assert('cy 差 2.6% → 不聚行', !outside.alignments.some((a) => a.axis === 'row'))
}

console.log('3) 列对齐容差边界（2% 页宽）')
{
  const inside = extractStructureFeatures(
    makeResult(1000, 1000, [det('Text', 290, 100, 20, 20), det('Text', 309, 400, 20, 20)]),
  )
  const col = inside.alignments.find((a) => a.axis === 'column')
  assert('cx 差 1.9% → 聚为一列', col !== undefined && col.count === 2)
  const outside = extractStructureFeatures(
    makeResult(1000, 1000, [det('Text', 290, 100, 20, 20), det('Text', 311, 400, 20, 20)]),
  )
  assert('cx 差 2.1% → 不聚列', !outside.alignments.some((a) => a.axis === 'column'))
}

console.log('4) 多行分离与簇大小')
{
  const features = extractStructureFeatures(
    makeResult(1000, 1000, [
      det('Link', 10, 195, 40, 10),
      det('Link', 100, 196, 40, 10),
      det('Link', 10, 795, 40, 10),
      det('Link', 100, 796, 40, 10),
      det('Link', 200, 797, 40, 10),
    ]),
  )
  const rows = features.alignments.filter((a) => a.axis === 'row')
  assert('两个分离行: 各成簇', rows.length === 2)
  assert('簇大小 2 与 3', rows.some((r) => r.count === 2) && rows.some((r) => r.count === 3))
}

console.log('5) 尺寸一致性阈值边界（各图平均宽度差 5% 页宽）')
{
  const atEdge = compareStructures([
    {
      fileName: 'a.png',
      features: extractStructureFeatures(
        makeResult(1000, 800, [det('Button', 0, 0, 90, 30), det('Button', 0, 100, 110, 30)]),
      ),
    },
    {
      fileName: 'b.png',
      features: extractStructureFeatures(makeResult(1000, 800, [det('Button', 0, 0, 150, 30)])),
    },
  ])
  assert('平均宽度差 = 5% → 尺寸模式成立', atEdge.patterns.some((p) => p.kind === 'size' && p.label === 'Button'))

  const overEdge = compareStructures([
    {
      fileName: 'a.png',
      features: extractStructureFeatures(
        makeResult(1000, 800, [det('Button', 0, 0, 90, 30), det('Button', 0, 100, 110, 30)]),
      ),
    },
    {
      fileName: 'b.png',
      features: extractStructureFeatures(makeResult(1000, 800, [det('Button', 0, 0, 151, 30)])),
    },
  ])
  assert('平均宽度差 5.1% → 无尺寸模式', !overEdge.patterns.some((p) => p.kind === 'size' && p.label === 'Button'))
}

console.log('6) 用量覆盖阈值（60%）')
{
  const three = compareStructures([
    { fileName: 'a.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 0, 40, 10), det('Link', 100, 0, 40, 10)])) },
    { fileName: 'b.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 0, 40, 10)])) },
    { fileName: 'c.png', features: extractStructureFeatures(makeResult(1000, 800, [])) },
  ])
  const usage = three.patterns.find((p) => p.kind === 'usage' && p.label === 'Link')
  assert('3 图中 2 图出现（≥ceil(60%)=2）→ 用量模式（部分覆盖）', usage !== undefined && usage.partial === true)

  const four = compareStructures([
    { fileName: 'a.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 0, 40, 10), det('Link', 100, 0, 40, 10)])) },
    { fileName: 'b.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 0, 40, 10), det('Link', 100, 0, 40, 10)])) },
    { fileName: 'c.png', features: extractStructureFeatures(makeResult(1000, 800, [])) },
    { fileName: 'd.png', features: extractStructureFeatures(makeResult(1000, 800, [])) },
  ])
  const usage4 = four.patterns.find((p) => p.kind === 'usage' && p.label === 'Link')
  assert('4 图中 2 图出现（<ceil(60%)=3）→ 降为「需要更多截图」', usage4 !== undefined && usage4.partial === true && usage4.text.includes('需要更多截图'))
}

console.log('7) 跨分辨率归一化等价（1280×800 vs 960×600）')
{
  const big = extractStructureFeatures(
    makeResult(1280, 800, [det('Button', 128, 240, 256, 48)]),
  )
  const small = extractStructureFeatures(
    makeResult(960, 600, [det('Button', 96, 180, 192, 36)]),
  )
  assert('归一化宽度相等', big.classes[0].widthNorm.avg === small.classes[0].widthNorm.avg)
  assert('归一化高度相等', big.classes[0].heightNorm.avg === small.classes[0].heightNorm.avg)
  assert('归一化中心相等', big.classes[0].centers[0].cx === small.classes[0].centers[0].cx)
}

console.log('8) 对齐模式跨图成立与单图不成立')
{
  const single = compareStructures([
    { fileName: 'a.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 400, 40, 10), det('Link', 100, 401, 40, 10), det('Link', 200, 402, 40, 10)])) },
  ])
  assert('单图: 不生成任何跨图模式', single.patterns.length === 0)

  const two = compareStructures([
    { fileName: 'a.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 400, 40, 10), det('Link', 100, 401, 40, 10), det('Link', 200, 402, 40, 10)])) },
    { fileName: 'b.png', features: extractStructureFeatures(makeResult(1000, 800, [det('Link', 0, 100, 40, 10), det('Link', 100, 101, 40, 10), det('Link', 200, 102, 40, 10), det('Link', 300, 103, 40, 10)])) },
  ])
  const align = two.patterns.find((p) => p.kind === 'alignment' && p.label === 'Link')
  assert('两图均有 Link 行 → 对齐模式（每行最多 4 个）', align !== undefined && align.maxCluster === 4 && align.imageCount === 2)
}

console.log(`\n全部通过：${passed} 项断言`)
