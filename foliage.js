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
import { GOLDEN_ANGLE, mulberry32, SIDE, UP } from './wood.js'
import { ALBEDO, celShade, linear, LUMA, sunDirection, tintShadow, toneMapped } from './shading.js'
import { swept } from './transition.js'
import { burst, grownLeaf } from './regenerate.js'
import { downwind, flutter, liftBelow, sway } from './wind.js'
import { holographic, updated } from './hologram.js'

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
// The most clumps a card's AO looks at, the nearest to its own: dense
// trees like the pine have hundreds within reach, and the farther ones
// barely shade it
const AO_NEIGHBOURS = 24
// Clumps are leafy volumes, not solid balls: light fades with the length of
// the ray inside one, so a ray straight through a clump keeps 10% of it and
// a card just inside a neighbour's edge keeps nearly all
const LEAF_DENSITY = -Math.log(0.1) / 2 // per clump radius travelled
const AO_BOOST = 1.45 // the tutorial's AO's last factor: open leaves come out brighter
const UPRIGHT = 0.99 // how near straight up or down a card faces before its frame turns off SIDE, not UP
// Where each leaf colour starts, from shadow to light. The tutorial's ramp
// has a fourth, darkest colour under 0.04545, for leaves facing away from
// its only light; here the hemisphere fills them, so none got that dark
export const LEAF_STOPS = [0, 0.49773, 0.95455]

