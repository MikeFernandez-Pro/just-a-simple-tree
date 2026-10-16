import * as THREE from 'three/webgpu'
import {
  abs,
  cameraViewMatrix,
  cos,
  cross,
  dot,
  float,
  floor,
  Fn,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  min,
  mix,
  normalGeometry,
  normalize,
  normalLocal,
  output,
  positionGeometry,
  pow,
  rotate,
  sin,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { mulberry32 } from './oak.js'
import { celShade, linear, sunDirection, tintShadow, toneMapped } from './shading.js'
import { flutter, sway } from './wind.js'

// Anime foliage after trungduyng's Blender pipeline: leaf cards scattered
// over each leaf clump, each showing a whole cluster of leaves, lit with the
// clump's normals, not their own, through the tutorial's cel colour ramp.
// The cards are fixed in the world, flat planes lying on their clump,
// and lit by the sun with its shadows, so nothing changes with the camera.
// Their ambient occlusion is worked out per card on the CPU.

const CAPACITY = 1 << 16 // most cards we'll ever draw
const CARD_RATIO = 1.8 // card width / clump radius
const TILT = 0.6 // how far a card leans off its clump's surface, at most
const AO_RAYS = 12 // rays per card, cosine-weighted round its normal
// Clumps are leafy volumes, not solid balls: light fades with the length of
// the ray inside one, so a ray straight through a clump keeps 10% of it and
// a card just inside a neighbour's edge keeps nearly all
const LEAF_DENSITY = -Math.log(0.1) / 2 // per clump radius travelled
const ALBEDO = 0.8 // the tutorial's Diffuse BSDF's
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const UP = new THREE.Vector3(0, 1, 0)

export function createFoliage() {
  // Per card: centre and size; the clump's normal there and the card's AO;
  // the card's own facing and its spin round it; its clump's centre and radius
  const cardA = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardB = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardC = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardD = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  for (const attribute of [cardA, cardB, cardC, cardD]) attribute.setUsage(THREE.DynamicDrawUsage)

  const uniforms = {
    crownCenter: uniform(new THREE.Vector3()),
    crownSize: uniform(new THREE.Vector3(1, 1, 1)),
    shadowSide: uniform(0.745), // the multiply factor of the tutorial's gradient
    ao: uniform(0.54), // the multiply factor of the tutorial's AO
    particleSize: uniform(0.92), // grows the cards without adding any
    roundness: uniform(0.58), // how far cards wrap round their clump
    brush: uniform(1), // 0 shows the bare cards
    flatNormals: uniform(0), // 1 lights each card by its own face, as before the transfer
    showNormals: uniform(0), // 1 draws the normals as colours
    // The tutorial's foliage ramp: four colours with flat bands between short
    // blends
    colors: [
      linear(0.02974, 0.15645, 0.10292),
      linear(0.0356, 0.20508, 0.05781),
      linear(0.0865, 0.34191, 0.05613),
      linear(0.3447, 0.59669, 0.13836),
    ],
  }
  const u = uniforms
  const [core, shadow, mid, light] = u.colors

  const a = instancedBufferAttribute(cardA)
  const b = instancedBufferAttribute(cardB)
  const c = instancedBufferAttribute(cardC)
  const d = instancedBufferAttribute(cardD)
  const center = a.xyz

  // Lambert under the sun is the tutorial's Diffuse + Shader to RGB, shadows
  // included
  const material = new THREE.MeshLambertNodeMaterial({
    color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO),
    side: THREE.DoubleSide,
  })

  // The card's frame: its facing, and two axes in its plane turned by its spin
  const facing = c.xyz
  const helper = mix(vec3(1, 0, 0), vec3(0, 1, 0), float(abs(facing.y).lessThan(0.99)))
  const across = normalize(cross(helper, facing))
  const along = cross(facing, across)
  const tangent = across.mul(cos(c.w)).add(along.mul(sin(c.w)))
  const bitangent = cross(facing, tangent)
  const place = (v) => tangent.mul(v.x).add(bitangent.mul(v.y)).add(facing.mul(v.z))

  // The card lies on its clump
  material.positionNode = Fn(() => {
    // Wind: the card rides its branch's sway and rocks round its own centre
    const rock = flutter(center, hash(instanceIndex.add(31)).mul(Math.PI * 2))
    const flat = center.add(place(rotate(positionGeometry, rock)).mul(a.w.mul(u.particleSize)))
    // Roundness pulls each vertex onto its clump's sphere, at the card's own
    // distance from the clump's centre: 0 leaves the card flat and tilted, 1
    // wraps it round the clump. The more segments, the closer it follows
    const clump = d.xyz
    const distance = center.sub(clump).length()
    const wrapped = clump.add(normalize(flat.sub(clump)).mul(distance))
    // The geometry's normal turns with the card, and with the wrap, for the
    // shadow's bias
    const flatNormal = place(rotate(normalGeometry, rock))
    normalLocal.assign(normalize(mix(flatNormal, normalize(wrapped.sub(clump)), u.roundness)))
    return mix(flat, wrapped, u.roundness).add(sway(center))
  })()

  // How many squares a card is cut into; they only show once roundness
  // bends it
  let segments = 2
  function setSegments(count) {
    segments = count
    mesh.geometry = cards[segments]
  }

  // Alpha: the leaf cluster, clipped hard, in the shadow too. The texture
  // is a 2 x 2 atlas of four clusters, one picked per card
  const variant = floor(hash(instanceIndex.add(7919)).mul(4))
  const cell = vec2(variant.mod(2), floor(variant.div(2)))
  const brushTexture = texture(leafTexture('pointed cluster'), uv().add(cell).mul(0.5))
  const opacity = mix(float(1), brushTexture.r, u.brush)
  material.opacityNode = opacity
  material.alphaTest = 0.5
  material.maskShadowNode = opacity.greaterThan(0.5)
  material.shadowSide = THREE.DoubleSide
  material.receivedShadowNode = tintShadow

  // Normal: the clump's, as the tutorial's Data Transfer copies the emitter's,
  // on both sides of the card
  const normal = normalize(mix(b.xyz, facing, u.flatNormals))
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz)

  // Colour: the lit value through the tutorial's four colours, at its band
  // edges, hard-edged
  let color = celShade([
    [0, core],
    [0.04545, shadow],
    [0.49773, mid],
    [0.95455, light],
  ])

  // The tutorial's gradient: an easing ramp tied to the light, full on the
  // sun's side of the tree and falling to nothing across the far two thirds,
  // multiplied in
  const side = dot(center.sub(u.crownCenter).div(u.crownSize), sunDirection).clamp(-1, 1)
  const t = side.add(1).mul(0.75).clamp(0, 1)
  const gradient = t.mul(t).mul(float(3).sub(t.mul(2)))
  color = color.mul(mix(float(1), gradient, u.shadowSide))

  // The tutorial's AO: raised to the power 2.7, times 7.6 clamped to 1, times
  // 1.45, multiplied in. Open leaves come out brighter, buried ones darker.
  // Both are per card, so each card stays one flat colour while the crown falls
  // off smoothly from the sun's side
  const aoTerm = min(pow(b.w, 2.7).mul(7.6), 1).mul(1.45)
  color = color.mul(mix(float(1), aoTerm, u.ao))

  material.outputNode = vec4(mix(toneMapped(color), normal.mul(0.5).add(0.5), u.showNormals), output.a)

  // A card is one plane of n x n squares, (n + 1)² vertices: 1 x 1 is 4,
  // 2 x 2 is 9. The segments only matter once roundness bends it
  const cards = {}
  for (const n of [1, 2, 3, 4]) cards[n] = new THREE.PlaneGeometry(1, 1, n, n)
  const mesh = new THREE.Mesh(cards[segments], material)
  mesh.frustumCulled = false
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.count = 0

  // Scatter cards evenly over every clump's surface, and work out their AO
  function update(clumps, params) {
    const random = mulberry32(params.seed + 104729)
    const box = new THREE.Box3()
    for (const { position, radius } of clumps) {
      box.expandByPoint(position.clone().addScalar(radius))
      box.expandByPoint(position.clone().addScalar(-radius))
    }
    box.getCenter(u.crownCenter.value)
    box.getSize(u.crownSize.value).multiplyScalar(0.5).max(new THREE.Vector3(1e-3, 1e-3, 1e-3))

    // Cards per clump scale with its area, so cardsPerClump is the count
    // on a clump of average size
    const meanArea = clumps.reduce((sum, c) => sum + c.radius * c.radius, 0) / Math.max(clumps.length, 1)

    // Only clumps within reach can occlude a card
    const reach = params.aoDistance
    const near = clumps.map((c, i) =>
      clumps.filter((o, j) => j !== i && o.position.distanceTo(c.position) < c.radius * 1.05 + reach + o.radius),
    )

    const A = cardA.array
    const B = cardB.array
    const C = cardC.array
    const D = cardD.array
    const turn = new THREE.Quaternion()
    const toNormal = new THREE.Quaternion()
    const dir = new THREE.Vector3()
    const lean = new THREE.Vector3()
    const ray = new THREE.Vector3()
    const p = new THREE.Vector3()
    let n = 0
    clumps.forEach(({ position, radius }, c) => {
      const cards = Math.max(1, Math.round((params.cardsPerClump * radius * radius) / meanArea))
      // Turn each clump's pattern randomly, so no two clumps line up
      turn.setFromEuler(new THREE.Euler(random() * 6.28, random() * 6.28, random() * 6.28))
      for (let i = 0; i < cards && n < CAPACITY; i++, n++) {
        const y = 1 - (2 * (i + 0.5)) / cards
        const ring = Math.sqrt(1 - y * y)
        const angle = i * GOLDEN_ANGLE
        dir.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring).applyQuaternion(turn)
        p.copy(position).addScaledVector(dir, radius * (0.9 + random() * 0.15))

        // The card lies on the clump, leaning a little off it
        lean.randomDirection().multiplyScalar(TILT * random()).add(dir).normalize()

        // AO: how much light gets in along rays round the normal, within reach
        toNormal.setFromUnitVectors(UP, dir)
        let open = 0
        for (const hemisphere of AO_DIRECTIONS) {
          ray.copy(hemisphere).applyQuaternion(toNormal)
          let through = 0
          for (const o of near[c]) through += chord(p, ray, o.position, o.radius, reach) / o.radius
          open += Math.exp(-LEAF_DENSITY * through)
        }

        A.set([p.x, p.y, p.z, CARD_RATIO * radius * (0.8 + random() * 0.4)], n * 4)
        B.set([dir.x, dir.y, dir.z, open / AO_RAYS], n * 4)
        C.set([lean.x, lean.y, lean.z, random() * Math.PI * 2], n * 4)
        D.set([position.x, position.y, position.z, radius], n * 4)
      }
    })
    for (const attribute of [cardA, cardB, cardC, cardD]) attribute.needsUpdate = true
    mesh.count = n
    mesh.visible = n > 0
  }

  // One of the painted textures, each painted once when first picked
  function setBrush(name) {
    brushTexture.value = leafTexture(name)
  }

  return { mesh, uniforms, update, setBrush, setSegments }
}

