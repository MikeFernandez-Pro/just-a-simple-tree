import * as THREE from 'three/webgpu'
import { alongBranch, character, createWood, GOLDEN_ANGLE, heading, mulberry32, splay, UP } from './wood.js'

// Fixed shape rules, tuned for an Italian cypress: a tall, narrow flame. One
// straight trunk, with short branches all the way up it climbing steeply
// along it, one after the next round a spiral. The crown is widest a third
// of the way up and closes to a point at the top, its leaf clumps packed
// tight against the trunk

const HEIGHT = 1.32 // the tree's height / size
const TRUNK_SEGMENTS = 14 // kinks up the trunk
const TRUNK_TAPER = 0.1 // the trunk's radius at its top / at the ground
const TRUNK_PULL = 0.5 // how hard the trunk keeps to the sky
const BARE = 0.05 // how far up the trunk, of the height, the lowest branch is
const TOP = 0.95 // and the highest
const WIDEST = 0.3 // where the crown is widest, of the height
const BASE_WIDTH = 0.65 // the crown's width at the lowest branch / at its widest
const WIDTH = 0.11 // the crown's half width at its widest / the height, at slenderness 1
const TIP = 1.6 // how sharply the crown closes to its tip: higher, blunter
const BRANCH_SEGMENTS = 3 // kinks per branch
const BRANCH_TAPER = 0.4 // a branch's radius at its end / at its start
const BRANCH_THICKNESS = 0.35 // a branch's radius / the trunk's where it grows
const RISE = 1.05 // how steeply a branch climbs off level, in radians
const DROOP = 0.12 // how far each kink bends a branch down, at droop 1: below 0, up
const PAD = 0.6 // a clump's radius / the crown's half width there
const CORES = 16 // clumps stacked up the trunk, filling the crown's middle
const SMALLEST = 0.03 // the smallest clump's radius / the height

// The cypress, its branches climbing a little rather than drooping
export const cypress = {
  name: 'cypress',
  // A flame on a short trunk
  icon:
    '<rect x="10.9" y="18" width="2.2" height="4.5" rx="0.8"/>' +
    '<path d="M12 1 C14.8 5 16 10 15.2 14.5 C14.7 17.5 13.5 19 12 19 C10.5 19 9.3 17.5 8.8 14.5 C8 10 9.2 5 12 1 Z"/>',
  sliders: ['droop', 'slenderness', 'cypressBranches'],
  settings: {
    clumpSize: 1.03,
    roundness: 0,
    flutter: 0.07,
    falling: 70,
    droop: -0.16,
  },
  grow,
}

function grow(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  // This cypress's character: taller or shorter, wider or slimmer, widest
  // lower or higher up, fuller or narrower at its foot, its tip blunter or
  // sharper, leaning a little
  const { vary, bearing } = character(params)
  const height = params.size * HEIGHT * vary(1, 0.1)
  const width = WIDTH * vary(1, 0.2)
  const widest = vary(WIDEST, 0.1)
  const baseWidth = vary(BASE_WIDTH, 0.2)
  const tip = vary(TIP, 0.5)
  const lean = splay(UP, bearing(), vary(0, 0.05))

  // The crown's half width a share of the way up the tree: from the lowest
  // branch it widens to its widest, then closes to nothing at the top
  const halfWidth = (at) => {
    const shape =
      at < widest
        ? THREE.MathUtils.lerp(baseWidth, 1, Math.max(at - BARE, 0) / (widest - BARE))
        : 1 - Math.pow((at - widest) / (1 - widest), tip)
    return (height * width * Math.max(shape, 0)) / params.slenderness
  }

  // The trunk, straight
  const trunk = wood.branch(new THREE.Vector3(), lean, height, params.trunkThickness, params.crookedness * 0.2, {
    segments: TRUNK_SEGMENTS,
    taper: TRUNK_TAPER,
    upPull: TRUNK_PULL,
  })

  // The branches, from the bottom up, each turned on from the last by the
  // golden angle, so they spread evenly round the trunk. Each is as long as
  // it takes to reach the crown's edge there, climbing as it goes
  const branches = []
  const count = params.cypressBranches
  for (let i = 0; i < count; i++) {
    const at = THREE.MathUtils.lerp(BARE, TOP, (i + random() * 0.6) / count)
    const { point, dir: trunkDir, radius: trunkRadius } = alongBranch(trunk, at)
    const around = i * GOLDEN_ANGLE + (random() - 0.5) * 0.4
    const rise = RISE + (random() - 0.5) * 0.2
    const dir = heading(around, rise)
    const length = Math.max((halfWidth(at) / Math.cos(rise)) * (0.8 + random() * 0.3), height * SMALLEST * 2)
    const from = at * height
    const { points } = wood.branch(point, dir, length, trunkRadius * BRANCH_THICKNESS, params.crookedness * 0.4, {
      parent: { dir: trunkDir, radius: trunkRadius },
      from,
      segments: BRANCH_SEGMENTS,
      taper: BRANCH_TAPER,
      upPull: -params.droop * DROOP,
    })
    branches.push({ points, length, from, at })
  }

  const { geometry, farthest } = wood.build()

  // Leaf clumps along each branch, sized to the crown's width where they
  // are, and a stack of them up the trunk filling its middle, up to the
  // trunk's tip. None smaller than a small tuft. Clump size grows them all.
  // They draw from their own random, so clump size never reshapes the
  // branches
  const leafRandom = mulberry32(params.seed + 7919)
  const tuft = height * SMALLEST
  const clumps = []
  for (const { points, length, from } of branches) {
    for (let k = 1; k <= BRANCH_SEGMENTS; k++) {
      const along = k / BRANCH_SEGMENTS
      const position = points[k].clone()
      const radius = Math.max(halfWidth(position.y / height) * PAD, tuft) * (0.85 + leafRandom() * 0.3)
      clumps.push({ position, radius: radius * params.clumpSize, birth: (from + along * length) / farthest })
    }
  }
  for (let s = 0; s <= CORES; s++) {
    const at = THREE.MathUtils.lerp(BARE, 0.999, s / CORES)
    const radius = Math.max(halfWidth(at) * PAD * 1.2, tuft)
    clumps.push({ position: alongBranch(trunk, at).point, radius: radius * params.clumpSize, birth: (at * height) / farthest })
  }

  return { geometry, clumps }
}
