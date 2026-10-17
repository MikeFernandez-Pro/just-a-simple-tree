import * as THREE from 'three/webgpu'
import {
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dot,
  float,
  Fn,
  hash,
  If,
  instanceIndex,
  length,
  mix,
  mx_noise_float,
  normalize,
  normalLocal,
  select,
  sin,
  smoothstep,
  time,
  uniform,
  varyingProperty,
  vec3,
  vec4,
  vertexIndex,
} from 'three/tsl'
import { mulberry32 } from './wood.js'
import { ALBEDO, celShade, linear, toneMapped, tintShadow } from './shading.js'
import { swept } from './transition.js'
import { blowing, downwind, wind } from './wind.js'

// A small round patch of grass at the foot of the tree, after the grass of
// the Portfolio2024 island: every blade is a strip built in the vertex shader
// from its vertex and instance ids, bent along a bezier curve, turned at
// random and thickened when seen edge on. Here the blades fill a disc whose
// ragged rim they shorten towards, lean with the tree's wind, and go through
// the tree's cel ramp, with its shadow on them

const CAPACITY = 40000 // most blades we'll ever draw
const SEGMENTS = 3 // strip segments per blade, for the bend to show
const REACH = 1.2 // blades are scattered this far out, in radii: the rim's bulges
const RAGGED = 0.3 // how far the rim wanders in and out, roughly in radii
const SEED = 0x9e3779b9 // the same patch on every load

// Every blade's root in the unit disc, out to the reach, evenly spread. They
// come in random order, so drawing fewer keeps the patch evenly thinned
function scatter() {
  const random = mulberry32(SEED)
  const roots = new Float32Array(CAPACITY * 2)
  for (let i = 0; i < CAPACITY; i++) {
    const r = REACH * Math.sqrt(random())
    const a = random() * Math.PI * 2
    roots[i * 2] = r * Math.cos(a)
    roots[i * 2 + 1] = r * Math.sin(a)
  }
  return roots
}

const easeOut = (x, t) => {
  // t is a whole number, so the power is unrolled: pow() of a negative base
  // is NaN, and the width calls this with 1 - x < 0 at the root
  const base = float(1).sub(x).toVar()
  let power = base
  for (let i = 1; i < t; i++) power = power.mul(base)
  return float(1).sub(power)
}

const bezier = (p0, p1, p2, p3, t) => {
  const u = float(1).sub(t)
  return p0
    .mul(u.mul(u).mul(u))
    .add(p1.mul(u.mul(u).mul(t).mul(3)))
    .add(p2.mul(u.mul(t).mul(t).mul(3)))
    .add(p3.mul(t.mul(t).mul(t)))
}

// v turned by angle round the unit axis k (Rodrigues)
const turn = (v, k, angle) =>
  v
    .mul(cos(angle))
    .add(cross(k, v).mul(sin(angle)))
    .add(k.mul(dot(k, v).mul(float(1).sub(cos(angle)))))