export function createFoliage() {
  // Per card: centre and size; the clump's normal there and the card's AO;
  // the card's own facing and its spin round it; its clump's centre and radius;
  // how far along the wood from the ground its clump is, and how far below
  // where it hangs from the card is
  const cardA = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardB = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardC = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardD = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardE = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2)
  const cardAttributes = [cardA, cardB, cardC, cardD, cardE]
  for (const attribute of cardAttributes) attribute.setUsage(THREE.DynamicDrawUsage)

  const uniforms = {
    crownCenter: uniform(new THREE.Vector3()),
    crownSize: uniform(new THREE.Vector3(1, 1, 1)),
    shadowSide: uniform(0.435), // the multiply factor of the tutorial's gradient
    ao: uniform(0.54), // the multiply factor of the tutorial's AO
    cardSize: uniform(0.92), // grows the cards without adding any
    roundness: uniform(0.58), // how far cards wrap round their clump
    textured: uniform(1), // 0 shows the bare cards
    flatNormals: uniform(0), // 1 lights each card by its own face, as before the transfer
    showNormals: uniform(0), // 1 draws the normals as colours
    imageColors: uniform(0), // 1 colours the leaves with a dropped image's own colours, 0 with the ramp's
    // The tutorial's foliage ramp, its darkest colour left out: three
    // colours with flat bands between short blends
    colors: [
      linear(0.0356, 0.20508, 0.05781),
      linear(0.0865, 0.34191, 0.05613),
      linear(0.3447, 0.59669, 0.13836),
    ],
  }
  const u = uniforms
  // As drawn: a new theme sweeps in over the old
  const [shadow, mid, light] = u.colors.map((color) => swept(color))

  const a = instancedBufferAttribute(cardA)
  const b = instancedBufferAttribute(cardB)
  const c = instancedBufferAttribute(cardC)
  const d = instancedBufferAttribute(cardD)
  const e = instancedBufferAttribute(cardE)
  const center = a.xyz

  // Lambert under the sun is the tutorial's Diffuse + Shader to RGB, shadows
  // included
  const material = new THREE.MeshLambertNodeMaterial({
    color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO),
    side: THREE.DoubleSide,
  })

  // The card's frame: its facing, and two axes in its plane turned by its spin
  const facing = c.xyz
  const helper = mix(vec3(SIDE), vec3(UP), float(abs(facing.y).lessThan(UPRIGHT)))
  const across = normalize(cross(helper, facing))
  const along = cross(facing, across)
  const tangent = across.mul(cos(c.w)).add(along.mul(sin(c.w)))
  const bitangent = cross(facing, tangent)
  const place = (v) => tangent.mul(v.x).add(bitangent.mul(v.y)).add(facing.mul(v.z))

  // The card lies on its clump
  material.positionNode = Fn(() => {
    // Wind: the card rides its branch's sway and rocks round its own centre
    const rock = flutter(center, hash(instanceIndex.add(31)).mul(Math.PI * 2))
    const flat = center.add(place(rotate(positionGeometry, rock)).mul(a.w.mul(u.cardSize)))
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
    // A new tree: the card pops in once its branch has grown there, and a
    // burst blows it away downwind, tumbling and shrinking as it goes. While
    // it blows away it keeps its size, as the wood folds back under it
    const jitter = hash(instanceIndex.add(5))
    const size = burst.greaterThan(0).select(float(1), grownLeaf(e.x, jitter))
    const card = mix(flat, wrapped, u.roundness).sub(center)
    const outwards = normalize(center.sub(u.crownCenter))
    const blown = outwards
      .mul(1.5)
      .add(downwind.mul(jitter.mul(4).add(3)))
      .mul(burst)
      .add(vec3(0, -3, 0).mul(burst.mul(burst)))
    const tumbled = rotate(card, vec3(burst.mul(jitter.mul(12)), burst.mul(7), 0))
    const left = float(1).sub(burst.remap(0.6, 1).clamp(0, 1))
    const placed = clump.add(center.sub(clump).mul(size))
    return placed.add(blown).add(tumbled.mul(size.mul(left))).add(sway(center, e.y))
  })()

  // How many squares a card is cut into; they only show once roundness
  // bends it
  let segments = 2
  function setSegments(count) {
    segments = count
    mesh.geometry = cards[segments]
  }

  // Alpha: the leaf cluster, clipped hard, in the shadow too. The texture
  // is a 2 x 2 atlas of four clusters, one picked per card; none until one
  // is picked
  const leaves = texture(new THREE.Texture(), atlasUV())
  // A dropped image's colours, in the same cells as its leaves
  const ownColors = texture(new THREE.Texture(), atlasUV())
  // The leaves they wore before, held while a scan climbs the tree to put
  // the new ones on, and still worn above it
  const oldLeaves = texture(new THREE.Texture(), atlasUV())
  const oldColors = texture(new THREE.Texture(), atlasUV())
  const oldImageColors = uniform(0)
  const opacity = mix(float(1), mix(oldLeaves.r, leaves.r, updated), u.textured)
  material.opacityNode = opacity
  material.alphaTest = 0.5
  material.maskShadowNode = opacity.greaterThan(0.5)
  material.shadowSide = THREE.DoubleSide
  material.receivedShadowNode = tintShadow

  // Normal: the clump's, as the tutorial's Data Transfer copies them from
  // its emitter, on both sides of the card
  const normal = normalize(mix(b.xyz, facing, u.flatNormals))
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz)

  // Colour: the lit value through the three colours, at its band edges,
  // hard-edged
  let color = celShade(LEAF_STOPS.map((at, i) => [at, [shadow, mid, light][i]]))

  // Or a dropped image's own colours, kept to the ramp's bands: each band
  // as much darker or lighter than the mid colour as the ramp makes it
  const band = dot(color, LUMA).div(dot(mid, LUMA).max(1e-4))
  const imageColors = mix(oldImageColors, u.imageColors, updated)
  color = mix(color, mix(oldColors.rgb, ownColors.rgb, updated).mul(band), imageColors.mul(u.textured))

  // The tutorial's gradient: an easing ramp tied to the light, full on the
  // sun's side of the tree and falling to nothing across the far two thirds,
  // multiplied in
  const side = dot(center.sub(u.crownCenter).div(u.crownSize), sunDirection).clamp(-1, 1)
  const gradient = side.add(1).mul(0.75).smoothstep(0, 1)
  color = color.mul(mix(float(1), gradient, u.shadowSide))

  // The tutorial's AO: raised to the power 2.7, times 7.6 clamped to 1, times
  // AO_BOOST, multiplied in. Open leaves come out brighter, buried ones darker.
  // Both are per card, so each card stays one flat colour while the crown falls
  // off smoothly from the sun's side
  const aoTerm = min(pow(b.w, 2.7).mul(7.6), 1).mul(AO_BOOST)
  color = color.mul(mix(float(1), aoTerm, u.ao))

  material.outputNode = vec4(mix(holographic(toneMapped(color), normal), normal.mul(0.5).add(0.5), u.showNormals), output.a)

  // A card is one plane of n x n squares, (n + 1)² vertices: 1 x 1 is 4,
  // 2 x 2 is 9. The segments only matter once roundness bends it
  const cards = {}
  for (const n of [1, 2, 3, 4]) cards[n] = new THREE.PlaneGeometry(1, 1, n, n)
  const mesh = new THREE.Mesh(cards[segments], material)
  mesh.frustumCulled = false
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.count = 0
  // Shown when asked to be and there are cards to show
  let shown = true
  const showIfAny = () => (mesh.visible = shown && mesh.count > 0)
  function setShown(value) {
    shown = value
    showIfAny()
  }

  // What a tree's clumps need before cards go on them, kept while only the
  // cards' settings change: the clumps as below, the crown round them, and
  // each one's nearest neighbours within the AO's reach
  let known = {}

  // Scatter cards evenly over every clump's surface, and work out their AO.
  // A clump not flattened has a flatten of 1, one that hangs knows it, and
  // each knows how far it reaches, its radius stretched upright by it
  function update(grownClumps, params) {
    if (known.grown !== grownClumps) {
      const clumps = grownClumps.map(({ flatten = 1, ...clump }) => ({
        ...clump,
        flatten,
        hanging: clump.hangFrom !== undefined,
        bound: clump.radius * Math.max(flatten, 1),
      }))
      known = { grown: grownClumps, clumps }
      const box = new THREE.Box3()
      const corner = new THREE.Vector3()
      for (const { position, radius } of clumps) {
        box.expandByPoint(corner.copy(position).addScalar(radius))
        box.expandByPoint(corner.copy(position).addScalar(-radius))
      }
      box.getCenter(u.crownCenter.value)
      box.getSize(u.crownSize.value).multiplyScalar(0.5).max(new THREE.Vector3(1e-3, 1e-3, 1e-3))
      clumpView.update(clumps)
    }
    const reach = params.aoDistance
    if (known.reach !== reach) {
      known.reach = reach
      known.near = nearestClumps(known.clumps, reach)
    }
    const { clumps, near } = known
    const random = mulberry32(params.seed + 104729)
    // The cards' tilts draw from their own random, so the rest of the
    // scatter doesn't depend on how many draws a tilt takes
    const tiltRandom = mulberry32(params.seed + 15485863)

    // Cards per clump scale with its area, so cardsPerClump is the count
    // on a clump of average size
    const meanArea = clumps.reduce((sum, c) => sum + c.radius * c.radius, 0) / Math.max(clumps.length, 1)

    const A = cardA.array
    const B = cardB.array
    const C = cardC.array
    const D = cardD.array
    const turn = new THREE.Quaternion()
    const toNormal = new THREE.Quaternion()
    const dir = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const lean = new THREE.Vector3()
    const ray = new THREE.Vector3()
    const p = new THREE.Vector3()
    const euler = new THREE.Euler()
    const blocking = []
    let n = 0
    // A clump may be flattened, squashed upright into a pad: its cards lie
    // on the squashed surface and take its normals, so a pad lights like one
    // on its top and darkens under it. Above 1 it's stretched upright
    // instead. One that hangs, from the height hangFrom, turns its cards so
    // their leaves point down, and swings in the wind from there
    clumps.forEach(({ position, radius, flatten, hangFrom, hanging, birth }, c) => {
      const cards = Math.max(1, Math.round((params.cardsPerClump * radius * radius) / meanArea))
      // Turn each clump's pattern randomly, so no two clumps line up
      turn.setFromEuler(euler.set(random() * 6.28, random() * 6.28, random() * 6.28))
      for (let i = 0; i < cards && n < CAPACITY; i++, n++) {
        const y = 1 - (2 * (i + 0.5)) / cards
        const ring = Math.sqrt(1 - y * y)
        const angle = i * GOLDEN_ANGLE
        dir.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring).applyQuaternion(turn)
        p.copy(dir)
          .setY(dir.y * flatten)
          .multiplyScalar(radius * (0.9 + random() * 0.15))
          .add(position)
        normal.set(dir.x, dir.y / flatten, dir.z).normalize()

        // The card lies on the clump, leaning a little off it
        randomDirection(lean, tiltRandom).multiplyScalar(TILT * random()).add(normal).normalize()

        // AO: how much light gets in along rays round the normal, within
        // reach. A clump wholly behind the card or out of reach stops none
        // of them, so it's left out before they're cast
        blocking.length = 0
        for (const o of near[c]) {
          ray.subVectors(o.position, p)
          if (ray.dot(normal) > -o.bound && ray.length() - o.bound < reach) blocking.push(o)
        }
        toNormal.setFromUnitVectors(UP, normal)
        let open = 0
        for (const hemisphere of AO_DIRECTIONS) {
          ray.copy(hemisphere).applyQuaternion(toNormal)
          let through = 0
          for (const o of blocking) through += chord(p, ray, o.position, o.radius, reach, o.flatten) / o.radius
          open += Math.exp(-LEAF_DENSITY * through)
        }

        A.set([p.x, p.y, p.z, CARD_RATIO * radius * (0.8 + random() * 0.4)], n * 4)
        B.set([normal.x, normal.y, normal.z, open / AO_RAYS], n * 4)
        C.set([lean.x, lean.y, lean.z, spin(lean, random(), hanging)], n * 4)
        D.set([position.x, position.y, position.z, radius], n * 4)
        cardE.array.set([birth, liftBelow(hangFrom, p.y)], n * 2)
      }
    })
    // Only the cards in use go to the GPU
    if (n > 0) for (const attribute of cardAttributes) uploadFirst(attribute, n)
    mesh.count = n
    showIfAny()
  }

  // One of the painted textures, each painted once when first picked, or
  // the atlases made from a dropped image, its leaves and its colours
  function setLeafTexture(name, own) {
    leaves.value = name === OWN_TEXTURE ? own.leaves : leafTexture(name)
    if (own) ownColors.value = own.colors
  }
  // The leaves as they are now, held as the old ones for a scan
  function holdLeaves() {
    oldLeaves.value = leaves.value
    oldColors.value = ownColors.value
    oldImageColors.value = u.imageColors.value
  }

  // The cards as they stand with no wind, as one plain mesh for export, the
  // shader's work done here: each card's shape and place, the clump's
  // normals, its cell of the texture, and the gradient and AO as a grey per
  // card in the vertex colours. Those can't go over 1 in a glTF, so they're
  // stored divided by the brightest they can be, which comes back as
  // shadeScale
  function bake() {
    const plane = cards[segments]
    const corners = plane.attributes.position.count
    const random = mulberry32(1)
    const count = mesh.count

    const positions = new Float32Array(count * corners * 3)
    const normals = new Float32Array(count * corners * 3)
    const uvs = new Float32Array(count * corners * 2)
    const colors = new Float32Array(count * corners * 3)
    const index = []
    const shadeScale = THREE.MathUtils.lerp(1, AO_BOOST, u.ao.value)

    const [A, B, C, D] = [cardA.array, cardB.array, cardC.array, cardD.array]
    const center = new THREE.Vector3()
    const facing = new THREE.Vector3()
    const across = new THREE.Vector3()
    const along = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const bitangent = new THREE.Vector3()
    const clump = new THREE.Vector3()
    const corner = new THREE.Vector3()
    const flat = new THREE.Vector3()
    const wrapped = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const side = new THREE.Vector3()

    for (let n = 0; n < count; n++) {
      center.fromArray(A, n * 4)
      facing.fromArray(C, n * 4)
      clump.fromArray(D, n * 4)
      normal.fromArray(B, n * 4).lerp(facing, u.flatNormals.value).normalize()
      const spin = C[n * 4 + 3]
      const size = A[n * 4 + 3] * u.cardSize.value
      cardAxes(facing, across, along)
      tangent.copy(across).multiplyScalar(Math.cos(spin)).addScaledVector(along, Math.sin(spin))
      bitangent.crossVectors(facing, tangent)
      const distance = center.distanceTo(clump)

      // The tutorial's gradient and AO, as the shader works them out
      side.subVectors(center, u.crownCenter.value).divide(u.crownSize.value)
      const towardsSun = THREE.MathUtils.clamp(side.dot(sunDirection.value), -1, 1)
      const gradient = THREE.MathUtils.smoothstep((towardsSun + 1) * 0.75, 0, 1)
      const aoTerm = Math.min(B[n * 4 + 3] ** 2.7 * 7.6, 1) * AO_BOOST
      const shade =
        (THREE.MathUtils.lerp(1, gradient, u.shadowSide.value) * THREE.MathUtils.lerp(1, aoTerm, u.ao.value)) / shadeScale

      // One cell of the 2 x 2 atlas per card
      const variant = Math.floor(random() * 4)
      const cell = [variant % 2, Math.floor(variant / 2)]

      for (let v = 0; v < corners; v++) {
        const i = n * corners + v
        corner.fromBufferAttribute(plane.attributes.position, v)
        flat
          .copy(tangent)
          .multiplyScalar(corner.x)
          .addScaledVector(bitangent, corner.y)
          .addScaledVector(facing, corner.z)
          .multiplyScalar(size)
          .add(center)
        wrapped.subVectors(flat, clump).normalize().multiplyScalar(distance).add(clump)
        flat.lerp(wrapped, u.roundness.value).toArray(positions, i * 3)
        normal.toArray(normals, i * 3)
        uvs[i * 2] = (plane.attributes.uv.getX(v) + cell[0]) * 0.5
        uvs[i * 2 + 1] = (plane.attributes.uv.getY(v) + cell[1]) * 0.5
        colors.fill(shade, i * 3, i * 3 + 3)
      }
      for (let j = 0; j < plane.index.count; j++) index.push(n * corners + plane.index.getX(j))
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(index)
    return { geometry, shadeScale, texture: leaves.value, colors: u.imageColors.value ? ownColors.value : null }
  }

  // How many vertices bake gives: every card's own, none shared
  function bakedVertices() {
    return mesh.count * cards[segments].attributes.position.count
  }

  // Runs fn with share of the cards scattered on the same clumps, then puts
  // back the cards showing
  function withShare(grownClumps, params, share, fn) {
    const count = mesh.count
    const kept = cardAttributes.map((attribute) => attribute.array.slice(0, count * attribute.itemSize))
    update(grownClumps, { ...params, cardsPerClump: Math.max(1, Math.round(params.cardsPerClump * share)) })
    const result = fn()
    cardAttributes.forEach((attribute, i) => attribute.array.set(kept[i]))
    mesh.count = count
    if (count > 0) for (const attribute of cardAttributes) uploadFirst(attribute, count)
    showIfAny()
    return result
  }

  // The leaves baked for a lower level of detail: share of the cards on
  // the same clumps, each grown by size, cut into segments
  function bakeLevel(grownClumps, params, { share, size, segments: cut }) {
    return withShare(grownClumps, params, share, () => {
      const was = { segments, size: u.cardSize.value }
      segments = cut
      u.cardSize.value = was.size * size
      const baked = bake()
      segments = was.segments
      u.cardSize.value = was.size
      return baked
    })
  }

  // How many vertices bakeLevel would give, without baking
  function levelVertices(grownClumps, params, { share, segments: cut }) {
    return withShare(grownClumps, params, share, () => mesh.count * cards[cut].attributes.position.count)
  }

  // Where the cards' leaves reach with no wind: each card's centre and
  // half its width, as [x, y, z, radius]. The painted clusters fill the
  // circle inside a card, not its corners
  function reach() {
    const A = cardA.array
    return Array.from({ length: mesh.count }, (_, n) => [A[n * 4], A[n * 4 + 1], A[n * 4 + 2], A[n * 4 + 3] * u.cardSize.value * 0.5])
  }

  // The clumps themselves, hidden, but handy to see
  const clumpView = createClumpView()

  return {
    mesh,
    clumps: clumpView.mesh,
    uniforms,
    update,
    setShown,
    setLeafTexture,
    holdLeaves,
    setSegments,
    bake,
    bakedVertices,
    bakeLevel,
    levelVertices,
    reach,
  }
}

