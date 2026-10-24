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
  instancedDynamicBufferAttribute,
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
  smoothstep,
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
import { downwind, flutter, liftBelow, packSwing, sway, unpackSwing } from './wind.js'
import { holographic, updated } from './hologram.js'

// Anime foliage after trungduyng's Blender pipeline: leaf cards scattered
// over each leaf clump, each showing a whole cluster of leaves, lit with the
// clump's normals, not their own, through the tutorial's cel colour ramp.
// The cards are fixed in the world, flat planes lying on their clump,
// and lit by the sun with its shadows, so nothing changes with the camera.
// Their ambient occlusion is worked out per card on the CPU.

const CAPACITY = 1 << 16 // most cards we'll ever draw
const E_STRIDE = 8 // numbers per card in its last buffer: its E, then the point it hangs from
const SMALLEST_CARD = 0.005 // metres: a card narrower than this, hidden or on a clump not grown yet, doesn't export
const CARD_RATIO = 1.8 // card width / clump radius
const TILT = 0.6 // how far a card leans off its clump's surface, at most
const AO_RAYS = 12 // rays per card, cosine-weighted round its normal
// The most clumps a card's AO looks at, the nearest to its own: dense
// trees like the pine have hundreds within reach, and the farther ones
// barely shade it
const AO_NEIGHBOURS = 24
const NEIGHBOUR_FADE = 0.25 // how far before being left out a neighbour starts counting for less / reach
// Clumps are leafy volumes, not solid balls: light fades with the length of
// the ray inside one, so a ray straight through a clump keeps 10% of it and
// a card just inside a neighbour's edge keeps nearly all
const LEAF_DENSITY = -Math.log(0.1) / 2 // per clump radius travelled
const AO_BOOST = 1.45 // the tutorial's AO's last factor: open leaves come out brighter
const UPRIGHT = 0.99 // how near straight up or down a card faces before its frame turns off SIDE, not UP
// A card deep inside a neighbouring clump, and so dark that its AO lets
// little light in, is hidden by the leaves round it from nearly every side,
// so it's left out: fewer cards, the same crown. Being buried alone isn't
// enough: the cards are see-through, and a tightly packed crown like the
// cypress's gets its fullness from the layers inside
const BURIED = 0.8 // distance from the neighbour's centre / its radius
const HIDDEN = 0.1 // the most light a card's AO lets in, of all, for it to be left out
const FADE_IN = 0.15 // how far a card fades back in over, past being buried or that dark / where it starts
// Where each leaf colour starts, from shadow to light. The tutorial's ramp
// has a fourth, darkest colour under 0.04545, for leaves facing away from
// its only light; here the hemisphere fills them, so none got that dark
export const LEAF_STOPS = [0, 0.49773, 0.95455]
// Each clump's colours are nudged a little off its neighbours', so a crown
// of them doesn't run together into one blob, as Simon 3D's anime bushes
// do per bush: warmer or cooler, lighter or darker, by these at variation 1
const WARMTH = 0.45 // most a clump's red goes up and its blue down, or the other way / as they are
const LIGHTNESS = 0.35 // most a clump is lighter or darker / as it is
// A clump's two draws, each 0 to 1, go into one number, as WebGPU gives the
// cards no room for another attribute: its whole part is the warmth in
// steps, its fraction the lightness
const TINT_STEPS = 256

function packTint(warmth, lightness) {
  return Math.floor(warmth * TINT_STEPS) + lightness
}

// A clump's tint, multiplied into its colours, from its packed draws at a
// variation, as [r, g, b]
function clumpTint(packed, variation) {
  const whole = Math.floor(packed)
  const light = 1 + ((packed - whole) * 2 - 1) * LIGHTNESS * variation
  const warm = (((whole + 0.5) / TINT_STEPS) * 2 - 1) * WARMTH * variation
  return [light * (1 + warm), light, light * (1 - warm)]
}

// The same in the shader, from nodes
function clumpTintNode(packed, variation) {
  const whole = floor(packed)
  const light = packed.sub(whole).mul(2).sub(1).mul(LIGHTNESS).mul(variation).add(1)
  const warm = whole.add(0.5).div(TINT_STEPS).mul(2).sub(1).mul(WARMTH).mul(variation)
  return vec3(warm.add(1), 1, warm.oneMinus()).mul(light)
}

