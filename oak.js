import * as THREE from 'three/webgpu'
import { alongBranch, character, createWood, lopsided, mulberry32, splay, UP } from './wood.js'

// Fixed shape rules, tuned for an oak
const SEGMENTS = 4 // kinks per branch
const LENGTH_FALLOFF = 0.7 // child length / parent length
const THICKNESS_FALLOFF = 0.7 // child radius / parent radius where it grows
const TAPER = 0.6 // radius at a branch's end / at its start
const UP_PULL = 0.06 // how much every kink bends back towards the sky
const LIMBS_SPAN = 0.7 // how far down the part of the trunk that splits a limb can leave it at split scatter 1: one always leaves from the top
const TIP_CLUMP = 0.6 // a branch tip's leaf clump radius / twig length

const SHAPE = { segments: SEGMENTS, taper: TAPER, upPull: UP_PULL }

// The oak, a short trunk splitting low into limbs that branch again. Its
// settings are the ones every species starts from, so it has none of its own
export const oak = {
  name: 'oak',
  // A round crown of three puffs on a short trunk
  icon:
    '<rect x="10.8" y="13" width="2.4" height="9" rx="0.8"/>' +
    '<circle cx="12" cy="8" r="6"/><circle cx="7" cy="11.5" r="4"/><circle cx="17" cy="11.5" r="4"/>',
  sliders: ['mainLimbs', 'levels', 'branches', 'spread', 'trunkHeight', 'splitHeight', 'splitScatter'],
  settings: {},
  grow,
}

function grow(params) {
  const random = mulberry32(params.seed)
  const wood = createWood(params, random)
  // This oak's character: taller or shorter, splitting higher or lower,
  // spreading wider or narrower, leaning a little, its crown heavier on one
  // side
  const { vary, bearing } = character(params)
  const size = params.size * vary(1, 0.12)
  const splitHeight = params.splitHeight * vary(1, 0.25)
  const spread = params.spread * vary(1, 0.2)
  const lean = splay(UP, bearing(), vary(0, 0.1))
  const side = bearing()
  const heavy = vary(0, 0.25)
  const twigs = [] // the last branches
  const freeTipped = [] // branches that carry others but end in a free tip, no child there

  // A branch and everything that grows from it
  function grow(start, dir, length, radius, depth, parent, from) {
    const { points, radii } = wood.branch(start, dir, length, radius, params.crookedness, { ...SHAPE, parent, from })
    if (depth === 0) {
      twigs.push({ points, length, from })
      return
    }
    // A bough's end is a free tip unless a child grows from it
    let forked = false
    for (let c = 0; c < params.branches; c++) {
      // Children grow along the top half of their parent, not only at its tip
      const k = 2 + Math.floor(random() * (SEGMENTS - 1))
      if (k === SEGMENTS) forked = true
      const parentDir = points[k].clone().sub(points[k - 1]).normalize()
      const around = ((c + random() * 0.5) / params.branches) * Math.PI * 2
      const childDir = splay(parentDir, around, spread * (0.6 + random() * 0.6))
      const childLength = length * LENGTH_FALLOFF * (0.8 + random() * 0.4)
      grow(
        points[k],
        childDir,
        childLength,
        radii[k] * THICKNESS_FALLOFF,
        depth - 1,
        { dir: parentDir, radius: radii[k] },
        from + (k / SEGMENTS) * length,
      )
    }
    if (!forked) freeTipped.push({ points, length, from })
  }

  // A short, thick trunk that splits low into a few heavy limbs, on top of
  // whatever bare trunk the trunk height adds, which lifts the crown without
  // shrinking it. The limbs leave the trunk's top, or, with split scatter,
  // anywhere over the part that splits, one always from the top, a limb
  // leaving lower down being longer, so it reaches as high as the rest.
  // Where they leave draws from a random of its own, so split scatter only
  // slides the limbs up and down the trunk, and at 0 nothing moves
  const splitLength = size * splitHeight
  const trunkLength = splitLength + params.trunkHeight
  const trunk = wood.branch(new THREE.Vector3(), lean, trunkLength, params.trunkThickness, params.crookedness * 0.3, { ...SHAPE, flare: params.baseFlare })
  const limbsSpan = (LIMBS_SPAN * params.splitScatter * splitLength) / trunkLength
  const scatterRandom = mulberry32(params.seed + 104729)
  // The trunk's very top, taken as it is rather than measured along the
  // trunk, so a limb there sits exactly where it always has
  const top = {
    point: trunk.points[SEGMENTS],
    dir: trunk.points[SEGMENTS].clone().sub(trunk.points[SEGMENTS - 1]).normalize(),
    radius: trunk.radii[SEGMENTS],
  }
  for (let l = 0; l < params.mainLimbs; l++) {
    const at = l === 0 ? 1 : 1 - scatterRandom() * limbsSpan
    const { point, dir: trunkDir, radius: trunkRadius } = at === 1 ? top : alongBranch(trunk, at)
    const around = ((l + random() * 0.5) / params.mainLimbs) * Math.PI * 2
    const dir = splay(trunkDir, around, spread * (0.8 + random() * 0.4))
    const length = size * (1 - splitHeight * at) * (0.7 + random() * 0.2) * lopsided(around, side, heavy)
    grow(point, dir, length, trunkRadius * 0.75, params.levels, { dir: trunkDir, radius: trunkRadius }, trunkLength * at)
  }

  const { geometry, farthest } = wood.build()

  // Leaf clumps: exactly one on every free branch tip, none at forks where a
  // child grows from the end, none anywhere else. A twig's is sized by the
  // twig, another branch's like the twigs it would carry; clump size grows
  // them all.
  // They draw from their own random, so clump size never reshapes the
  // branches
  const leafRandom = mulberry32(params.seed + 7919)
  const clumps = []
  const tips = [
    ...twigs.map((twig) => ({ points: twig.points, scale: twig.length, end: twig.from + twig.length })),
    ...freeTipped.map((branch) => ({ points: branch.points, scale: branch.length * LENGTH_FALLOFF, end: branch.from + branch.length })),
  ]
  for (const { points, scale, end } of tips) {
    const radius = scale * TIP_CLUMP * (0.8 + leafRandom() * 0.4) * params.clumpSize
    clumps.push({ position: points[SEGMENTS], radius, birth: end / farthest })
  }

  return { geometry, clumps }
}