// The leaf clumps the cards are scattered over, drawn as they are: each a
// sphere, or a pad when its species flattens it, or a tress when it
// stretches it, swaying with the wood
const MAX_CLUMPS = 8192 // most clumps it draws
function createClumpView() {
  const sphere = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLUMPS * 4), 4) // centre, radius
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLUMPS * 2), 2) // flatten, lift
  sphere.setUsage(THREE.DynamicDrawUsage)
  shape.setUsage(THREE.DynamicDrawUsage)
  const s = instancedBufferAttribute(sphere)
  const f = instancedBufferAttribute(shape)
  const material = new THREE.MeshLambertNodeMaterial({ color: '#4f7a3a' })
  material.positionNode = s.xyz.add(sway(s.xyz, f.y)).add(positionGeometry.mul(vec3(1, f.x, 1)).mul(s.w))
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), material)
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.count = 0

  function update(clumps) {
    mesh.count = Math.min(clumps.length, MAX_CLUMPS)
    for (let i = 0; i < mesh.count; i++) {
      const { position, radius, flatten, hangFrom } = clumps[i]
      sphere.array.set([position.x, position.y, position.z, radius], i * 4)
      shape.array.set([flatten, liftBelow(hangFrom, position.y)], i * 2)
    }
    if (mesh.count > 0) for (const attribute of [sphere, shape]) uploadFirst(attribute, mesh.count)
  }

  return { mesh, update }
}

