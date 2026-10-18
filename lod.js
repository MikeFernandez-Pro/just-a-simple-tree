import * as THREE from 'three/webgpu'

// Levels of detail for the GLB: the tree as it is, then lighter copies of
// it for farther away, each grown again from the same seed, so the wood
// keeps its shape and the leaves their clumps. Fewer sides round each
// branch and rings along it, and fewer cards, grown to cover what the
// missing ones did, uncut

const LEVELS = [
  { sides: 1, smoothness: 1, cards: 1 }, // the tree as it is
  { sides: 0.6, smoothness: 0.5, cards: 0.45 },
  { sides: 0.4, smoothness: 0.34, cards: 0.2 },
  { sides: 0.3, smoothness: 0.2, cards: 0.08 },
]
export const MAX_LEVELS = LEVELS.length
const GROWTH = 0.5 // how much a card grows for the cards gone: (all / kept) to this power, 0.5 covering the same area
const FEWEST_SIDES = 3 // round a branch, at any level

// A lower level's wood settings, and how its leaves are cut
const lighter = (params, level) => ({
  ...params,
  sides: Math.max(FEWEST_SIDES, Math.round(params.sides * level.sides)),
  smoothness: Math.max(1, Math.round(params.smoothness * level.smoothness)),
})
const cut = (level) => ({ share: level.cards, size: (1 / level.cards) ** GROWTH, segments: 1 })

// count levels, the first the tree as it is: each its wood's geometry and
// its leaves baked. grow grows the wood with other params
export function levelsOfDetail({ count, params, grow, wood, clumps, foliage }) {
  return LEVELS.slice(0, count).map((level, i) => {
    if (i === 0) return { wood, leaves: foliage.bake() }
    return { wood: grow(lighter(params, level)).geometry, leaves: foliage.bakeLevel(clumps, params, cut(level)) }
  })
}

// How many vertices each of count levels would hold, without baking them:
// the wood grown again, and the leaves scattered again and counted
export function levelVertices({ count, params, grow, wood, clumps, foliage }) {
  return LEVELS.slice(0, count).map((level, i) => {
    if (i === 0) return wood.attributes.position.count + foliage.bakedVertices()
    const woodCount = grow(lighter(params, level)).geometry.attributes.position.count
    return woodCount + foliage.levelVertices(clumps, params, cut(level))
  })
}

// The tree with no wind: what it's made of as balls, [x, y, z, radius], the
// wood's vertices and the cards' leaves; the box round them; and the sphere
// round them, its centre the box's, its radius as far as any reaches
export function bounds(wood, foliage) {
  const positions = wood.attributes.position
  const balls = foliage.reach()
  for (let i = 0; i < positions.count; i++) balls.push([positions.getX(i), positions.getY(i), positions.getZ(i), 0])
  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  for (const [x, y, z, r] of balls) {
    box.expandByPoint(point.set(x + r, y + r, z + r))
    box.expandByPoint(point.set(x - r, y - r, z - r))
  }
  const center = box.getCenter(new THREE.Vector3())
  let radius = 0
  for (const [x, y, z, r] of balls) radius = Math.max(radius, point.set(x, y, z).distanceTo(center) + r)
  return { balls, box, center, radius }
}