// Cosine-weighted directions round +Y, spread evenly
const AO_DIRECTIONS = Array.from({ length: AO_RAYS }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / AO_RAYS)
  const angle = i * GOLDEN_ANGLE
  return new THREE.Vector3(r * Math.cos(angle), Math.sqrt(1 - r * r), r * Math.sin(angle))
})

// How far a ray from origin along dir, out to reach, runs inside the sphere
function chord(origin, dir, center, radius, reach) {
  const x = center.x - origin.x
  const y = center.y - origin.y
  const z = center.z - origin.z
  const along = x * dir.x + y * dir.y + z * dir.z
  const miss2 = x * x + y * y + z * z - along * along
  if (miss2 >= radius * radius) return 0
  const half = Math.sqrt(radius * radius - miss2)
  return Math.max(Math.min(along + half, reach) - Math.max(along - half, 0), 0)
}

// Leaf shapes, drawn as a path along the x axis from -length (the base) to
// +length (the tip), centred on the origin

function pointed(ctx, length) {
  ctx.moveTo(-length, 0)
  ctx.quadraticCurveTo(0, -length * 0.75, length, 0)
  ctx.quadraticCurveTo(0, length * 0.75, -length, 0)
}

function round(ctx, length) {
  ctx.ellipse(0, 0, length, length * 0.7, 0, 0, Math.PI * 2)
}