// Send only an attribute's first count instances to the GPU on its next
// upload, not the whole buffer
function uploadFirst(attribute, count) {
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, count * attribute.itemSize)
  attribute.needsUpdate = true
}

// The two axes in a card's plane before its spin, from its facing, into
// across and along: the shader's frame, worked out the same way
function cardAxes(facing, across, along) {
  across.crossVectors(Math.abs(facing.y) < UPRIGHT ? UP : SIDE, facing).normalize()
  along.crossVectors(facing, across)
}

// A card's or falling leaf's cell of its 2 x 2 atlas: one of the four,
// picked at random per instance
export function atlasUV() {
  const variant = floor(hash(instanceIndex.add(7919)).mul(4))
  return uv().add(vec2(variant.mod(2), floor(variant.div(2)))).mul(0.5)
}

// A card's spin round its facing, from a random number: any way round, or
// for a hanging clump, its texture's x axis, the way its leaves point, as
// near straight down as the card's tilt lets it, give or take a little. The
// frame is the shader's
const HANG_JITTER = 0.5 // radians either way
const across = new THREE.Vector3()
const along = new THREE.Vector3()
function spin(facing, random, hanging) {
  if (!hanging) return random * Math.PI * 2
  cardAxes(facing, across, along)
  return Math.atan2(-along.y, -across.y) + (random - 0.5) * 2 * HANG_JITTER
}

