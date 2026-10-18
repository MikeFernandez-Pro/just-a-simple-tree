import * as THREE from 'three/webgpu'
import {
  acos,
  cos,
  deltaTime,
  float,
  floor,
  Fn,
  hash,
  If,
  instanceIndex,
  instancedArray,
  min,
  mix,
  mx_noise_vec3,
  output,
  positionGeometry,
  rotate,
  saturation,
  select,
  sin,
  texture,
  time,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { atlasUV } from './foliage.js'
import { toneMapped } from './shading.js'
import { swept } from './transition.js'
import { blowing, downwind, wind } from './wind.js'

// Falling leaves, after the tutorial's Blender particles (leaves spawned inside
// the tree, random size and turn, pushed by wind and turbulence, in the
// foliage's colours) and Bruno Simon's TSL petals (storage buffers updated by a
// compute shader each frame, a life progress per leaf, scaled in and out,
// tumbling by their own position). Each leaf falls from inside the crown,
// drifts downwind, lands on the floor, keeps sliding downwind as it settles
// flat, then shrinks away and starts again. A shake knocks a batch more off:
// the tree is hit from above, so they drop straight down at first, and the
// wind only takes them once they've slowed.

const MAX_LEAVES = 4000
const LOOSE = 600 // leaves a shake knocks off the tree at once, on top of the amount
const DROP = 2.5 // metres per second a knocked leaf falls faster than the rest, as it's knocked
const DROP_SECONDS = 1 // how long a knocked leaf falls straight down before the wind takes it
const FLOOR = 0.01 // the height a leaf lies at
const LANDING = 0.9 // metres above the floor over which a leaf levels out
const ROCK = 1.2 // how far a falling leaf rocks either way, in radians
const AIR_DRIFT = 2 // downwind speed in the air, per unit of wind strength
const FLOOR_CREEP = 0.15 // downwind speed once settled, per unit of wind strength
const SETTLE_TIME = 1.5 // seconds a landed leaf takes to slow to its creep
const LIE_FLAT = vec3(-Math.PI / 2, 0, 0) // turns the card face up
const SATURATION = 1.25 // how much more vivid than the foliage they fall from

// 0 high up, rising smoothly to 1 at the floor
const levelling = (height) => float(1).sub(height.sub(FLOOR).div(LANDING).clamp(0, 1)).smoothstep(0, 1)

export function createFallingLeaves({ colors, crownCenter, crownSize }) {
  const uniforms = {
    lifetime: uniform(14), // seconds from leaving the tree to vanishing
    fallSpeed: uniform(0.42), // metres per second, before the wind
    size: uniform(0.17), // a leaf's width, in metres
    amount: uniform(277), // how many fall at once
    spawning: uniform(1), // 0 while a new tree grows: no leaf leaves it
    looseFrom: uniform(0), // where the next shake's batch starts among the leaves past the amount
  }
  const u = uniforms

  // Whether leaves may leave the tree at all: not while a new tree grows
  const spawning = () => u.spawning.greaterThan(0.5)
  // Whether a leaf may leave the tree now: the first amount of them, while
  // spawning. Every leaf is drawn, the others hidden, so changing the amount
  // never shows leaves mid-air: they join or stop as their lives end
  const free = () => spawning().and(instanceIndex.toFloat().lessThan(u.amount))

  // Per leaf: where it is and how far through its life, and how settled it
  // is on the floor (0 in the air, 1 lying flat)
  const positions = instancedArray(MAX_LEAVES, 'vec3')
  const progresses = instancedArray(MAX_LEAVES, 'float')
  const settled = instancedArray(MAX_LEAVES, 'float')
  // 1 as a shake knocks a leaf off, falling to 0 as the wind takes it
  const knocked = instancedArray(MAX_LEAVES, 'float')

  // A random point inside the crown, new each time it's asked for
  const spawn = (seed) => {
    const around = hash(seed).mul(Math.PI * 2)
    const tilt = acos(hash(seed.add(1)).mul(2).sub(1))
    const depth = hash(seed.add(2)).pow(1 / 3).mul(0.8)
    const direction = vec3(sin(tilt).mul(cos(around)), cos(tilt), sin(tilt).mul(sin(around)))
    return crownCenter.add(direction.mul(crownSize).mul(depth))
  }

  // Which frame it is, so a leaf leaving again starts somewhere new
  const tick = floor(time.mul(60))

  // A leaf leaving the tree: from a new point in the crown, in the air
  const leave = () => {
    positions.element(instanceIndex).assign(spawn(instanceIndex.mul(7).add(tick)))
    settled.element(instanceIndex).assign(0)
    knocked.element(instanceIndex).assign(0)
  }

  // Start every free leaf somewhere in the crown, at a random point of its
  // life; the others wait
  const init = Fn(() => {
    const progress = hash(instanceIndex.mul(3))
    positions.element(instanceIndex).assign(spawn(instanceIndex.mul(7)))
    progresses.element(instanceIndex).assign(select(free(), progress, progress.negate()))
    settled.element(instanceIndex).assign(0)
    knocked.element(instanceIndex).assign(0)
  })().compute(MAX_LEAVES)

  const step = Fn(() => {
    const position = positions.element(instanceIndex)
    const progress = progresses.element(instanceIndex)
    const flat = settled.element(instanceIndex)
    const knock = knocked.element(instanceIndex)
    const dt = deltaTime.min(0.05)

    // Life: when it's over, start again from a new point in the crown. A leaf
    // that isn't free when its life is over waits instead, hidden, its
    // progress below 0; once free again the waiting ones leave one by one
    // over a lifetime, so the fall builds up again from the crown
    If(progress.lessThan(0), () => {
      If(free(), () => {
        progress.addAssign(dt.div(u.lifetime))
      })
      If(progress.greaterThanEqual(0), leave)
    }).Else(() => {
      progress.addAssign(dt.div(u.lifetime))
      If(progress.greaterThan(1), () => {
        If(free(), () => {
          progress.assign(progress.fract())
          leave()
        }).Else(() => {
          progress.assign(hash(instanceIndex.add(tick)).negate())
        })
      })
    })

    If(position.y.greaterThan(FLOOR), () => {
      // In the air: fall, drift downwind, flutter in the turbulence. Near the
      // floor the leaf has levelled out and, flat, falls slower, gliding in.
      // A knocked leaf drops faster and straight at first, the wind and the
      // turbulence taking it over as the knock wears off
      const level = levelling(position.y)
      const turbulence = mx_noise_vec3(position.mul(wind.frequency.mul(4)).add(time.mul(wind.speed))).mul(0.8)
      const fall = u.fallSpeed.mul(float(1).sub(level.mul(0.5))).add(knock.mul(DROP))
      const sideways = downwind.mul(blowing.mul(AIR_DRIFT)).add(turbulence).mul(float(1).sub(knock))
      position.addAssign(sideways.add(vec3(0, fall.negate(), 0)).mul(dt))
      knock.assign(knock.sub(dt.div(DROP_SECONDS)).max(0))
      position.y.assign(position.y.max(FLOOR))
    }).Else(() => {
      // On the floor: it lands with its air drift and slows smoothly to a
      // gentle creep downwind
      flat.assign(flat.add(dt.div(SETTLE_TIME)).min(1))
      const glide = float(1).sub(flat).pow(2)
      const slide = downwind.mul(blowing.mul(mix(float(FLOOR_CREEP), float(AIR_DRIFT), glide)))
      position.addAssign(slide.mul(dt))
    })
  })().compute(MAX_LEAVES)

  // A shake knocks leaves off the tree all at once: a batch of the leaves past
  // the amount leaves the crown together, a little apart in their lives so
  // they don't vanish together, falls once and waits again. Each shake takes
  // the next batch round those leaves, so shakes close together each knock
  // their own off; only a leaf from many shakes ago, still lying there, goes
  // back up. None while a new tree grows
  const loose = Fn(() => {
    const index = instanceIndex.toFloat()
    const pool = float(MAX_LEAVES).sub(u.amount).max(1)
    const place = index.sub(u.amount).sub(u.looseFrom).add(pool).mod(pool)
    If(spawning().and(index.greaterThanEqual(u.amount)).and(place.lessThan(LOOSE)), () => {
      progresses.element(instanceIndex).assign(hash(instanceIndex.add(tick).add(101)).mul(0.1))
      leave()
      knocked.element(instanceIndex).assign(1)
    })
  })().compute(MAX_LEAVES)

  // Unlit: each leaf is one flat colour, whatever its turn and whatever
  // shadow it falls through
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })

  material.positionNode = Fn(() => {
    const position = positions.element(instanceIndex)
    const progress = progresses.element(instanceIndex)
    const seed = hash(instanceIndex)

    // Grows in as it leaves the tree, shrinks away at the end
    const grow = min(progress.remap(0, 0.03), progress.remap(1, 0.85)).clamp(0, 1)
    const scale = u.size.mul(grow).mul(seed.mul(0.6).add(0.7))

    // A flat leaf, lying face up, rocking about that as it falls and turning
    // slowly; the rocking fades out over the last stretch above the floor,
    // so it lands level and stays as it landed. Rocks and turn follow its
    // height, so they stop once it's down
    const phase = position.y.mul(4).add(seed.mul(Math.PI * 2))
    const rock = vec3(sin(phase), 0, sin(phase.mul(0.7).add(1.3))).mul(ROCK).mul(float(1).sub(levelling(position.y)))
    const heading = vec3(0, position.y.mul(1.5).add(seed.mul(Math.PI * 2)), 0)
    const place = (v) => rotate(rotate(rotate(v, LIE_FLAT), rock), heading)

    return place(positionGeometry.mul(scale)).add(position).add(vec3(0, 0.005, 0))
  })()

  // Alpha: one leaf in the tree's style, clipped hard, in the shadow too
  const leafTexture = texture(new THREE.Texture(), atlasUV())
  material.opacityNode = leafTexture.r
  material.alphaTest = 0.5
  material.maskShadowNode = leafTexture.r.greaterThan(0.5)
  material.shadowSide = THREE.DoubleSide

  // Colour: the foliage's mid colour, each leaf its own shade of it, from a
  // little towards the shadow colour to a little towards the light one, and
  // a touch more saturated, so they stand out against the tree
  const [shadow, mid, light] = colors.map((color) => swept(color))
  const shade = hash(instanceIndex.add(313))
  const color = saturation(mix(mix(mid, shadow, 0.4), mix(mid, light, 0.4), shade), SATURATION)
  material.outputNode = vec4(toneMapped(color), output.a)

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.frustumCulled = false
  mesh.castShadow = true
  mesh.count = MAX_LEAVES

  let started = false
  let loosening = false
  let nextFrom = 0
  function update(renderer) {
    if (!started) {
      renderer.compute(init)
      started = true
    }
    if (loosening) {
      renderer.compute(loose)
      loosening = false
      u.looseFrom.value = nextFrom
    }
    renderer.compute(step)
  }

  // Knocks a handful of leaves off the tree on the next frame, the next batch
  // round the leaves past the amount
  function shake() {
    const pool = Math.max(MAX_LEAVES - u.amount.value, 1)
    u.looseFrom.value = u.looseFrom.value % pool
    loosening = true
    nextFrom = (u.looseFrom.value + LOOSE) % pool
  }

  function setTexture(texture) {
    leafTexture.value = texture
  }

  return { mesh, uniforms, update, setTexture, shake, MAX_LEAVES }
}
