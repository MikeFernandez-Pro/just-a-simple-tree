import * as THREE from 'three/webgpu'
import { alongBranch, character, createWood, heading, lopsided, mulberry32, splay, UP } from './wood.js'

// Fixed shape rules, tuned for a spooky tree, after Tim Burton's: near
// dead, its thick trunk bent into an S, its roots sprawling over the
// ground, its branches zigzagging out in sharp turns and its twigs curling
// over into spirals at their tips, a few of them still holding a last
// small clump of leaves

const TRUNK = 0.5 // the trunk's length / size
const TRUNK_SEGMENTS = 6 // kinks up the trunk
const TRUNK_TAPER = 0.5 // the trunk's radius at its top / at the ground
const TRUNK_CROOKED = 0.4 // how much the trunk kinks / the branches
const TWIST = [0.45, 0.45, 0.15, -0.35, -0.5, -0.5] // radians each kink up the trunk bends at twist 1, one way and back: an S
const LIMBS_SPAN = 0.3 // how far down the trunk a limb may leave it / its length: one always leaves from the top
const LIMB_LENGTH = 0.7 // a limb's length / size, from the trunk's top
const LIMB_THICKNESS = 0.8 // a limb's radius / the trunk's where it leaves
const SEGMENTS = 5 // kinks per branch
const LENGTH_FALLOFF = 0.7 // child length / parent length
const THICKNESS_FALLOFF = 0.75 // child radius / parent radius where it grows
const TAPER = 0.55 // radius at a branch's end / at its start
const UP_PULL = 0.07 // how much every kink bends back towards the sky: little, so they reach out more than up
const LOWEST = -0.15 // how far down a branch may set off, as its direction's height: none dive into the ground
const CROOKED = 1.4 // how much the branches kink / the crookedness
const ZIGZAG = 0.55 // radians each kink of a branch bends, one way then the other, in sharp turns
const TWIG_SEGMENTS = 7 // kinks per twig, the last few curling
const CURL = [0, 0, 0.5, 0.9, 1.2, 1.4, 1.6] // radians each kink of a twig curls, at its tip the most
const CURL_TIGHTEN = 0.8 // a curling kink's length / the one before, so it winds in
const CURL_EASE = 0.25 // how far past a twig's draw the curls slider goes before it's curled right over
const TIP = { reach: 0.35, thin: 0.3 } // a twig's tip thinning, after Last Light's dead trees: over the last 0.35 of it, down to 0.3 of its taper's radius
const LEAF_KINK = 3 // the kink of a twig its leaves gather at, before it curls
const LEAF_CLUMP = 0.18 // a leaf clump's radius / its twig's length: small and sparse
const ROOT_LENGTH = 0.4 // a root's length / size
const ROOT_THICKNESS = 0.7 // a root's radius / the trunk's at the ground
const ROOT_SEGMENTS = 5 // kinks per root
const ROOT_TAPER = 0.15 // a root's radius at its end / at its start
const ROOT_DIP = -0.12 // how steeply a root sets off from the trunk, in radians
const ROOT_PULL = 0.07 // how much every kink of a root bends it level again, so it crawls over the ground
const PUMPKIN_GAP = 0.12 // metres between the trunk's flared foot and a pumpkin
const PUMPKIN_REACH = { pair: 0.6, carved: 0.42 } // metres from a pumpkin's middle to its back: the pair side by side, the carved one alone

const BRANCH = { segments: SEGMENTS, taper: TAPER, upPull: UP_PULL }

// The spooky tree, near dead, only a few of its twigs still holding leaves.
// Its branches sway less in the wind, being dead and stiff
export const spooky = {
  name: 'spooky',
  // A thick trunk bent into an S, its branches zigzagging out and curling
  icon:
    '<path d="M4 22 C8.5 21.2 10.2 19.5 10 16.5 C9.8 13.8 12.6 12.5 11.8 9.2 L14.2 9 C15 12.4 12.4 14.2 13 16.6 C13.5 19 15.2 21 20 22 Z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="' +
    'M12.4 10.2 L8.5 8 L5.5 9 L4.2 6.4 C3.6 4.6 6.2 4 6.4 5.8 ' +
    'M10.8 14.5 L6.5 13.2 L3.5 14.4 L3 17 ' +
    'M13.6 10.2 L17.2 7.6 L16.4 4.6 C16.2 2.8 19 2.6 18.8 4.4 ' +
    'M12.8 14 L17.5 12.6 L20 14 C21.4 15 20.4 16.8 19.2 16 ' +
    'M13 9.4 L12 5.6 L13.6 2.6"/>',
  theme: 'night', // the one theme it stands under: it shows at night alone, and picking it brings the night on
  sliders: ['mainLimbs', 'levels', 'branches', 'spread', 'trunkHeight', 'twist', 'curls', 'roots', 'leavesLeft'],
  settings: {
    size: 5.2,
    trunkThickness: 0.42,
    baseFlare: 1.5,
    crookedness: 0.55,
    spread: 1,
    mainLimbs: 4,
    levels: 2,
    branches: 3,
    smoothness: 3,
    wind: 0.1,
    cardsPerClump: 12,
    falling: 20,
  },
  grow,
}