// Each clump's nearest neighbours that could occlude its cards: within reach,
// by the gap between their surfaces, at most AO_NEIGHBOURS. Each pair is
// measured once, for both. Each clump keeps its nearest in order as they're
// offered, which is by index, a tie going to the one offered first
function nearestClumps(clumps, reach) {
  const near = clumps.map(() => [])
  const nearGaps = clumps.map(() => [])
  function offer(i, o, gap) {
    if (gap >= clumps[i].radius * 0.05 + reach) return
    const nearest = near[i]
    const gaps = nearGaps[i]
    const full = nearest.length === AO_NEIGHBOURS
    if (full && gap >= gaps[AO_NEIGHBOURS - 1]) return
    let k = full ? AO_NEIGHBOURS - 1 : nearest.length
    for (; k > 0 && gaps[k - 1] > gap; k--) {
      gaps[k] = gaps[k - 1]
      nearest[k] = nearest[k - 1]
    }
    gaps[k] = gap
    nearest[k] = o
  }
  for (let i = 0; i < clumps.length; i++) {
    const c = clumps[i]
    for (let j = i + 1; j < clumps.length; j++) {
      const o = clumps[j]
      const distance = o.position.distanceTo(c.position)
      offer(i, o, distance - c.radius - o.radius)
      offer(j, c, distance - o.radius - c.radius)
    }
  }
  return near
}

