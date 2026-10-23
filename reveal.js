import { mulberry32 } from './wood.js'

// The scene revealed as the page opens: the loader's cover, in the page's
// background colour, opens in a circle from the tree, its edge ragged with
// Perlin noise that churns as it grows and lit by a crisp bright line with a
// soft glow inside it, like a theme's sweep. The loader's sticker pops away
// as it starts, and the tree springs up through the hole. Drawn on a 2D
// canvas over the scene's, so it's the same on either renderer

const SECONDS = 1.4 // the circle opening until it's past every corner
const RAGGED = 0.07 // how far the noise pushes the edge in and out, of the screen's diagonal
const POINTS = 240 // round the edge
const LINE = 3 // the bright line's width, in CSS pixels
const GLOW = 18 // the glow's width inside it
const LIGHT = 0.9 // how close to white the line gets; the glow a quarter that
const APPEAR_AT = 0.12 // of the opening, when the tree starts coming up
const LONGEST_STEP = 1 / 30 // seconds a frame moves it on at most, so a stall slows it rather than skipping it

// Perlin's improved noise in 2D, about -1 to 1, its gradients shuffled from a
// seed of its own
const PERM = (() => {
  const random = mulberry32(1)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  return [...p, ...p]
})()
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t
const grad = (hash, x, y) => (hash & 1 ? -x : x) + (hash & 2 ? -y : y)
function perlin(x, y) {
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  x -= Math.floor(x)
  y -= Math.floor(y)
  const u = fade(x)
  const v = fade(y)
  const a = PERM[X] + Y
  const b = PERM[X + 1] + Y
  return lerp(lerp(grad(PERM[a], x, y), grad(PERM[b], x - 1, y), u), lerp(grad(PERM[a + 1], x, y - 1), grad(PERM[b + 1], x - 1, y - 1), u), v)
}

// How far the edge is pushed at an angle, -1 to 1: two octaves, read round a
// circle so it closes up, drifting with time
function ragged(angle, seconds) {
  const x = Math.cos(angle)
  const y = Math.sin(angle)
  return perlin(x * 1.7 + seconds * 0.9, y * 1.7 - seconds * 0.6) * 0.65 + perlin(x * 4.3 - seconds * 1.3, y * 4.3 + 7.1) * 0.35
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// Opens the loader from x, y in CSS pixels, then takes it away. onAppear
// brings the tree up, a moment in. With less motion asked for, the loader
// just fades as the tree comes up, as it does for every new one
export function reveal(loader, { x, y, onAppear }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onAppear()
    loader.classList.add('done')
    loader.addEventListener('transitionend', () => loader.remove(), { once: true })
    return
  }

  const ratio = Math.min(devicePixelRatio, 2)
  const width = innerWidth
  const height = innerHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.className = 'cover'
  const ctx = canvas.getContext('2d')
  ctx.scale(ratio, ratio)
  // The cover takes the loader's colour, the page's background as the theme
  // has it, so nothing changes until the hole opens
  const color = getComputedStyle(document.body).backgroundColor
  loader.prepend(canvas)
  loader.style.background = 'transparent'
  loader.classList.add('opening')

  const diagonal = Math.hypot(width, height)
  const amplitude = RAGGED * diagonal
  // Far enough to clear the farthest corner, its ragged edge and all
  const farthest = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([cx, cy]) => Math.hypot(cx - x, cy - y)))
  const end = farthest + amplitude + GLOW

  const edge = (radius, seconds) => {
    ctx.beginPath()
    for (let i = 0; i <= POINTS; i++) {
      const angle = (i / POINTS) * Math.PI * 2
      // A small hole is less ragged, so it opens round, not torn
      const r = Math.max(radius + ragged(angle, seconds) * Math.min(amplitude, radius * 0.4), 0)
      const px = x + Math.cos(angle) * r
      const py = y + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  }

  let last = performance.now()
  let seconds = 0
  let appeared = false
  const frame = (now) => {
    seconds += Math.min(Math.max(now - last, 0) / 1000, LONGEST_STEP)
    last = now
    const t = Math.min(seconds / SECONDS, 1)
    if (!appeared && t >= APPEAR_AT) {
      appeared = true
      onAppear()
    }
    const radius = easeInOut(t) * end
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    edge(radius, seconds)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fill()
    // The glow just inside the edge, fading inwards in three steps, then
    // the line on it
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineJoin = 'round'
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = `rgba(255, 255, 255, ${LIGHT / 12})`
    for (const share of [1, 2 / 3, 1 / 3]) {
      ctx.lineWidth = GLOW * 2 * share
      ctx.stroke()
    }
    ctx.restore()
    ctx.strokeStyle = `rgba(255, 255, 255, ${LIGHT})`
    ctx.lineWidth = LINE
    ctx.stroke()
    if (t < 1) requestAnimationFrame(frame)
    else loader.remove()
  }
  requestAnimationFrame(frame)
}