function grow(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  // This tree's character: taller or shorter, more or less bent, spreading
  // wider or narrower, leaning a little, its crown heavier on one side
  const { vary, bearing } = character(params)
  const size = params.size * vary(1, 0.12)
  const twist = params.twist * vary(1, 0.3)
  const spread = params.spread * vary(1, 0.15)
  const lean = splay(UP, bearing(), vary(0, 0.12))
  const twistAround = bearing()
  const side = bearing()
  const heavy = vary(0, 0.25)
  const crooked = params.crookedness * CROOKED
  const twigs = [] // the last branches, the only ones that may hold leaves

  // A branch and everything that grows from it. Every branch zigzags in its
  // own plane; a twig, the last, curls over at its tip, as far as the curls
  // slider takes it past the twig's own draw, so dragging it curls them
  // over one after another
  function grow(start, dir, length, radius, depth, parent, from) {
    const bendAround = random() * Math.PI * 2
    const zig = random() < 0.5 ? ZIGZAG : -ZIGZAG
    if (depth === 0) {
      const curled = THREE.MathUtils.smoothstep(params.curls * (1 + CURL_EASE) - random(), 0, CURL_EASE)
      const bends = CURL.map((curl, i) => (i % 2 ? zig : -zig) * (1 - curled) * 0.6 + curl * curled)
      const tighten = THREE.MathUtils.lerp(1, CURL_TIGHTEN, curled)
      const { points } = wood.branch(start, dir, length, radius, crooked, { ...BRANCH, segments: TWIG_SEGMENTS, parent, from, bends, bendAround, tighten, tip: TIP })
      twigs.push({ points, length, from })
      return
    }
    const bends = Array.from({ length: SEGMENTS }, (_, i) => (i % 2 ? zig : -zig) * (i === 0 ? 0.5 : 1))
    const { points, radii } = wood.branch(start, dir, length, radius, crooked, { ...BRANCH, parent, from, bends, bendAround })
    for (let c = 0; c < params.branches; c++) {
      // Children grow along the outer part of their parent, the last from
      // its end, so it forks rather than stopping short
      const k = c === 0 ? SEGMENTS : 2 + Math.floor(random() * (SEGMENTS - 2))
      const parentDir = points[k].clone().sub(points[k - 1]).normalize()
      const around = ((c + random() * 0.5) / params.branches) * Math.PI * 2
      const childDir = splay(parentDir, around, spread * (0.5 + random() * 0.6))
      childDir.setY(Math.max(childDir.y, LOWEST)).normalize()
      const childLength = length * LENGTH_FALLOFF * (0.8 + random() * 0.4)
      grow(points[k], childDir, childLength, radii[k] * THICKNESS_FALLOFF, depth - 1, { dir: parentDir, radius: radii[k] }, from + (k / SEGMENTS) * length)
    }
  }

  // A thick trunk bent into an S, as far as the twist takes it, on top of
  // whatever bare trunk the trunk height adds. The limbs leave its top, one
  // always from the very top, the rest along the top part of it, a limb
  // leaving lower down being longer, so it reaches as far as the rest
  const splitLength = size * TRUNK
  const trunkLength = splitLength + params.trunkHeight
  const bends = TWIST.map((bend) => bend * twist)
  const trunk = wood.branch(new THREE.Vector3(), lean, trunkLength, params.trunkThickness, params.crookedness * TRUNK_CROOKED, {
    segments: TRUNK_SEGMENTS,
    taper: TRUNK_TAPER,
    upPull: 0,
    flare: params.baseFlare,
    bends,
    bendAround: twistAround,
  })
  const limbsSpan = (LIMBS_SPAN * splitLength) / trunkLength
  const top = {
    point: trunk.points[TRUNK_SEGMENTS],
    dir: trunk.points[TRUNK_SEGMENTS].clone().sub(trunk.points[TRUNK_SEGMENTS - 1]).normalize(),
    radius: trunk.radii[TRUNK_SEGMENTS],
  }
  for (let l = 0; l < params.mainLimbs; l++) {
    const at = l === 0 ? 1 : 1 - random() * limbsSpan
    const { point, dir: trunkDir, radius: trunkRadius } = at === 1 ? top : alongBranch(trunk, at)
    const around = ((l + random() * 0.5) / params.mainLimbs) * Math.PI * 2
    // The one from the top heads on up; those from the side reach out
    const dir = splay(trunkDir, around, spread * (l === 0 ? 0.35 : 0.9 + random() * 0.3))
    const length = size * LIMB_LENGTH * (1 + TRUNK * (1 - at)) * (0.75 + random() * 0.25) * lopsided(around, side, heavy)
    grow(point, dir, length, trunkRadius * LIMB_THICKNESS, params.levels, { dir: trunkDir, radius: trunkRadius }, trunkLength * at)
  }

  // Roots crawling out over the ground from the trunk's foot, dipping into
  // it and out again. They're grown last, from a random of their own, so
  // the roots slider never moves the branches
  const rootRandom = mulberry32(params.seed + 6007)
  const footRadius = params.trunkThickness
  const roots = Math.round(params.roots)
  const rootBearings = []
  for (let r = 0; r < roots; r++) {
    const around = ((r + rootRandom() * 0.6) / Math.max(roots, 1)) * Math.PI * 2
    const out = heading(around, 0)
    const start = out.clone().multiplyScalar(footRadius * 0.4).setY(footRadius)
    const length = size * ROOT_LENGTH * (0.6 + rootRandom() * 0.6)
    rootBearings.push(around + (rootRandom() - 0.5) * 0.4)
    const dir = heading(rootBearings[r], ROOT_DIP)
    wood.branch(start, dir, length, footRadius * ROOT_THICKNESS * (0.7 + rootRandom() * 0.5), params.crookedness * CROOKED * 0.5, {
      segments: ROOT_SEGMENTS,
      taper: ROOT_TAPER,
      upPull: ROOT_PULL,
      bends: Array.from({ length: ROOT_SEGMENTS }, (_, i) => (i % 2 ? 0.3 : -0.3)),
      bendAround: Math.PI / 2,
    })
  }

  const { geometry, farthest } = wood.build()

  // A few leaves still clinging on: a small clump on some of the twigs,
  // where it starts to curl, as many as the leaves left slider keeps. Each
  // twig makes its draws whether it keeps leaves or not, so the slider only
  // takes clumps away, never moves the rest. They draw from their own
  // random, so the leaves never reshape the branches
  const leafRandom = mulberry32(params.seed + 7919)
  const clumps = []
  for (const { points, length, from } of twigs) {
    const keeps = leafRandom() < params.leavesLeft
    const radius = length * LEAF_CLUMP * (0.7 + leafRandom() * 0.6) * params.clumpSize
    if (keeps) clumps.push({ position: points[LEAF_KINK], radius, birth: (from + (length * LEAF_KINK) / TWIG_SEGMENTS) / farthest })
  }

  // And pumpkins at its foot
  return { geometry, clumps, pumpkins: pumpkins(rootBearings, footRadius * (1 + params.baseFlare)) }
}

// Where the pumpkins (pumpkins.js) go round a trunk whose foot spreads to
// foot metres, out of the way of its roots, heading out along rootBearings:
// each in the middle of a gap between two of them, the pair in the first,
// the carved one in the gap across the trunk from it, each looking out
function pumpkins(rootBearings, foot) {
  const n = rootBearings.length
  // With no more than one root, there's only one gap, all the way round
  const gaps =
    n >= 2
      ? rootBearings.map((around, r) => (around + (rootBearings[(r + 1) % n] + (r === n - 1 ? Math.PI * 2 : 0))) / 2)
      : [1 / 3, 2 / 3].map((share) => (rootBearings[0] ?? 0) + share * Math.PI * 2)
  const at = { pair: gaps[0], carved: gaps[n >= 2 ? Math.floor(n / 2) : 1] }
  return Object.fromEntries(
    Object.entries(at).map(([name, around]) => [name, { position: heading(around, 0).multiplyScalar(foot + PUMPKIN_GAP + PUMPKIN_REACH[name]), around }]),
  )
}