// An oak leaf: narrow at the base, widest past the middle, with rounded
// lobes down each side
function oak(ctx, length, lobes = 4) {
  const width = (t) => length * 0.5 * Math.sin(Math.PI * t) ** 0.7 * (0.6 + 0.4 * Math.abs(Math.sin(lobes * Math.PI * t)))
  ctx.moveTo(-length, 0)
  for (let i = 1; i <= 40; i++) ctx.lineTo(-length + (2 * length * i) / 40, -width(i / 40))
  for (let i = 39; i >= 0; i--) ctx.lineTo(-length + (2 * length * i) / 40, width(i / 40))
}

// Textures, each four variations in a 2 x 2 atlas of 256-pixel cells,
// white leaves on black: clusters of a few dozen small leaves, thicker
// towards the middle
const LEAVES = {
  'pointed cluster': (ctx, random) => cluster(ctx, random, pointed, 34, 13, 21),
  'round cluster': (ctx, random) => cluster(ctx, random, round, 30, 12, 18),
  'oak cluster': (ctx, random) => cluster(ctx, random, (c, l) => oak(c, l, 3), 26, 16, 24),
}

export const LEAF_TEXTURES = Object.keys(LEAVES)

// A leaf texture, painted once
const textures = {}
export function leafTexture(name) {
  textures[name] ??= paintLeaves(name)
  return textures[name]
}

