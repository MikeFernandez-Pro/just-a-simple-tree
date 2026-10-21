// How a GLB's textures are written, the leaves' cut-out and the impostor's
// atlas: as PNGs, every pixel as drawn, which any viewer opens. Anyone
// wanting another format converts them on their own.
//
// A canvas keeps no colour under alpha 0, so its transparent pixels come out
// black, and a texture shrunk into its mipmaps or filtered at a leaf's edge
// darkens there. The PNGs put a colour back under them

const BLEED = 4 // pixels the colour spreads out under the transparent ones, enough for the mipmaps a far tree shows

// A texture as a PNG, its Blob and its MIME type
export async function encodeTexture(texture) {
  const canvas = upright(texture)
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  bleed(pixels)
  return { blob: await rgbaPng(pixels), mimeType: 'image/png' }
}

// A texture's image the way up glTF wants it, its top row first: three
// draws one with flipY upside down
function upright(texture) {
  const { image, flipY } = texture
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (flipY) {
    ctx.translate(0, canvas.height)
    ctx.scale(1, -1)
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

// The pixels with no alpha within BLEED of one with some given its colour,
// spreading out a pixel at a time, and the rest the shown pixels' mean
// colour, flat so it costs next to nothing in the file
function bleed({ data, width, height }) {
  const count = width * height
  const queue = new Int32Array(count)
  const steps = new Uint16Array(count) // from the nearest shown pixel, plus 1; 0 while unfilled
  const sum = [0, 0, 0, 0]
  let tail = 0
  for (let i = 0; i < count; i++) {
    const alpha = data[i * 4 + 3]
    if (alpha === 0) continue
    steps[i] = 1
    queue[tail++] = i
    for (let c = 0; c < 3; c++) sum[c] += data[i * 4 + c] * alpha
    sum[3] += alpha
  }
  if (sum[3] === 0) return
  const spread = (from, to) => {
    if (steps[to]) return
    steps[to] = steps[from] + 1
    data[to * 4] = data[from * 4]
    data[to * 4 + 1] = data[from * 4 + 1]
    data[to * 4 + 2] = data[from * 4 + 2]
    queue[tail++] = to
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head]
    if (steps[i] > BLEED) continue
    const x = i % width
    if (x > 0) spread(i, i - 1)
    if (x < width - 1) spread(i, i + 1)
    if (i >= width) spread(i, i - width)
    if (i < count - width) spread(i, i + width)
  }
  const mean = sum.slice(0, 3).map((value) => Math.round(value / sum[3]))
  for (let i = 0; i < count; i++) if (!steps[i]) data.set(mean, i * 4)
}

// RGBA pixels as a PNG, each row filtered by whichever of PNG's five
// filters leaves the smallest sum, the usual guess at what deflates best
async function rgbaPng({ data, width, height }) {
  const stride = width * 4
  const rows = new Uint8Array((stride + 1) * height)
  const tries = Array.from({ length: 5 }, () => new Uint8Array(stride))
  for (let y = 0; y < height; y++) {
    const row = y * stride
    let best = 0
    let bestSum = Infinity
    tries.forEach((out, filter) => {
      let sum = 0
      for (let x = 0; x < stride; x++) {
        const left = x >= 4 ? data[row + x - 4] : 0
        const up = y > 0 ? data[row - stride + x] : 0
        const corner = x >= 4 && y > 0 ? data[row - stride + x - 4] : 0
        const guess = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner)
        const value = (data[row + x] - guess) & 255
        out[x] = value
        sum += value < 128 ? value : 256 - value
      }
      if (sum < bestSum) {
        bestSum = sum
        best = filter
      }
    })
    rows[y * (stride + 1)] = best
    rows.set(tries[best], y * (stride + 1) + 1)
  }
  return png(width, height, rows)
}

function paeth(left, up, corner) {
  const guess = left + up - corner
  const toLeft = Math.abs(guess - left)
  const toUp = Math.abs(guess - up)
  const toCorner = Math.abs(guess - corner)
  return toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner
}

// An RGBA PNG of width x height pixels, 8 bits a channel, its rows filtered
async function png(width, height, rows) {
  const header = new DataView(new ArrayBuffer(13))
  header.setUint32(0, width)
  header.setUint32(4, height)
  header.setUint8(8, 8)
  header.setUint8(9, 6)
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array(header.buffer)),
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ], { type: 'image/png' })
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// A PNG chunk: its length, type, data and the CRC of the type and data
function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i)
  bytes.set(data, 8)
  view.setUint32(8 + data.length, crc(bytes.subarray(4, 8 + data.length)))
  return bytes
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// A GLTFExporter plugin writing each texture as encoded, a Map from texture
// to { blob, mimeType }, instead of the PNG the exporter would draw: each
// image is put in the exporter's cache under the key it looks for, so it
// never draws its own
export function textureWriter(writer, encoded) {
  return {
    name: 'textureWriter',
    beforeParse() {
      const { json, cache, pending } = writer
      json.images ??= []
      for (const [texture, { blob, mimeType }] of encoded) {
        texture.userData.mimeType = mimeType
        const image = { mimeType }
        const index = json.images.push(image) - 1
        cache.images.set(texture.image, { [`${mimeType}:flipY/${texture.flipY}`]: index })
        pending.push(writer.processBufferViewImage(blob).then((view) => (image.bufferView = view)))
      }
    },
  }
}