// A direction picked evenly over the sphere, into v, as three's
// randomDirection picks one but from a seeded random
function randomDirection(v, random) {
  const y = random() * 2 - 1
  const around = random() * Math.PI * 2
  const ring = Math.sqrt(1 - y * y)
  return v.set(ring * Math.cos(around), y, ring * Math.sin(around))
}

// Cosine-weighted directions round +Y, spread evenly
const AO_DIRECTIONS = Array.from({ length: AO_RAYS }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / AO_RAYS)
  const angle = i * GOLDEN_ANGLE
  return new THREE.Vector3(r * Math.cos(angle), Math.sqrt(1 - r * r), r * Math.sin(angle))
})

// How far a ray from origin along dir, out to reach, runs inside the
// clump: a sphere, squashed upright by flatten. Unsquashing the ray's y turns
// it into a sphere test, along the ray's own length
function chord(origin, dir, center, radius, reach, flatten) {
  const x = center.x - origin.x
  const y = (center.y - origin.y) / flatten
  const z = center.z - origin.z
  const dy = dir.y / flatten
  const a = dir.x * dir.x + dy * dy + dir.z * dir.z
  const b = x * dir.x + y * dy + z * dir.z
  const c = x * x + y * y + z * z - radius * radius
  const disc = b * b - a * c
  if (disc <= 0) return 0
  const half = Math.sqrt(disc)
  return Math.max(Math.min((b + half) / a, reach) - Math.max((b - half) / a, 0), 0)
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

// A willow leaf: long and narrow, tapering to a point at both ends
function willow(ctx, length) {
  ctx.moveTo(-length, 0)
  ctx.quadraticCurveTo(-length * 0.2, -length * 0.26, length, 0)
  ctx.quadraticCurveTo(-length * 0.2, length * 0.26, -length, 0)
}

// An oak leaf: narrow at the base, widest past the middle, with rounded
// lobes down each side
const LOBES = 3 // down each side
function oak(ctx, length) {
  const width = (t) => length * 0.5 * Math.sin(Math.PI * t) ** 0.7 * (0.6 + 0.4 * Math.abs(Math.sin(LOBES * Math.PI * t)))
  ctx.moveTo(-length, 0)
  for (let i = 1; i <= 40; i++) ctx.lineTo(-length + (2 * length * i) / 40, -width(i / 40))
  for (let i = 39; i >= 0; i--) ctx.lineTo(-length + (2 * length * i) / 40, width(i / 40))
}

// A pine sprig: a thin twig with needles in pairs along it, leaning towards
// its tip and shortening there, one path so it fills in one go
function sprig(ctx, length) {
  const stem = Math.max(length * 0.04, 1.5)
  ctx.rect(-length, -stem, length * 2, stem * 2)
  const pairs = 7
  for (let i = 0; i < pairs; i++) {
    const t = i / (pairs - 1)
    const x = -length * 0.85 + t * length * 1.7
    const needle = length * 0.55 * (1 - 0.45 * t)
    const half = Math.max(length * 0.035, 1.5)
    for (const side of [-1, 1]) {
      const tipX = x + needle * Math.cos(0.75)
      const tipY = side * needle * Math.sin(0.75)
      ctx.moveTo(x - half, 0)
      ctx.lineTo(tipX, tipY)
      ctx.lineTo(x + half, 0)
      ctx.closePath()
    }
  }
}

// Textures, each four variations in a 2 x 2 atlas of 256-pixel cells,
// white leaves on black: clusters of a few dozen small leaves, thicker
// towards the middle. The willow's all hang one way, along x, so a
// hanging clump can point them down
const LEAVES = {
  'pointed cluster': (ctx, random) => cluster(ctx, random, pointed, 34, 13, 21),
  'round cluster': (ctx, random) => cluster(ctx, random, round, 30, 12, 18),
  'oak cluster': (ctx, random) => cluster(ctx, random, oak, 26, 16, 24),
  'pine needles': (ctx, random) => cluster(ctx, random, sprig, 16, 34, 52),
  'willow leaves': (ctx, random) => cluster(ctx, random, willow, 18, 40, 58, 0.7),
}

// A dropped image, after the painted ones
export const OWN_TEXTURE = 'your image'
export const LEAF_TEXTURES = [...Object.keys(LEAVES), OWN_TEXTURE]

// A leaf texture, painted once
const textures = {}
function leafTexture(name) {
  textures[name] ??= paintLeaves(name)
  return textures[name]
}

// What falls from a tree wearing each texture: one of its leaves, drawn
// with the cluster's own shape, alone and big
const ONE_OF = {
  'pointed cluster': pointed,
  'round cluster': round,
  'oak cluster': oak,
  'pine needles': (ctx, length) => sprig(ctx, length * 0.8),
  'willow leaves': willow,
}

export function fallingTexture(name) {
  const key = `one of ${name}`
  textures[key] ??= paintOne(ONE_OF[name])
  return textures[key]
}

// Four of one leaf in a 2 x 2 atlas, each filling its cell, turned a little
function paintOne(shape) {
  return paintAtlas(7, (ctx, random) => {
    ctx.fillStyle = '#fff'
    ctx.rotate((random() - 0.5) * 0.8 - Math.PI / 4)
    ctx.beginPath()
    shape(ctx, 100 + random() * 15)
    ctx.fill()
  })
}

function paintLeaves(name) {
  return paintAtlas(42, LEAVES[name])
}

// A 2 x 2 atlas of 256-pixel cells on black, each painted round its centre
// by paintCell, with a random of its own seed
function paintAtlas(seed, paintCell) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 512, 512)
  const random = mulberry32(seed)
  for (let v = 0; v < 4; v++) {
    ctx.save()
    ctx.translate((v % 2) * 256 + 128, Math.floor(v / 2) * 256 + 128)
    paintCell(ctx, random)
    ctx.restore()
  }
  return new THREE.CanvasTexture(canvas)
}

