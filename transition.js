import { float, max, mix, mx_noise_float, screenSize, screenUV, smoothstep, step, time, uniform, vec2, vec3 } from 'three/tsl'

// A new theme sweeps over the screen from the bottom left corner to the top
// right one, along a true 45° diagonal, its front ragged with Perlin noise
// that churns as it goes and lit by a crisp bright line with a short glow
// trailing behind it. Every themed colour is drawn through the sweeps: the
// tree, its leaves and the falling ones, the floor's shadow and the
// background all change together, pixel by pixel.
//
// Sweeps stack: a theme picked while others are still sweeping sends its own
// front after theirs, each carrying on where it was, so picking fast never
// jumps. Each themed value is drawn as layers, the oldest at the bottom and
// the value itself on top, each layer showing where its front has passed

const SLOTS = 4 // sweeps on screen at once; a fifth finishes the oldest at once
const RAGGED = 0.05 // how far the noise pushes a front back and forth
const SOFT = 0.002 // a front's edge, barely softened
const LINE = 0.005 // the bright line's half width
const GLOW = 0.018 // how far the glow trails behind a front
const LIGHT = 0.9 // how close to white the line gets; the glow a quarter that

// Each slot's progress: 0 its old layer everywhere, 1 its own. The last slot
// is the newest sweep; free slots rest at 1
const wipes = Array.from({ length: SLOTS }, () => uniform(1))

// Where on the diagonal each pixel is, its ragged edge included: 0 at the
// bottom left corner, 1 at the top right one
const at = (() => {
  const aspect = screenSize.x.div(screenSize.y)
  // The screen with the height as 1 and y up, so the diagonal is at 45°
  const p = vec2(screenUV.x.mul(aspect), screenUV.y.oneMinus())
  const along = p.x.add(p.y).div(aspect.add(1))
  // Two octaves, drifting with time, so the edge keeps moving
  const q = p.mul(4.5).sub(time.mul(1.4))
  const noise = mx_noise_float(vec3(q, time.mul(0.7)))
    .mul(0.6)
    .add(mx_noise_float(vec3(q.mul(2.8), 3.1)).mul(0.4))
  return along.add(noise.mul(RAGGED))
})()

// Each slot's front: how far behind it a pixel is, past 0 once swept. It
// runs from before the corner to past the far one by the noise and the glow,
// so at rest neither shows anywhere
const behinds = wipes.map((wipe) => mix(-RAGGED - GLOW, 1 + RAGGED + GLOW, wipe).sub(at))
// 1 where a front has passed, 0 ahead of it
const reveals = behinds.map((behind) => smoothstep(-SOFT, SOFT, behind))
// The line on every front and the glow behind it, 0 elsewhere
const rim = behinds
  .map((behind) => max(smoothstep(LINE, LINE * 0.6, behind.abs()), smoothstep(GLOW, 0, behind).mul(step(0, behind)).mul(0.25)))
  .reduce((a, b) => max(a, b), float(0))
  .mul(LIGHT)

// The themed values, each with its layers under it: the bottom one, then one
// per slot but the last, which is the value itself
const themed = []

const copyOf = (value) => (typeof value === 'number' ? value : value.clone())

// A uniform as drawn: each layer where its front has passed, and a colour
// lit up by the fronts as they pass
export function swept(node) {
  const isNumber = typeof node.value === 'number'
  const layers = Array.from({ length: SLOTS }, () => uniform(copyOf(node.value)))
  themed.push({ node, layers })
  let shown = layers[0]
  for (let i = 0; i < SLOTS; i++) shown = mix(shown, i < SLOTS - 1 ? layers[i + 1] : node, reveals[i])
  return isNumber ? shown : mix(shown, vec3(1), rim)
}

// The background as a swept colour, the scene's own Color kept as the value
// the panel picks
export function sweptBackground(scene) {
  return vec3(swept(uniform(scene.background)))
}

const set = (layer, value) => (typeof value === 'number' ? (layer.value = value) : layer.value.copy(value))

// When each slot's sweep started, or null once it's done
const starts = Array(SLOTS).fill(null)
let seconds = 1
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2)
const easeInOutInverse = (w) => (w < 0.5 ? Math.sqrt(w / 2) : 1 - Math.sqrt(2 * (1 - w)) / 2)

// How far through a sweep, 0 to 1 of its time, its front reaches a point on
// the screen, given in normalised device coordinates (x right, y up, -1 to 1)
// with the screen's width / height. The same diagonal as `at`, its noise left
// out, so the front's ragged edge reaches it a touch either side
export function arrival(x, y, aspect) {
  const along = (((x + 1) / 2) * aspect + (y + 1) / 2) / (aspect + 1)
  const wipe = (along + RAGGED + GLOW) / (1 + 2 * (RAGGED + GLOW))
  return easeInOutInverse(Math.min(Math.max(wipe, 0), 1))
}

function frame(now) {
  for (let i = 0; i < SLOTS; i++) {
    if (starts[i] === null) continue
    const t = Math.min((now - starts[i]) / 1000 / seconds, 1)
    wipes[i].value = easeInOut(t)
    if (t === 1) starts[i] = null
  }
  if (starts.some((start) => start !== null)) requestAnimationFrame(frame)
}

// A new sweep, over the next second or so: call it before the themed values
// change, so what they are now stays drawn ahead of its front. Every sweep
// under way moves down a slot and carries on; the oldest, if every slot is
// busy, finishes at once
export function sweep(duration) {
  seconds = duration
  const running = starts.some((start) => start !== null)
  for (const { node, layers } of themed) {
    for (let i = 0; i < SLOTS - 1; i++) set(layers[i], layers[i + 1].value)
    set(layers[SLOTS - 1], node.value)
  }
  for (let i = 0; i < SLOTS - 1; i++) {
    wipes[i].value = wipes[i + 1].value
    starts[i] = starts[i + 1]
  }
  wipes[SLOTS - 1].value = 0
  starts[SLOTS - 1] = performance.now()
  if (!running) requestAnimationFrame(frame)
}
