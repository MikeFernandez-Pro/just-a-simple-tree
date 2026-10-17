import * as THREE from 'three/webgpu'
import { alongBranch, character, createWood, heading, lopsided, mulberry32, splay, UP } from './wood.js'

// Fixed shape rules, tuned for a weeping willow: a short, thick trunk
// splitting into a few limbs that rise and spread like a fountain, each
// carrying a few boughs leaning further out. From the outer half of every
// limb and bough, long thin strands arch out and fall, hanging in curtains
// of leaves round a broad dome

const HEIGHT = 0.95 // the crown's height / size, roughly
const TRUNK = 0.3 // the trunk's length / the height
const TRUNK_SEGMENTS = 4 // kinks up the trunk
const TRUNK_TAPER = 0.7 // the trunk's radius at its top / at the ground
const TRUNK_THICKNESS = 1.25 // the trunk's radius / the trunk thickness: a willow's is stout
const LEAN = 0.08 // how far the trunk leans off upright, in radians
const LIMB_LENGTH = 0.6 // a limb's length / the height
const LIMB_SPREAD = 0.7 // how far a limb leans off the trunk, in radians
const LIMB_SEGMENTS = 5 // kinks per limb
const LIMB_TAPER = 0.45 // a limb's radius at its end / at its start
const LIMB_THICKNESS = 0.7 // a limb's radius / the trunk's top
const BOUGHS = 3 // boughs per limb
const BOUGH_LENGTH = 0.55 // a bough's length / its limb's
const BOUGH_SPREAD = 0.75 // how far a bough leans off its limb, in radians
const BOUGH_SEGMENTS = 4 // kinks per bough
const BOUGH_TAPER = 0.4 // a bough's radius at its end / at its start
const BOUGH_THICKNESS = 0.6 // a bough's radius / its limb's where it grows
const ARCH_PULL = 0.05 // how hard limbs and boughs keep to the sky
const STRANDS_FROM = 0.35 // how far along a limb or bough the first strands grow
const STRAND_SEGMENTS = 12 // kinks per strand
const STRAND_TAPER = 0.5 // a strand's radius at its end / at its start
const STRAND_THICKNESS = 0.05 // a strand's radius / the trunk thickness
const STRAND_SIDES = 0.5 // a strand's sides / the rest of the wood's: they're thin
const STRAND_RISE = 0.45 // how steeply a strand sets off, in radians, before it falls
const STRAND_PULL = 0.5 // how hard each kink bends a strand down
const ARCH = 0.1 // the length a strand spends arching over / the height
const GROUND_GAP = 0.05 // the lowest a strand reaches above the ground / the height
const STRAND_CLUMPS = 0.11 // the gap between clumps down a strand / the height
const STRAND_CLUMP = 0.045 // a strand's first clump's radius / the height
const STRAND_FLATTEN = 2.4 // a strand's clumps' height / their width: long, narrow tresses
const LEAVES_FROM = 0.12 // how far along a strand its first clump is
const CROWN_CLUMP = 0.07 // the clumps' radius at the limb and bough tips / the height
const CROWN_FLATTEN = 0.75 // and their height / their width: the dome's top

// The willow, tall and slender, its strands in a few big cards each, and
// swaying gently, since its strands swing more than the rest of the wood.
// Its strands hang by hang, not droop
export const willow = {
  name: 'weeping willow',
  // A dome on a tall trunk, hung with strands
  icon:
    '<rect x="10.8" y="11" width="2.4" height="11" rx="0.8"/>' +
    '<path d="M2.5 12 C2.5 6.5 6.5 3 12 3 C17.5 3 21.5 6.5 21.5 12 Z"/>' +
    '<rect x="2.5" y="9" width="2.4" height="9.5" rx="1.2"/><rect x="6" y="9" width="2.4" height="12" rx="1.2"/>' +
    '<rect x="15.6" y="9" width="2.4" height="12" rx="1.2"/><rect x="19.1" y="9" width="2.4" height="9.5" rx="1.2"/>',
  sliders: ['mainLimbs', 'willowStrands', 'hang'],
  settings: {
    crookedness: 0.72,
    clumpSize: 0.9,
    cardsPerClump: 4,
    cardSize: 2.05,
    roundness: 0.27,
    flutter: 0.12,
    falling: 150,
    mainLimbs: 5,
    size: 6.82,
    trunkThickness: 0.11,
    wind: 0.17,
  },
  grow,
}

