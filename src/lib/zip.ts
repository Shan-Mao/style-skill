/**
 * 最小 ZIP 生成器（无依赖，浏览器本地运行）。
 *
 * 采用 STORE（仅打包不压缩）方式，条目内容包括：
 * - 本地文件头 + 文件名（UTF-8，标志位 bit11）+ 内容
 * - 中央目录 + 结束记录
 * - 目录以「路径/ + 0 字节 + 目录属性」条目表示
 *
 * 时间戳固定（DOS 2021-01-01 00:00），保证同一输入生成完全相同的字节，
 * 便于测试与校验。
 */

export type ZipEntry = {
  /** 相对路径，目录条目以 / 结尾 */
  path: string
  /** 文件内容（UTF-8 文本；目录条目为空字符串） */
  content?: string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

// DOS 日期时间：2021-01-01 00:00:00
const DOS_TIME = 0
const DOS_DATE = ((2021 - 1980) << 9) | (1 << 5) | 1

const EXTERNAL_ATTRS_FILE = 0x81a40000 // Unix 0644
const EXTERNAL_ATTRS_DIR = 0x81000000 | 0x10 // Unix 0755 + DOS 目录位

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff])
}

function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of arrays) {
    out.set(a, pos)
    pos += a.length
  }
  return out
}

export function buildZipBlob(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  let count = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const data = encoder.encode(entry.content ?? '')
    const crc = crc32(data)
    const isDir = entry.path.endsWith('/')
    const external = isDir ? EXTERNAL_ATTRS_DIR : EXTERNAL_ATTRS_FILE
    const nameFlag = 0x0800 // UTF-8 文件名

    const local = concat(
      u32(0x04034b50), // local file header signature
      u16(20), // version needed
      u16(nameFlag),
      u16(0), // method: store
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(data.length), // compressed size
      u32(data.length), // uncompressed size
      u16(nameBytes.length),
      u16(0), // extra length
      nameBytes,
      data,
    )
    localParts.push(local)

    centralParts.push(
      concat(
        u32(0x02014b50), // central directory signature
        u16(20), // version made by
        u16(20), // version needed
        u16(nameFlag),
        u16(0),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0), // extra length
        u16(0), // comment length
        u16(0), // disk number start
        u16(0), // internal attrs
        u32(external),
        u32(offset),
        nameBytes,
      ),
    )

    offset += local.length
    count += 1
  }

  const centralSize = centralParts.reduce((a, c) => a + c.length, 0)
  const eocd = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(centralSize),
    u32(offset),
    u16(0),
  )

  const all = concat(...localParts, ...centralParts, eocd)
  // TS 6.0 中 Uint8Array 泛型为 ArrayBufferLike，需显式归一为 BlobPart
  const blobPart = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer
  return new Blob([blobPart], { type: 'application/zip' })
}