// Leaves turned any way, or within turn radians of the x axis
function cluster(ctx, random, shape, count, smallest, largest, turn) {
  ctx.fillStyle = '#fff'
  for (let i = 0; i < count; i++) {
    const d = Math.sqrt(random()) * (118 - largest)
    const t = random() * Math.PI * 2
    ctx.save()
    ctx.translate(Math.cos(t) * d, Math.sin(t) * d)
    ctx.rotate(turn ? (random() - 0.5) * turn : random() * Math.PI * 2)
    ctx.beginPath()
    shape(ctx, smallest + random() * (largest - smallest))
    ctx.fill()
    ctx.restore()
  }
}

// A dropped image as the leaves' atlases: the image in every cell, fitted
// in whole, the second and third flipped upside down, so neighbouring cards
// differ while their leaves still point the same way along x. The leaves
// are where the image is opaque, or, in an image with no transparency,
// where it's light, white leaves on black like the painted ones. Its own
// colours go in an atlas of their own. Larger cells than the painted
// ones, to keep an image's detail
const OWN_CELL = 512 // pixels
export function ownLeaves(image) {
  const size = OWN_CELL * 2
  const colors = document.createElement('canvas')
  colors.width = colors.height = size
  const ctx = colors.getContext('2d')
  const scale = Math.min(OWN_CELL / image.width, OWN_CELL / image.height)
  const width = image.width * scale
  const height = image.height * scale
  for (let v = 0; v < 4; v++) {
    ctx.save()
    ctx.translate((v % 2) * OWN_CELL + OWN_CELL / 2, Math.floor(v / 2) * OWN_CELL + OWN_CELL / 2)
    if (v === 1 || v === 2) ctx.scale(1, -1)
    ctx.drawImage(image, -width / 2, -height / 2, width, height)
    ctx.restore()
  }
  const { see, grey } = lookAt(image)
  const data = ctx.getImageData(0, 0, size, size).data
  const mask = new ImageData(size, size)
  for (let i = 0; i < data.length; i += 4) {
    const light = see ? data[i + 3] : (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) * (data[i + 3] / 255)
    mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = light
    mask.data[i + 3] = 255
  }
  const leaves = document.createElement('canvas')
  leaves.width = leaves.height = size
  leaves.getContext('2d').putImageData(mask, 0, 0)
  const colorTexture = new THREE.CanvasTexture(colors)
  colorTexture.colorSpace = THREE.SRGBColorSpace
  return { leaves: new THREE.CanvasTexture(leaves), colors: colorTexture, transparent: see, grey }
}

const TINTED = 24 // the most a pixel's channels can differ by, out of 255, and still count as grey (leaves room for JPEG noise)
const FEW_TINTED = 0.005 // tinted pixels / seen ones, below which an image is still black and white

// Whether an image has any transparency of its own, and whether the pixels
// you can see are all grey, so it has no colours worth keeping. Looked at no
// bigger than a cell
function lookAt(image) {
  const scale = Math.min(1, OWN_CELL / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let see = false
  let seen = 0
  let tinted = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) see = true
    if (data[i + 3] < 64) continue // faint edges' colours round badly
    seen++
    if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > TINTED) tinted++
  }
  return { see, grey: tinted <= seen * FEW_TINTED }
}
