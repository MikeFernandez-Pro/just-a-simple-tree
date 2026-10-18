// How a GLB's textures are written, the leaves' cut-out and the impostor's
// atlas. Each format trades something:
// - png: every pixel as drawn, and any viewer opens it;
// - png 256 colors: still a PNG any viewer opens, its colours cut down to a
//   palette of 256, for a file a few times smaller. The cel bands come
//   through; the soft shading between them may band a little;
// - webp: a lossy WebP, its alpha kept lossless, in EXT_texture_webp.
//   Smaller again, but not every engine reads it. A browser that can't write
//   WebP, like Safari, writes a PNG instead;
// - ktx2 etc1s and ktx2 uastc: Basis Universal with its mipmaps, in
//   KHR_texture_basisu. The only ones that stay compressed on the GPU, so
//   they save memory as well as file size; the loader needs a transcoder,
//   as the README shows. ETC1S is the smallest file but loses detail in
//   blocky colour; UASTC keeps nearly every pixel for a file a few times
//   bigger, squeezed with Zstandard.
// Any but png must be read by a loader that knows its format, so the GLB
// marks it required.
//
// A canvas keeps no colour under alpha 0, so its transparent pixels come out
// black, and a texture shrunk into its mipmaps or filtered at a leaf's edge
// darkens there. The PNGs and KTX2s put a colour back under them, and the
// WebP encoder fills them in on its own, so every format shades the same

export const GLB_TEXTURES = ['png', 'png 256 colors', 'webp', 'ktx2 etc1s', 'ktx2 uastc']

const COLORS = 256 // a palette's entries, the most a PNG holds
const REFINE = 5 // rounds of k-means after the median cut, each moving the palette nearer its pixels
const ALPHA_WEIGHT = 2 // how much more alpha counts than a colour channel when matching, as it decides the cut-out
const WEBP_QUALITY = 0.9 // a lossy WebP's, from 0 to 1
const ETC1S_QUALITY = 192 // from 1 to 255
const UASTC_QUALITY = 2 // from 0 to 4, slower and closer to the original as it goes up
const BLEED = 4 // pixels the colour spreads out under the transparent ones, enough for the mipmaps a far tree shows; more costs a KTX2 a lot
const KTX2_MOST = 2048 // pixels a side a KTX2 is written at most, as the encoder takes no more than 12 million; a bigger texture is halved

// A texture as an image file in format, its Blob and its MIME type
export async function encodeTexture(texture, format) {
  const basis = format.startsWith('ktx2')
  const canvas = upright(texture, basis ? KTX2_MOST : Infinity)
  if (format === 'webp') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY))
    if (blob.type === 'image/webp') return { blob, mimeType: blob.type }
  }
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  if (format === 'png 256 colors') return { blob: await indexedPng(pixels), mimeType: 'image/png' }
  bleed(pixels)
  if (basis) return { blob: new Blob([await ktx2(pixels, format === 'ktx2 uastc')]), mimeType: 'image/ktx2' }
  return { blob: await rgbaPng(pixels), mimeType: 'image/png' }
}

// A texture's image the way up glTF wants it, its top row first: three
// draws one with flipY upside down. Halved until no side is over most
// pixels
function upright(texture, most) {
  const { image, flipY } = texture
  let scale = 1
  while (Math.max(image.width, image.height) * scale > most) scale /= 2
  const canvas = document.createElement('canvas')
  canvas.width = image.width * scale
  canvas.height = image.height * scale
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (flipY) {
    ctx.translate(0, canvas.height)
    ctx.scale(1, -1)
  }
  ctx.imageSmoothingQuality = 'high'
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

// ETC1S, or UASTC squeezed with Zstandard, in a KTX2 file, sRGB, with its
// mipmaps. The encoder, a few megabytes of WebAssembly, only loads the
// first time it's asked for
async function ktx2({ data, width, height }, uastc) {
  const { encodeToKTX2 } = await import('ktx2-encoder')
  return encodeToKTX2(new Uint8Array(0), {
    isUASTC: uastc,
    qualityLevel: ETC1S_QUALITY,
    uastcLDRQualityLevel: UASTC_QUALITY,
    needSupercompression: true,
    generateMipmap: true,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    imageDecoder: async () => ({ data, width, height }),
  })
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
  return png(width, height, 6, [], rows)
}

function paeth(left, up, corner) {
  const guess = left + up - corner
  const toLeft = Math.abs(guess - left)
  const toUp = Math.abs(guess - up)
  const toCorner = Math.abs(guess - corner)
  return toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner
}

// A PNG of width x height pixels of a colour type, 8 bits a channel or
// index, with chunks before its image data and its rows filtered
async function png(width, height, type, chunks, rows) {
  const header = new DataView(new ArrayBuffer(13))
  header.setUint32(0, width)
  header.setUint32(4, height)
  header.setUint8(8, 8)
  header.setUint8(9, type)
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array(header.buffer)),
    ...chunks,
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ], { type: 'image/png' })
}

