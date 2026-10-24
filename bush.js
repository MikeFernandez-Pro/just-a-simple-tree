import * as THREE from 'three/webgpu'
import { character, createWood, GOLDEN_ANGLE, lopsided, mulberry32 } from './wood.js'

// Fixed shape rules, tuned for a bush: no wood at all, only leaf clumps
// heaped on the ground into a low, round dome. Each sits on the ground,
// the big ones in the middle and smaller ones round the edge, so together
// they rise in the middle

const HEIGHT = 0.5 // the bush's height / size
const WIDTH = 0.9 // how far out the edge clumps sit / the height, at spread 1
const MIDDLE = 0.5 // the middle clump's radius / the height
const EDGE = 0.3 // an edge clump's radius / the height
const SINK = 0.85 // how high a clump's centre is / its radius: below 1, a little sunk into the ground

// The bush, a heap of leaves, low enough to sit in the grass
export const bush = {
  name: 'bush',
  // A dome of puffs sitting on the ground
  icon:
    '<rect x="3" y="15" width="18" height="6.5" rx="3"/>' +
    '<circle cx="12" cy="11" r="6"/><circle cx="6.5" cy="15" r="4.5"/><circle cx="17.5" cy="15" r="4.5"/>',
  sliders: ['bushClumps', 'spread'],
  woodless: true, // so the panel hides what only changes the wood
  dropsLeaves: false, // no falling leaves, and no panel section for them
  settings: {
    size: 5.09,
    spread: 0.79,
  },
  grow,
}

function grow(params) {
  // No branches: the wood is empty, but still carries what the growing and
  // the wind read
  const { geometry } = createWood(params, mulberry32(params.seed)).build()
  // This bush's character: taller or shorter, wider or narrower, fuller on
  // one side
  const { vary, bearing } = character(params)
  const height = params.size * HEIGHT * vary(1, 0.15)
  const width = height * WIDTH * params.spread * vary(1, 0.2)
  const side = bearing()
  const heavy = vary(0, 0.2)

  // The clumps, turned round from each other by the golden angle, so they
  // spread evenly. The first sits in the middle, so a bush of one clump is a
  // single ball of leaves; the rest go further out and smaller as they go.
  // Those in the middle grow in first, the edge last. Clump size grows them
  // all. They draw from their own random, as on every species
  const random = mulberry32(params.seed + 7919)
  const clumps = []
  const count = params.bushClumps
  for (let i = 0; i < count; i++) {
    const around = i * GOLDEN_ANGLE + (random() - 0.5) * 0.4
    const out = count > 1 ? Math.sqrt(i / (count - 1)) : 0 // 0 in the middle, 1 at the edge
    const reach = width * out * (0.85 + random() * 0.3) * lopsided(around, side, heavy)
    const radius = height * THREE.MathUtils.lerp(MIDDLE, EDGE, out) * (0.85 + random() * 0.3) * params.clumpSize
    const position = new THREE.Vector3(Math.cos(around) * reach, radius * SINK, Math.sin(around) * reach)
    // With no wood to hang from, its young leaves gather at its foot
    const foot = position.clone().setY(0)
    clumps.push({ position, radius, birth: out, foot })
  }

  return { geometry, clumps }
}