// The leaves' age, 0 to 1: they unfold small and pale in spring, stand
// full grown in the theme's colours through summer, turn to the turned
// colours in autumn, then drop, so at 1 the tree is bare. Each card goes on
// its own beat, its order: the most open first, a clump's cards roughly
// together
const SUMMER = 0.35 // the age the page starts at: every card full grown, none turned
const FLUSH = 0.25 // the age by which every card has unfolded
const YOUNG_SIZE = 0.4 // a card's size at age 0 / its full size
const YOUNG_REACH = 0.3 // how far out a card sits at age 0 / from the twig it hangs from to its place
const YOUNG_PALE = 0.55 // how far a young card's colours go towards a pale light
const PALE_LIGHT = 0.3 // how far that pale light is lifted from the light colour towards white
const TURN_FROM = 0.45 // the age the first cards start turning
const TURN_SPAN = 0.3 // ages from the first card turning to the last
const DROP_AFTER = 0.19 // ages from a card turning to its dropping
const CHANGE = 0.05 // ages a card takes to unfold, to turn or to drop
const BY_LIGHT = 0.6 // how much a card's order follows how open it is, the rest at random
const BY_CLUMP = 0.5 // of the random part, how much is its clump's, shared by its cards
const SHED = 8 // how much faster leaves fall while the tree drops them
const DROP_FROM = TURN_FROM + DROP_AFTER // the age the first cards start dropping

// Where a card is in its life at an age, from its order: how far it has
// unfolded, turned and dropped, its size for those, and how far out it sits,
// from the nearest point on its clump's twigs to its place, as numbers. A
// young card sits close in on its twig, so it never floats off it, and
// moves out as it unfolds. The last card has dropped by age 0.99
function cardLife(age, order) {
  const { lerp, smoothstep } = THREE.MathUtils
  const unfoldAt = order * (FLUSH - CHANGE)
  const turnAt = TURN_FROM + order * TURN_SPAN
  const unfolded = smoothstep(age, unfoldAt, unfoldAt + CHANGE)
  const turned = smoothstep(age, turnAt, turnAt + CHANGE)
  const dropped = smoothstep(age, turnAt + DROP_AFTER, turnAt + DROP_AFTER + CHANGE)
  return { unfolded, turned, dropped, size: lerp(YOUNG_SIZE, 1, unfolded) * (1 - dropped), out: lerp(YOUNG_REACH, 1, unfolded) }
}

// The same in the shader, from nodes
function cardLifeNode(age, order) {
  const unfoldAt = order.mul(FLUSH - CHANGE)
  const turnAt = order.mul(TURN_SPAN).add(TURN_FROM)
  const dropAt = turnAt.add(DROP_AFTER)
  const unfolded = smoothstep(unfoldAt, unfoldAt.add(CHANGE), age)
  const turned = smoothstep(turnAt, turnAt.add(CHANGE), age)
  const dropped = smoothstep(dropAt, dropAt.add(CHANGE), age)
  return {
    unfolded,
    turned,
    dropped,
    size: mix(float(YOUNG_SIZE), float(1), unfolded).mul(dropped.oneMinus()),
    out: mix(float(YOUNG_REACH), float(1), unfolded),
  }
}

// A young card's colour band: paler, towards the light colour lifted
// towards white
function youngBand(band, light) {
  return mix(band, mix(light, vec3(1), PALE_LIGHT), YOUNG_PALE)
}

// Whether the twigs would be seen at a leaves' age: while some leaves are
// still unfolding, or once the first have dropped. Through summer every
// card is out, and the twigs are hidden under them
export function twigsShow(age) {
  return age < FLUSH || age > DROP_FROM
}

// How many leaves fall at an age, as a share of the amount: none from a tree
// just unfolding, the amount once it's in leaf, more while it drops them,
// none once it's bare
export function shedding(age) {
  const unfolded = age.div(FLUSH).clamp(0, 1)
  const left = float(1).sub(age.sub(DROP_FROM).div(1 - DROP_FROM).clamp(0, 1))
  return unfolded.mul(left).mul(left.oneMinus().mul(SHED).add(1))
}

// The share of the falling leaves in the turned colours: the cards to turn
// first are the ones to drop first, so all of them by halfway through the
// turning
export function fallingTurned(age) {
  return age.sub(TURN_FROM).div(TURN_SPAN / 2).clamp(0, 1)
}