// RGBA pixels as an indexed PNG, at most COLORS colours, with no dithering
// so flat bands stay flat. Every pixel with no alpha shares one entry, in
// the shown pixels' mean colour
async function indexedPng({ data, width, height }) {
  // The colours used and how often, each packed into a 32-bit key, the
  // transparent ones all as 0, and the shown ones' colours summed by alpha
  const counts = new Map()
  const keys = new Uint32Array(width * height)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const sum = [0, 0, 0, 0]
  for (let i = 0; i < keys.length; i++) {
    const alpha = data[i * 4 + 3]
    const key = alpha === 0 ? 0 : view.getUint32(i * 4)
    keys[i] = key
    counts.set(key, (counts.get(key) ?? 0) + 1)
    for (let c = 0; c < 3; c++) sum[c] += data[i * 4 + c] * alpha
    sum[3] += alpha
  }
  const colors = [...counts].map(([key, count]) => ({ rgba: unpack(key), count }))
  const palette = colors.length <= COLORS ? colors.map(({ rgba }) => rgba) : quantize(colors)
  // Transparent entries first, so the alpha table stops at the last of them
  palette.sort((a, b) => a[3] - b[3])
  const index = new Map()
  for (const [key] of counts) index.set(key, nearest(palette, unpack(key)))
  if (counts.has(0) && sum[3] > 0) palette[index.get(0)] = [...sum.slice(0, 3).map((value) => Math.round(value / sum[3])), 0]
  const rows = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = index.get(keys[y * width + x])
  }
  const opaqueFrom = palette.findIndex((rgba) => rgba[3] === 255)
  const alphas = palette.slice(0, opaqueFrom < 0 ? palette.length : opaqueFrom).map((rgba) => rgba[3])
  return png(width, height, 3, [
    chunk('PLTE', new Uint8Array(palette.flatMap(([r, g, b]) => [r, g, b]))),
    ...(alphas.length ? [chunk('tRNS', new Uint8Array(alphas))] : []),
  ], rows)
}

const unpack = (key) => [key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255]

function distance(a, b) {
  const r = a[0] - b[0]
  const g = a[1] - b[1]
  const bl = a[2] - b[2]
  const al = (a[3] - b[3]) * ALPHA_WEIGHT
  return r * r + g * g + bl * bl + al * al
}

function nearest(palette, rgba) {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < palette.length; i++) {
    const d = distance(palette[i], rgba)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

// COLORS colours standing for colors, each { rgba, count }: a median cut
// splits the box of colours with the most error in two along its widest
// channel until there are enough, then k-means moves each to the middle of
// the colours nearest it. The transparent colour keeps an entry of its own
function quantize(colors) {
  const clear = colors.filter(({ rgba }) => rgba[3] === 0)
  const shown = colors.filter(({ rgba }) => rgba[3] !== 0)
  const boxOf = (members) => ({ members, ...spread(members) })
  const boxes = [boxOf(shown)]
  while (boxes.length < COLORS - clear.length) {
    let worst = -1
    boxes.forEach((box, i) => {
      if (box.members.length > 1 && box.error > (boxes[worst]?.error ?? 0)) worst = i
    })
    if (worst < 0) break
    const { members, channel } = boxes[worst]
    members.sort((a, b) => a.rgba[channel] - b.rgba[channel])
    const half = members.reduce((sum, { count }) => sum + count, 0) / 2
    let at = 1
    for (let seen = members[0].count; at < members.length - 1 && seen + members[at].count < half; at++) seen += members[at].count
    boxes.splice(worst, 1, boxOf(members.slice(0, at)), boxOf(members.slice(at)))
  }
  let palette = boxes.map(({ members }) => mean(members))
  for (let round = 0; round < REFINE; round++) {
    const sums = palette.map(() => [0, 0, 0, 0, 0])
    for (const { rgba, count } of shown) {
      const sum = sums[nearest(palette, rgba)]
      for (let c = 0; c < 4; c++) sum[c] += rgba[c] * count
      sum[4] += count
    }
    palette = sums.map((sum, i) => (sum[4] ? sum.slice(0, 4).map((value) => Math.round(value / sum[4])) : palette[i]))
  }
  return [...clear.map(({ rgba }) => rgba), ...palette]
}

// Colours' weighted mean
function mean(members) {
  const sum = [0, 0, 0, 0]
  let total = 0
  for (const { rgba, count } of members) {
    for (let c = 0; c < 4; c++) sum[c] += rgba[c] * count
    total += count
  }
  return sum.map((value) => Math.round(value / total))
}

// Colours' squared error round their mean, and the channel they vary most in
function spread(members) {
  const centre = mean(members)
  const variance = [0, 0, 0, 0]
  for (const { rgba, count } of members) {
    for (let c = 0; c < 4; c++) variance[c] += (rgba[c] - centre[c]) ** 2 * count * (c === 3 ? ALPHA_WEIGHT ** 2 : 1)
  }
  const channel = variance.indexOf(Math.max(...variance))
  return { error: variance.reduce((a, b) => a + b), channel }
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
// never draws its own. A WebP the exporter puts in EXT_texture_webp itself
// from the texture's mimeType; a KTX2 is moved into KHR_texture_basisu here
export function textureWriter(writer, encoded) {
  return {
    name: 'KHR_texture_basisu',
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
    writeTexture(texture, def) {
      if (encoded.get(texture)?.mimeType !== 'image/ktx2') return
      def.extensions = { ...def.extensions, KHR_texture_basisu: { source: def.source } }
      delete def.source
      writer.extensionsUsed.KHR_texture_basisu = true
      writer.extensionsRequired.KHR_texture_basisu = true
    },
  }
}