// What falls from a tree wearing each texture: one of its leaves, drawn
// with the cluster's own shape, alone and big
const ONE_OF = {
  'pointed cluster': pointed,
  'round cluster': round,
  'oak cluster': (ctx, length) => oak(ctx, length, 3),
}

export function fallingTexture(name) {
  const key = `one of ${name}`
  textures[key] ??= paintOne(ONE_OF[name])
  return textures[key]
}

// Four of one leaf in a 2 x 2 atlas, each filling its cell, turned a little
function paintOne(shape) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = '#fff'
  const random = mulberry32(7)
  for (let v = 0; v < 4; v++) {
    ctx.save()
    ctx.translate((v % 2) * 256 + 128, Math.floor(v / 2) * 256 + 128)
    ctx.rotate((random() - 0.5) * 0.8 - Math.PI / 4)
    ctx.beginPath()
    shape(ctx, 100 + random() * 15)
    ctx.fill()
    ctx.restore()
  }
  return new THREE.CanvasTexture(canvas)
}

function paintLeaves(name) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 512, 512)
  const random = mulberry32(42)
  for (let v = 0; v < 4; v++) {
    ctx.save()
    ctx.translate((v % 2) * 256 + 128, Math.floor(v / 2) * 256 + 128)
    LEAVES[name](ctx, random)
    ctx.restore()
  }
  return new THREE.CanvasTexture(canvas)
}

function cluster(ctx, random, shape, count, smallest, largest) {
  ctx.fillStyle = '#fff'
  for (let i = 0; i < count; i++) {
    const d = Math.sqrt(random()) * (118 - largest)
    const t = random() * Math.PI * 2
    ctx.save()
    ctx.translate(Math.cos(t) * d, Math.sin(t) * d)
    ctx.rotate(random() * Math.PI * 2)
    ctx.beginPath()
    shape(ctx, smallest + random() * (largest - smallest))
    ctx.fill()
    ctx.restore()
  }
}