function grow(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  // This willow's character: taller or shorter, its dome wider or narrower,
  // its curtains longer or shorter, leaning more or less, its crown heavier
  // on one side
  const { vary, bearing } = character(params)
  const height = params.size * HEIGHT * vary(1, 0.1)
  const limbSpread = LIMB_SPREAD * vary(1, 0.2)
  const hang = Math.min(params.hang * vary(1, 0.15), 1)
  const leaning = vary(LEAN, 0.07)
  const side = bearing()
  const heavy = vary(0, 0.2)

  // A short trunk, leaning a little
  const lean = splay(UP, random() * Math.PI * 2, leaning)
  const trunkLength = height * TRUNK
  const trunk = wood.branch(new THREE.Vector3(), lean, trunkLength, params.trunkThickness * TRUNK_THICKNESS, params.crookedness * 0.3, {
    segments: TRUNK_SEGMENTS,
    taper: TRUNK_TAPER,
    upPull: 0.1,
  })
  const top = trunk.points[TRUNK_SEGMENTS]
  const topDir = top.clone().sub(trunk.points[TRUNK_SEGMENTS - 1]).normalize()
  const topRadius = trunk.radii[TRUNK_SEGMENTS]

  // The limbs, rising round the trunk's top, each with its boughs leaning
  // out from its upper half. Both are arches the strands hang from
  const arches = []
  for (let l = 0; l < params.mainLimbs; l++) {
    const around = ((l + random() * 0.5) / params.mainLimbs) * Math.PI * 2
    const dir = splay(topDir, around, limbSpread * (0.8 + random() * 0.4))
    const length = height * LIMB_LENGTH * (0.85 + random() * 0.3) * lopsided(around, side, heavy)
    const limb = wood.branch(top, dir, length, topRadius * LIMB_THICKNESS, params.crookedness, {
      parent: { dir: topDir, radius: topRadius },
      from: trunkLength,
      segments: LIMB_SEGMENTS,
      taper: LIMB_TAPER,
      upPull: ARCH_PULL,
    })
    arches.push({ shape: limb, length, from: trunkLength })
    for (let b = 0; b < BOUGHS; b++) {
      const k = 2 + Math.floor(random() * (LIMB_SEGMENTS - 2))
      const { point, dir: limbDir, radius } = alongBranch(limb, k / LIMB_SEGMENTS)
      // Boughs lean away from the trunk, never back across the crown
      const outwards = Math.atan2(limbDir.z, limbDir.x)
      const boughDir = leanOut(limbDir, outwards + (random() - 0.5) * 2.2, BOUGH_SPREAD * (0.7 + random() * 0.6))
      const boughLength = length * BOUGH_LENGTH * (0.8 + random() * 0.4)
      const from = trunkLength + (k / LIMB_SEGMENTS) * length
      const bough = wood.branch(point, boughDir, boughLength, radius * BOUGH_THICKNESS, params.crookedness, {
        parent: { dir: limbDir, radius },
        from,
        segments: BOUGH_SEGMENTS,
        taper: BOUGH_TAPER,
        upPull: ARCH_PULL,
      })
      arches.push({ shape: bough, length: boughLength, from })
    }
  }

  // The strands, shared out over the arches by their length, spaced along
  // the outer part of each. Each sets off outwards and a little up, bends
  // over and falls, hanging down as far as hang takes it towards the ground
  const strands = []
  const total = arches.reduce((sum, arch) => sum + arch.length, 0)
  const strandRadius = params.trunkThickness * STRAND_THICKNESS
  let owed = 0
  for (const { shape, length, from } of arches) {
    owed += (params.willowStrands * length) / total
    const count = Math.floor(owed)
    owed -= count
    for (let s = 0; s < count; s++) {
      const along = THREE.MathUtils.lerp(STRANDS_FROM, 1, (s + 0.2 + random() * 0.6) / count)
      const { point, dir: archDir, radius } = alongBranch(shape, Math.min(along, 0.999))
      // Outwards from the trunk, or along the arch where it's over the trunk
      const out = new THREE.Vector3(point.x, 0, point.z)
      if (out.lengthSq() < 1e-4) out.set(archDir.x, 0, archDir.z)
      const around = Math.atan2(out.z, out.x) + (random() - 0.5) * 1.6
      const rise = STRAND_RISE * (0.5 + random())
      const dir = heading(around, rise)
      const room = Math.max(point.y - height * GROUND_GAP, 0)
      const drop = Math.min(room * hang * (0.8 + random() * 0.3), room)
      const strandLength = height * ARCH + drop
      const start = from + along * length
      const strand = wood.branch(point, dir, strandLength, strandRadius, params.crookedness * 0.3, {
        parent: { dir: archDir, radius: Math.min(radius, strandRadius * 2.5) },
        from: start,
        segments: STRAND_SEGMENTS,
        taper: STRAND_TAPER,
        upPull: -STRAND_PULL,
        hangs: true,
        sides: Math.max(3, Math.round(params.sides * STRAND_SIDES)),
      })
      strands.push({ shape: strand, length: strandLength, from: start, hangFrom: point.y })
    }
  }

  const { geometry, farthest } = wood.build()

  // Leaf clumps: a broad, low one at each limb and bough tip and halfway
  // along it, making the dome, and a column of long ones down every strand,
  // shrinking towards its tip, so the strands hang in tresses, their leaves
  // pointing down. Clump size
  // grows them all. They draw from their own random, so clump size never
  // reshapes the branches
  const leafRandom = mulberry32(params.seed + 7919)
  const clumps = []
  for (const { shape, length, from } of arches) {
    for (const [along, scale] of [
      [0.5, 0.75],
      [0.999, 1],
    ]) {
      const radius = height * CROWN_CLUMP * scale * (0.85 + leafRandom() * 0.3) * params.clumpSize
      const birth = (from + along * length) / farthest
      clumps.push({ position: alongBranch(shape, along).point, radius, flatten: CROWN_FLATTEN, birth })
    }
  }
  for (const { shape, length, from, hangFrom } of strands) {
    const count = Math.max(2, Math.round((length * (1 - LEAVES_FROM)) / (height * STRAND_CLUMPS)))
    for (let c = 0; c < count; c++) {
      const along = THREE.MathUtils.lerp(LEAVES_FROM, 0.999, c / (count - 1))
      const radius = height * STRAND_CLUMP * (1 - 0.45 * along) * (0.85 + leafRandom() * 0.3) * params.clumpSize
      const birth = (from + along * length) / farthest
      clumps.push({ position: alongBranch(shape, along).point, radius, flatten: STRAND_FLATTEN, hangFrom, birth })
    }
  }

  return { geometry, clumps }
}

// A direction leaning angle off dir, towards the compass bearing given
function leanOut(dir, bearing, angle) {
  const towards = new THREE.Vector3(Math.cos(bearing), 0, Math.sin(bearing))
  const axis = new THREE.Vector3().crossVectors(dir, towards)
  if (axis.lengthSq() < 1e-6) return dir.clone()
  return dir.clone().applyAxisAngle(axis.normalize(), angle)
}
