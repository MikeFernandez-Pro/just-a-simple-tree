import * as THREE from 'three/webgpu'
import { cameraPosition, cos, dot, float, fract, mix, normalize, positionWorld, smoothstep, step, time, uniform, vec3 } from 'three/tsl'

// While an image is dragged over the page, the tree turns into a hologram
// waiting for it: its cel bands kept, but tinted cyan and washed with a
// rainbow that shifts with height, with the angle it's seen at and with
// time, its edges glowing, and bright scan lines climbing it. It eases in
// and out, and is drawn after tone mapping, so the colours come out as picked.
//
// Once the image lands, a bright line scans up the tree from the ground,
// and the tree below it is the real one again, wearing its new leaves,
// while above it the hologram still wears the old ones

const EASE = 9 // how fast it eases in and out, per second
const TINT = [0.35, 0.95, 1] // the hologram's own colour, under the rainbow
const RAINBOW = 0.55 // how much of the rainbow shows over the tint
const HUE_SPREAD = 0.35 // rainbows per metre up the tree
const HUE_TURN = 0.8 // rainbows from facing the camera to edge on
const HUE_DRIFT = 0.12 // rainbows per second the hues climb by
const RIM = 1.2 // how bright the edges glow
const LINES = 14 // scan lines per metre
const LINE_WIDTH = 0.18 // a scan line / the gap from one to the next
const LINE_SPEED = 1.5 // scan lines a second climbing past a point
const LINE_LIGHT = 0.3 // what a scan line adds
const SHINE_GAP = 4 // metres between the bright bands sweeping up
const SHINE_SPEED = 0.6 // of those gaps a second
const SHINE_LIGHT = 0.5 // what a band adds at its brightest
const SCAN_SECONDS = 1.4 // the scan from the ground to the top
const SCAN_MARGIN = 0.3 // metres the scan starts below the ground and ends above the top, so its glow comes in and goes out off the tree
const SCAN_LINE = 0.03 // metres: the scan's hard bright line
const SCAN_GLOW = 0.35 // metres: its glow trailing under it, as the hologram fades into the tree
const SCAN_LIGHT = [0.8, 1, 1] // the line's colour

// 0 the tree as it is, 1 all hologram
export const hologram = uniform(0)
// While a scan climbs, 1, and the height it has reached, in metres: the
// tree below it is updated, the hologram above it. At rest it's far below,
// leaving the hologram everywhere it's on
const scanning = uniform(0)
const front = uniform(-1e4)
// 1 where the tree has its new leaves: anywhere but above a climbing scan
export const updated = float(positionWorld.y.lessThan(front)).max(scanning.oneMinus())

let wanted = 0
let last = 0
let scan = null // { start, top } while one climbs
export function showHologram(on) {
  if (!scan) wanted = on ? 1 : 0
}

// Scans up a tree top metres tall: the hologram comes on, if it wasn't,
// and the scan clears it away as it climbs
export function scanUp(top) {
  scan = { start: performance.now(), top }
  scanning.value = 1
  front.value = -SCAN_MARGIN
  wanted = 1
}

export function updateHologram(now) {
  const seconds = Math.min((now - last) / 1000, 0.1)
  last = now
  hologram.value += (wanted - hologram.value) * (1 - Math.exp(-seconds * EASE))
  if (Math.abs(wanted - hologram.value) < 1e-3) hologram.value = wanted
  if (!scan) return
  const t = Math.min((now - scan.start) / 1000 / SCAN_SECONDS, 1)
  const eased = t * t * (3 - 2 * t)
  front.value = THREE.MathUtils.lerp(-SCAN_MARGIN, scan.top + SCAN_MARGIN, eased)
  if (t < 1) return
  // Past the top: nothing left to clear
  scan = null
  scanning.value = 0
  front.value = -1e4
  wanted = hologram.value = 0
}

// A colour, after tone mapping, as the hologram draws it, given the world
// normal it's lit by
export function holographic(color, normal) {
  const y = positionWorld.y
  const view = normalize(cameraPosition.sub(positionWorld))
  const edge = float(1).sub(dot(normalize(normal), view).abs()).pow(2)
  const hue = y.mul(HUE_SPREAD).add(edge.mul(HUE_TURN)).sub(time.mul(HUE_DRIFT))
  const rainbow = cos(hue.add(vec3(0, 1 / 3, 2 / 3)).mul(Math.PI * 2)).mul(0.5).add(0.5)
  const tinted = mix(vec3(...TINT), rainbow, RAINBOW)
  // The cel band it was in, as a brightness, so the shading still reads
  const band = dot(color, vec3(0.2126, 0.7152, 0.0722))
  const lines = step(1 - LINE_WIDTH, fract(y.mul(LINES).sub(time.mul(LINE_SPEED)))).mul(LINE_LIGHT)
  const shineAt = fract(y.div(SHINE_GAP).sub(time.mul(SHINE_SPEED)))
  const shine = smoothstep(0.85, 0.97, shineAt).mul(smoothstep(0.97, 1, shineAt).oneMinus()).mul(SHINE_LIGHT)
  const drawn = tinted.mul(band.mul(1.3).add(0.2)).add(rainbow.mul(edge.mul(RIM))).add(lines).add(shine)
  // Above a scan, the hologram; under it, fading into the tree
  const above = smoothstep(front.sub(SCAN_GLOW), front, y)
  const shown = mix(color, drawn, hologram.mul(above))
  // The scan's line, hard on top and glowing under it
  const under = front.sub(y)
  const line = step(under.abs(), SCAN_LINE).add(smoothstep(0, SCAN_GLOW, under).oneMinus().mul(step(0, under)).mul(0.35)).min(1)
  return mix(shown, vec3(...SCAN_LIGHT), line.mul(scanning))
}