export function createGrass() {
  const uniforms = {
    radius: uniform(2.69), // the patch's, in metres
    height: uniform(0.34), // a blade's, at full height
    width: uniform(0.07), // a blade's, at its root
    wind: uniform(0.3), // how hard the wind blows the grass, the tree's wind times this
    shade: uniform(0.55), // how dark the grass goes in shadow
    // Root to tip
    colors: [linear(0.078, 0.258, 0.105), linear(0.402, 0.693, 0.255)],
  }
  const u = uniforms
  // As drawn: a new theme sweeps in over the old
  const [rootColor, tipColor] = u.colors.map((color) => swept(color))

  // One strip per blade, its front facing +z; the material is double sided.
  // Nothing but the roots is stored: the shader builds the strip, though the
  // node material still wants a position and a normal to bind
  const geometry = new THREE.InstancedBufferGeometry()
  const indices = []
  for (let i = 0; i < SEGMENTS; i++) {
    const v = i * 2
    indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3)
  }
  geometry.setIndex(indices)
  const vertices = (SEGMENTS + 1) * 2
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
  geometry.setAttribute('bladeRoot', new THREE.InstancedBufferAttribute(scatter(), 2))
  geometry.instanceCount = 14000

  // Lambert, read back through a ramp like the tree's
  const material = new THREE.MeshLambertNodeMaterial({
    color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO),
    side: THREE.DoubleSide,
  })

  // Vertex -> fragment: how far up the blade
  const vHeight = varyingProperty('float', 'vGrassHeight')

  material.positionNode = Fn(() => {
    const root = attribute('bladeRoot', 'vec2')
    const instance = instanceIndex
    const base = vec3(root.x, 0, root.y).mul(u.radius).toVar()

    // Every blade is lit as the ground is, straight up, so a blade's colour
    // never depends on which way it turns. The shadow's bias wants it too
    normalLocal.assign(vec3(0, 1, 0))

    // Collapsed: no area, nothing drawn
    const position = vec3(0).toVar()
    vHeight.assign(0)

    // The rim wanders in and out round the patch, and blades shorten into it
    const around = root.div(length(root).max(1e-4))
    const rim = float(1).add(mx_noise_float(vec3(around.mul(1.7), 4.2)).mul(RAGGED))
    const fullness = float(1).sub(smoothstep(0.55, 1, length(root).div(rim))).toVar()

    If(fullness.greaterThan(0.15), () => {
      // Which vertex of the strip: even on the left, odd on the right, the
      // pairs stacking up the blade
      const id = float(vertexIndex).mod(vertices)
      const side = id.mod(2).toVar()
      const up = id.sub(side).div(SEGMENTS * 2).toVar()

      // A blade tapers to its tip. Towards the rim it shortens more than it
      // thins, so the rim stays crisp
      const width = u.width
        .mul(easeOut(float(1.06).sub(up), 3))
        .mul(mix(0.6, 1, fullness))
        .toVar()
      const height = u.height.mul(fullness).mul(hash(instance.add(2000)).mul(0.5).add(0.75))

      // Wind: a noise field smaller than the tree's gusts, drifting downwind,
      // leans the blades along it, harder in a gust. Each blade also leans a
      // little its own way, and rocks a little. The grass's own strength
      // scales it all
      const blowingGrass = blowing.mul(u.wind)
      const drift = vec3(base.x, 0, base.z)
        .mul(wind.frequency.mul(8))
        .sub(downwind.mul(time.mul(wind.speed).mul(2)))
      const gust = mx_noise_float(drift).add(0.6).max(0)
      const blow = gust.mul(blowingGrass).mul(3).min(1.3).mul(up)
      const rock = sin(time.mul(wind.speed).mul(5).add(hash(instance.add(3000)).mul(Math.PI * 2)))
        .mul(blowingGrass)
        .mul(0.25)
      const lean = hash(instance.add(4000)).sub(0.5).mul(0.6).add(rock)

      // The bend: a bezier from the root to a tip leaning forward
      const curve = bezier(vec3(0), vec3(0, 0.33, 0), vec3(0, 0.66, 0), vec3(0, cos(lean), sin(lean)), up)
      const local = vec3(side.sub(0.5).mul(width), curve.y.mul(height), curve.z.mul(height))

      // Turned any way round, then leant downwind
      const yaw = hash(instance.add(5000)).mul(Math.PI * 2)
      const turned = turn(local, vec3(0, 1, 0), yaw)
      const windAxis = normalize(cross(vec3(0, 1, 0), downwind))
      const blade = turn(turned, windAxis, blow).add(base).toVar()

      // Seen edge on a blade is a line: widen it along the camera's right as
      // it turns away, on whichever side the camera is
      const toCamera = normalize(cameraPosition.sub(base))
      const face = turn(turn(vec3(0, 0, 1), vec3(0, 1, 0), yaw), windAxis, blow)
      const facing = dot(face, toCamera).toVar()
      const thicken = easeOut(float(1).sub(abs(facing)), 4).mul(smoothstep(0, 0.2, abs(facing)))
      const right = vec3(cameraViewMatrix.element(0).x, cameraViewMatrix.element(1).x, cameraViewMatrix.element(2).x)
      blade.addAssign(
        right.mul(
          thicken
            .mul(side.sub(0.5))
            .mul(width)
            .mul(0.5)
            .mul(select(facing.greaterThanEqual(0), 1, -1)),
        ),
      )
      position.assign(blade)

      vHeight.assign(up)
    })

    return position
  })()

  // Straight up in view space, on both sides of the blade
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz)
  material.receivedShadowNode = tintShadow

  // Colour: root to tip, clamped, as thin triangles can spread a varying
  // past its ends
  const color = mix(rootColor, tipColor, clamp(vHeight, 0, 1))
  // The tree's two bands: lit, or in shadow
  material.outputNode = vec4(
    toneMapped(
      celShade([
        [0, color.mul(u.shade)],
        [0.497, color],
      ]),
    ),
    1,
  )

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.receiveShadow = true

  // How many blades are drawn
  function setCount(count) {
    geometry.instanceCount = Math.min(count, CAPACITY)
  }

  return { mesh, uniforms, setCount, CAPACITY }
}