export function createFoliage() {
  // Per card: centre and size; the clump's normal there and the card's AO;
  // the card's own facing and its spin round it; its clump's centre and its
  // swing in the wind, packed;
  // how far along the wood from the ground its clump is, how far below
  // where it hangs from the card is, and its order through the age; its
  // clump's tint draws, packed; and the nearest point on its clump's twigs,
  // which it hangs from. Those last two share one buffer, E's four numbers
  // then the point's, as WebGPU gives the cards no room for another
  const cardA = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardB = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardC = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardD = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const cardE = new THREE.InstancedInterleavedBuffer(new Float32Array(CAPACITY * E_STRIDE), E_STRIDE)
  const cardAttributes = [cardA, cardB, cardC, cardD, cardE]
  for (const attribute of cardAttributes) attribute.setUsage(THREE.DynamicDrawUsage)

  const uniforms = {
    crownCenter: uniform(new THREE.Vector3()),
    crownSize: uniform(new THREE.Vector3(1, 1, 1)),
    shadowSide: uniform(0.435), // the multiply factor of the tutorial's gradient
    ao: uniform(0.54), // the multiply factor of the tutorial's AO
    variation: uniform(0.25), // how far each clump's colours stray from the others', 0 to 1
    cardSize: uniform(0.92), // grows the cards without adding any
    roundness: uniform(0.58), // how far cards wrap round their clump
    textured: uniform(1), // 0 shows the bare cards
    showNormals: uniform(0), // 1 draws the normals as colours
    imageColors: uniform(0), // 1 colours the leaves with a dropped image's own colours, 0 with the ramp's
    // The tutorial's foliage ramp, its darkest colour left out: three
    // colours with flat bands between short blends
    colors: [
      linear(0.0356, 0.20508, 0.05781),
      linear(0.0865, 0.34191, 0.05613),
      linear(0.3447, 0.59669, 0.13836),
    ],
    // What they turn to in autumn, the same three bands
    turned: [linear(0.6, 0.12, 0.02), linear(0.89, 0.36, 0.04), linear(0.93, 0.68, 0.15)],
    age: uniform(SUMMER), // the leaves' age, 0 to 1: unfolding, summer, turning, bare
  }
  const u = uniforms
  // As drawn: a new theme sweeps in over the old
  const [shadow, mid, light] = u.colors.map((color) => swept(color))
  const turnedBands = u.turned.map((color) => swept(color))

  const a = instancedBufferAttribute(cardA)
  const b = instancedBufferAttribute(cardB)
  const c = instancedBufferAttribute(cardC)
  const d = instancedBufferAttribute(cardD)
  const e = instancedDynamicBufferAttribute(cardE, 'vec4', E_STRIDE, 0)
  const twig = instancedDynamicBufferAttribute(cardE, 'vec4', E_STRIDE, 4).xyz
  const center = a.xyz
  const life = cardLifeNode(u.age, e.z)

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
    // it blows away it keeps its size, as the wood folds back under it. Its
    // age sizes it too: small while it unfolds, close in on its twig, moving
    // out to its place as it grows, and shrinking to nothing as it drops
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
    const placed = clump.add(mix(twig, center, life.out).sub(clump).mul(size))
    return placed.add(blown).add(tumbled.mul(size.mul(left).mul(life.size))).add(sway(center, e.y, unpackSwing(d.w)))
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
  const normal = normalize(b.xyz)
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normal, 0)).xyz)

  // Colour: the lit value through the three colours, at its band edges,
  // hard-edged. A young card's are paler until it has unfolded
  const shade = (bands) => celShade(LEAF_STOPS.map((at, i) => [at, bands[i]]))
  let color = shade([shadow, mid, light].map((band) => mix(youngBand(band, light), band, life.unfolded)))

  // Or a dropped image's own colours, kept to the ramp's bands: each band
  // as much darker or lighter than the mid colour as the ramp makes it
  const band = dot(color, LUMA).div(dot(mid, LUMA).max(1e-4))
  const imageColors = mix(oldImageColors, u.imageColors, updated)
  color = mix(color, mix(oldColors.rgb, ownColors.rgb, updated).mul(band), imageColors.mul(u.textured))

  // A card turning takes the turned colours, in place of an image's own too
  color = mix(color, shade(turnedBands), life.turned)

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

  // The clump's own tint, multiplied in after the ramp, so its bands stay
  // where they are
  color = color.mul(clumpTintNode(e.w, u.variation))

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
  // Shown when asked to be and there are cards to show, and not while the
  // clumps are, so they can be seen
  let shown = true
  let clumpsShown = false
  const showIfAny = () => (mesh.visible = shown && !clumpsShown && mesh.count > 0)
  function setShown(value) {
    shown = value
    showIfAny()
  }
  function setClumpsShown(value) {
    clumpsShown = value
    clumpView.mesh.visible = value
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
      const clumps = grownClumps.map(({ flatten = 1, ...clump }) => {
        return { ...clump, flatten, hanging: clump.hangFrom !== undefined, bound: clump.radius * Math.max(flatten, 1) }
      })
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

    // Cards per clump scale with its full grown area, so cardsPerClump is
    // the count on a clump of average size, and a young tree's clumps have
    // as many as they'll ever have, growing out with them
    const fullArea = (c) => (c.fullRadius ?? c.radius) ** 2
    const meanArea = clumps.reduce((sum, c) => sum + fullArea(c), 0) / Math.max(clumps.length, 1)

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
    const hangsFrom = new THREE.Vector3()
    const euler = new THREE.Euler()
    const blocking = []
    let n = 0
    // A clump may be flattened, squashed upright into a pad: its cards lie
    // on the squashed surface and take its normals, so a pad lights like one
    // on its top and darkens under it. Above 1 it's stretched upright
    // instead. One that hangs, from the height hangFrom, turns its cards so
    // their leaves point down, and swings in the wind from there. A card
    // that's hidden keeps its place at no size, so the cards after it keep
    // theirs, and their leaves and flutter with them. Each card hangs from
    // the nearest point on its clump's twigs, or, if it has none, from its
    // foot on the ground, or its centre
    clumps.forEach((clump, c) => {
      const { position, radius, flatten, hangFrom, hanging, birth, swing = NO_SWING, twigs = [], foot = position } = clump
      const cards = Math.max(1, Math.round((params.cardsPerClump * fullArea(clump)) / meanArea))
      // Each clump's cards draw from randoms of its own, so a change to one
      // clump never moves another's. Their tilts draw from their own, so the
      // rest of the scatter doesn't depend on how many draws a tilt takes,
      // and so do their orders through the age
      const seed = params.seed + c * 7919
      const random = mulberry32(seed + 104729)
      const tiltRandom = mulberry32(seed + 15485863)
      const orderRandom = mulberry32(seed + 32452843)
      const tintRandom = mulberry32(seed + 49979687)
      // Turn each clump's pattern randomly, so no two clumps line up
      turn.setFromEuler(euler.set(random() * 6.28, random() * 6.28, random() * 6.28))
      const clumpOrder = orderRandom()
      const tint = packTint(tintRandom(), tintRandom())
      for (let i = 0; i < cards && n < CAPACITY; i++) {
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
        const size = CARD_RATIO * radius * (0.8 + random() * 0.4)
        const twist = spin(lean, random(), hanging)
        const chance = THREE.MathUtils.lerp(orderRandom(), clumpOrder, BY_CLUMP)

        const burial = params.keepBuried ? 0 : buried(p, near[c])

        // AO: how much light gets in along rays round the normal, within
        // reach, each neighbour by its weight. A clump wholly behind the card
        // or out of reach stops none of them, so it's left out before
        // they're cast
        const weights = near[c].weights
        blocking.length = 0
        near[c].forEach((o, k) => {
          ray.subVectors(o.position, p)
          if (weights[k] > 0 && ray.dot(normal) > -o.bound && ray.length() - o.bound < reach) blocking.push(k)
        })
        toNormal.setFromUnitVectors(UP, normal)
        let open = 0
        for (const hemisphere of AO_DIRECTIONS) {
          ray.copy(hemisphere).applyQuaternion(toNormal)
          let through = 0
          for (const k of blocking) {
            const o = near[c][k]
            through += (weights[k] * chord(p, ray, o.position, o.radius, reach, o.flatten)) / o.radius
          }
          open += Math.exp(-LEAF_DENSITY * through)
        }

        // Hidden as far as it's both buried and dark, fading in as it comes
        // out of either
        const dark = 1 - THREE.MathUtils.smoothstep(open / AO_RAYS, HIDDEN, HIDDEN * (1 + FADE_IN))
        const shown = 1 - burial * dark

        // Its order through the age: the more open, the sooner it turns
        const order = THREE.MathUtils.lerp(chance, 1 - open / AO_RAYS, BY_LIGHT)

        A.set([p.x, p.y, p.z, size * shown], n * 4)
        B.set([normal.x, normal.y, normal.z, open / AO_RAYS], n * 4)
        C.set([lean.x, lean.y, lean.z, twist], n * 4)
        D.set([position.x, position.y, position.z, packSwing(swing)], n * 4)
        if (twigs.length) nearestOnTwigs(p, position, twigs, hangsFrom)
        else hangsFrom.copy(foot)
        cardE.array.set([birth, liftBelow(hangFrom, p.y), order, tint, hangsFrom.x, hangsFrom.y, hangsFrom.z, 0], n * E_STRIDE)
        n++
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

  // The cards as they stand with no wind, as plain meshes for export, the
  // shader's work done here: each card's shape and place, the clump's
  // normals, its cell of the texture, and the gradient and AO, times its
  // clump's tint, as a colour per card in the vertex colours. Those can't go
  // over 1 in a glTF, so they're stored divided by the brightest they can
  // be, which comes back as shadeScale. Each card goes in a part by its age, the part's own ramp
  // standing for the colours it has then: young until it has half unfolded,
  // turned once it has half turned, the rest as they are. One that has
  // dropped is left out, the others are at their size for their age
  function bake() {
    const plane = cards[segments]
    const random = mulberry32(1)
    const brightestTint = (1 + LIGHTNESS * u.variation.value) * (1 + WARMTH * u.variation.value)
    const shadeScale = THREE.MathUtils.lerp(1, AO_BOOST, u.ao.value) * brightestTint
    const own = u.imageColors.value ? ownColors.value : null
    const ramp = u.colors.map((color) => color.value)
    const pale = ramp[2].clone().lerp(new THREE.Color(1, 1, 1), PALE_LIGHT)
    const parts = [
      { name: 'leaves', colors: ramp, own, cards: [] },
      { name: 'young leaves', colors: ramp.map((color) => color.clone().lerp(pale, YOUNG_PALE)), own, cards: [] },
      { name: 'turned leaves', colors: u.turned.map((color) => color.value), own: null, cards: [] },
    ]
    for (let n = 0; n < mesh.count; n++) {
      // One cell of the 2 x 2 atlas per card
      const variant = Math.floor(random() * 4)
      const life = cardLife(u.age.value, cardE.array[n * E_STRIDE + 2])
      if (life.size === 0 || !grown(n)) continue
      const part = life.turned >= 0.5 ? parts[2] : life.unfolded < 0.5 ? parts[1] : parts[0]
      part.cards.push({ n, variant, size: life.size, out: life.out })
    }
    return {
      parts: parts
        .filter((part) => part.cards.length > 0)
        .map(({ cards, ...part }) => ({ ...part, geometry: bakeCards(cards, plane, shadeScale) })),
      shadeScale,
      texture: leaves.value,
    }
  }

  // Where card n sits, a share out of the way from the point on its twigs
  // it hangs from to its place, into target, as the shader places it
  const resting = new THREE.Vector3()
  function hungAt(n, out, target) {
    const E = cardE.array
    return target
      .set(E[n * E_STRIDE + 4], E[n * E_STRIDE + 5], E[n * E_STRIDE + 6])
      .lerp(resting.fromArray(cardA.array, n * 4), out)
  }

  // Some of the cards, each { n, variant, size, out }, as one geometry
  function bakeCards(baked, plane, shadeScale) {
    const corners = plane.attributes.position.count
    const count = baked.length
    const positions = new Float32Array(count * corners * 3)
    const normals = new Float32Array(count * corners * 3)
    const uvs = new Float32Array(count * corners * 2)
    const colors = new Float32Array(count * corners * 3)
    const index = []

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
    const hung = new THREE.Vector3()

    for (let k = 0; k < count; k++) {
      const { n, variant, size: aged, out } = baked[k]
      center.fromArray(A, n * 4)
      hungAt(n, out, hung)
      facing.fromArray(C, n * 4)
      clump.fromArray(D, n * 4)
      normal.fromArray(B, n * 4).normalize()
      const spin = C[n * 4 + 3]
      const size = A[n * 4 + 3] * u.cardSize.value * aged
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
      const tint = clumpTint(cardE.array[n * E_STRIDE + 3], u.variation.value).map((t) => t * shade)

      const cell = [variant % 2, Math.floor(variant / 2)]

      for (let v = 0; v < corners; v++) {
        const i = k * corners + v
        corner.fromBufferAttribute(plane.attributes.position, v)
        flat
          .copy(tangent)
          .multiplyScalar(corner.x)
          .addScaledVector(bitangent, corner.y)
          .addScaledVector(facing, corner.z)
          .multiplyScalar(size)
          .add(center)
        wrapped.subVectors(flat, clump).normalize().multiplyScalar(distance).add(clump)
        flat.lerp(wrapped, u.roundness.value).sub(center).add(hung).toArray(positions, i * 3)
        normal.toArray(normals, i * 3)
        uvs[i * 2] = (plane.attributes.uv.getX(v) + cell[0]) * 0.5
        uvs[i * 2 + 1] = (plane.attributes.uv.getY(v) + cell[1]) * 0.5
        colors.set(tint, i * 3)
      }
      for (let j = 0; j < plane.index.count; j++) index.push(k * corners + plane.index.getX(j))
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(index)
    return geometry
  }

  // Whether card n is there at all: not one hidden in a neighbouring clump,
  // nor one of a clump a young tree hasn't grown yet
  function grown(n) {
    return cardA.array[n * 4 + 3] * u.cardSize.value > SMALLEST_CARD
  }

  // Each card still on the tree at its age, and its size and how far out
  // it sits for it
  function onTree() {
    const on = []
    for (let n = 0; n < mesh.count; n++) {
      const { size, out } = cardLife(u.age.value, cardE.array[n * E_STRIDE + 2])
      if (size > 0 && grown(n)) on.push({ n, size, out })
    }
    return on
  }

  // How much of the tree is in leaf, 0 to 1: the cards on it, each by its
  // size, a young one counting for less, over all the cards it grew. Its
  // leaves' age takes it down as they drop
  function leafiness() {
    let all = 0
    for (let n = 0; n < mesh.count; n++) if (grown(n)) all++
    if (!all) return 0
    return onTree().reduce((sum, { size }) => sum + size, 0) / all
  }

  // How many vertices bake gives: every card's own, none shared
  function bakedVertices() {
    return onTree().length * cards[segments].attributes.position.count
  }

  // Where the cards' leaves reach with no wind: each card's centre and
  // half its width, as [x, y, z, radius]. The painted clusters fill the
  // circle inside a card, not its corners
  function reach() {
    const A = cardA.array
    const at = new THREE.Vector3()
    return onTree().map(({ n, size, out }) => [...hungAt(n, out, at).toArray(), A[n * 4 + 3] * u.cardSize.value * size * 0.5])
  }

  // The clumps themselves, hidden, but handy to see
  const clumpView = createClumpView([shadow, mid, light])

  return {
    mesh,
    clumps: clumpView.mesh,
    uniforms,
    update,
    setShown,
    setClumpsShown,
    setLeafTexture,
    holdLeaves,
    setSegments,
    bake,
    bakedVertices,
    leafiness,
    reach,
  }
}

// The leaf clumps the cards are scattered over, drawn as they are: each a
// sphere, or a pad when its species flattens it, or a tress when it
// stretches it, swaying with the wood. Cel shaded through the leaves' bands,
// like the cards, and casting the floor's shadow while the cards are away
const MAX_CLUMPS = 8192 // most clumps it draws
const NO_SWING = { flex: 0, phase: 0 }
function createClumpView(bands) {
  const sphere = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLUMPS * 4), 4) // centre, radius
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLUMPS * 4), 4) // flatten, lift, swing's flex and beat
  sphere.setUsage(THREE.DynamicDrawUsage)
  shape.setUsage(THREE.DynamicDrawUsage)
  const s = instancedBufferAttribute(sphere)
  const f = instancedBufferAttribute(shape)
  const material = new THREE.MeshLambertNodeMaterial({ color: new THREE.Color().setRGB(ALBEDO, ALBEDO, ALBEDO) })
  material.positionNode = s.xyz.add(sway(s.xyz, f.y, f.zw)).add(positionGeometry.mul(vec3(1, f.x, 1)).mul(s.w))
  material.receivedShadowNode = tintShadow
  material.outputNode = vec4(toneMapped(celShade(LEAF_STOPS.map((at, i) => [at, bands[i]]))), 1)
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), material)
  mesh.castShadow = mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.count = 0

  function update(clumps) {
    mesh.count = Math.min(clumps.length, MAX_CLUMPS)
    for (let i = 0; i < mesh.count; i++) {
      const { position, radius, flatten, hangFrom, swing = NO_SWING } = clumps[i]
      sphere.array.set([position.x, position.y, position.z, radius], i * 4)
      shape.array.set([flatten, liftBelow(hangFrom, position.y), swing.flex, swing.phase], i * 4)
    }
    if (mesh.count > 0) for (const attribute of [sphere, shape]) uploadFirst(attribute, mesh.count)
  }

  return { mesh, update }
}

