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
  normalGeometry,
  normalLocal,
  output,
  positionGeometry,
  rotate,
  sin,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { celShade, tintShadow, toneMapped } from './shading.js'
import { wind } from './wind.js'

// Falling leaves, after the tutorial's Blender particles (leaves spawned inside
// the tree, random size and turn, pushed by wind and turbulence, with the
// foliage's shader) and Bruno Simon's TSL petals (storage buffers updated by a
// compute shader each frame, a life progress per leaf, scaled in and out,
// tumbling by their own position). Each leaf falls from inside the crown,
// drifts downwind, lands on the floor, keeps sliding downwind as it settles
// flat, then shrinks away and starts again.

const MAX_LEAVES = 4000
const ALBEDO = 0.8 // the tutorial's Diffuse BSDF's
const FLOOR = 0.01 // the height a leaf lies at
const LANDING = 0.9 // metres above the floor over which a leaf levels out
const ROCK = 1.2 // how far a falling leaf rocks either way, in radians
const AIR_DRIFT = 2 // downwind speed in the air, per unit of wind strength
const FLOOR_CREEP = 0.15 // downwind speed once settled, per unit of wind strength
const SETTLE_TIME = 1.5 // seconds a landed leaf takes to slow to its creep
const LIE_FLAT = vec3(-Math.PI / 2, 0, 0) // turns the card face up

// 0 high up, rising smoothly to 1 at the floor
const levelling = (height) => float(1).sub(height.sub(FLOOR).div(LANDING).clamp(0, 1)).smoothstep(0, 1)

export function createFallingLeaves({ colors, crownCenter, crownSize }) {
  const uniforms = {
    lifetime: uniform(14), // seconds from leaving the tree to vanishing
    fallSpeed: uniform(0.6), // metres per second, before the wind
    size: uniform(0.33), // a leaf's width, in metres
  }
  const u = uniforms

  // Per leaf: where it is and how far through its life, and how settled it
  // is on the floor (0 in the air, 1 lying flat)
  const positions = instancedArray(MAX_LEAVES, 'vec3')
  const progresses = instancedArray(MAX_LEAVES, 'float')
  const settled = instancedArray(MAX_LEAVES, 'float')

  // A random point inside the crown, new each time it's asked for
  const spawn = (seed) => {
    const around = hash(seed).mul(Math.PI * 2)
    const tilt = acos(hash(seed.add(1)).mul(2).sub(1))
    const depth = hash(seed.add(2)).pow(1 / 3).mul(0.8)
    const direction = vec3(sin(tilt).mul(cos(around)), cos(tilt), sin(tilt).mul(sin(around)))
    return crownCenter.add(direction.mul(crownSize).mul(depth))
  }

  // Start every leaf somewhere in the crown, at a random point of its life
  const init = Fn(() => {
    positions.element(instanceIndex).assign(spawn(instanceIndex.mul(7)))
    progresses.element(instanceIndex).assign(hash(instanceIndex.mul(3)))
    settled.element(instanceIndex).assign(0)
  })().compute(MAX_LEAVES)

  const step = Fn(() => {
    const position = positions.element(instanceIndex)
    const progress = progresses.element(instanceIndex)
    const flat = settled.element(instanceIndex)
    const dt = deltaTime.min(0.05)
    const downwind = vec3(cos(wind.direction), 0, sin(wind.direction))

    // Life: when it's over, start again from a new point in the crown
    progress.addAssign(dt.div(u.lifetime))
    If(progress.greaterThan(1), () => {
      progress.assign(progress.fract())
      position.assign(spawn(instanceIndex.mul(7).add(floor(time.mul(60)))))
      flat.assign(0)
    })

    If(position.y.greaterThan(FLOOR), () => {
      // In the air: fall, drift downwind, flutter in the turbulence. Near the
      // floor the leaf has levelled out and, flat, falls slower, gliding in
      const level = levelling(position.y)
      const turbulence = mx_noise_vec3(position.mul(wind.frequency.mul(4)).add(time.mul(wind.speed))).mul(0.8)
      const fall = u.fallSpeed.mul(float(1).sub(level.mul(0.5)))
      const drift = downwind.mul(wind.strength.mul(AIR_DRIFT)).add(turbulence).add(vec3(0, fall.negate(), 0))
      position.addAssign(drift.mul(dt))
      position.y.assign(position.y.max(FLOOR))
    }).Else(() => {
      // On the floor: it lands with its air drift and slows smoothly to a
      // gentle creep downwind
      flat.assign(flat.add(dt.div(SETTLE_TIME)).min(1))
      const glide = float(1).sub(flat).pow(2)
      const slide = downwind.mul(wind.strength.mul(mix(float(FLOOR_CREEP), float(AIR_DRIFT), glide)))
      position.addAssign(slide.mul(dt))
    })
  })().compute(MAX_LEAVES)

  const material = new THREE.MeshLambertNodeMaterial({
    color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO),
    side: THREE.DoubleSide,
  })

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

    normalLocal.assign(place(normalGeometry))
    return place(positionGeometry.mul(scale)).add(position).add(vec3(0, 0.005, 0))
  })()

  // Alpha: one leaf in the tree's style, clipped hard, in the shadow too
  const variant = floor(hash(instanceIndex.add(7919)).mul(4))
  const cell = vec2(variant.mod(2), floor(variant.div(2)))
  const leafTexture = texture(new THREE.Texture(), uv().add(cell).mul(0.5))
  material.opacityNode = leafTexture.r
  material.alphaTest = 0.5
  material.maskShadowNode = leafTexture.r.greaterThan(0.5)
  material.shadowSide = THREE.DoubleSide
  material.receivedShadowNode = tintShadow

  // Colour: lit by the sun on its own face, through the foliage's colours
  const [core, shadow, mid, light] = colors
  material.outputNode = vec4(
    toneMapped(
      celShade([
        [0, core],
        [0.04545, shadow],
        [0.49773, mid],
        [0.95455, light],
      ]),
    ),
    output.a,
  )

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.frustumCulled = false
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.count = 152

  let started = false
  function update(renderer) {
    if (!started) {
      renderer.compute(init)
      started = true
    }
    renderer.compute(step)
  }

  function setTexture(texture) {
    leafTexture.value = texture
  }

  return { mesh, uniforms, update, setTexture, MAX_LEAVES }
}