// Send only an attribute's first count instances to the GPU on its next
// upload, not the whole buffer. An interleaved buffer has a stride where
// an attribute has its item size
function uploadFirst(attribute, count) {
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, count * (attribute.stride ?? attribute.itemSize))
  attribute.needsUpdate = true
}

// The nearest point to p on a clump's twigs, each a line through its kinks,
// into out; the clump's centre, where they all start, if it has none
const onStretch = new THREE.Vector3()
const stretch = new THREE.Vector3()
function nearestOnTwigs(p, center, twigs, out) {
  out.copy(center)
  let best = p.distanceToSquared(center)
  for (const kinks of twigs) {
    for (let k = 1; k < kinks.length; k++) {
      stretch.subVectors(kinks[k], kinks[k - 1])
      const t = THREE.MathUtils.clamp(stretch.dot(onStretch.subVectors(p, kinks[k - 1])) / Math.max(stretch.lengthSq(), 1e-12), 0, 1)
      onStretch.copy(kinks[k - 1]).addScaledVector(stretch, t)
      const distance = p.distanceToSquared(onStretch)
      if (distance < best) {
        best = distance
        out.copy(onStretch)
      }
    }
  }
  return out
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
// offered, which is by index, a tie going to the one offered first. Each
// counts for less the nearer it is to being left out, by reach or by the
// one past the last, in its weights, so a neighbour moving in or out of
// them changes nothing at once
function nearestClumps(clumps, reach) {
  const kept = AO_NEIGHBOURS + 1 // and one past them, to weigh the last against
  const near = clumps.map(() => [])
  const nearGaps = clumps.map(() => [])
  function offer(i, o, gap) {
    if (gap >= clumps[i].radius * 0.05 + reach) return
    const nearest = near[i]
    const gaps = nearGaps[i]
    const full = nearest.length === kept
    if (full && gap >= gaps[kept - 1]) return
    let k = full ? kept - 1 : nearest.length
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
  near.forEach((nearest, i) => {
    const gaps = nearGaps[i]
    const out = Math.min(clumps[i].radius * 0.05 + reach, nearest.length === kept ? gaps[kept - 1] : Infinity)
    nearest.length = Math.min(nearest.length, AO_NEIGHBOURS)
    nearest.weights = nearest.map((_, k) => THREE.MathUtils.clamp((out - gaps[k]) / (reach * NEIGHBOUR_FADE), 0, 1))
  })
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

// How buried a point is in a clump's neighbours, each a sphere squashed
// upright by its flatten, 0 to 1: 1 deep inside one, easing to 0 on the
// way out to BURIED of its radius, so a card a growing clump moves out of
// it comes back gradually. Overlapping ones are always among the
// neighbours, the nearest by the gap between their surfaces
function buried(point, neighbours) {
  let most = 0
  neighbours.forEach(({ position, radius, flatten }, k) => {
    const x = point.x - position.x
    const y = (point.y - position.y) / flatten
    const z = point.z - position.z
    const depth = Math.sqrt(x * x + y * y + z * z) / (BURIED * radius)
    most = Math.max(most, neighbours.weights[k] * (1 - THREE.MathUtils.smoothstep(depth, 1 - FADE_IN, 1)))
  })
  return most
}

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
