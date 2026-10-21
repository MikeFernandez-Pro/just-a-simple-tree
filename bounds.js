import * as THREE from 'three/webgpu'

// Every vertex of the tree as it exports, the wood's and the baked cards',
// flat as x, y, z: what an impostor's views are cropped to. Tighter than
// bounds' balls, which round each card's leaves out to its full width
export function vertices(wood, foliage) {
  const bark = wood.attributes.position.array
  const leaves = foliage.bake().geometry.attributes.position.array
  const all = new Float32Array(bark.length + leaves.length)
  all.set(bark)
  all.set(leaves, bark.length)
  return all
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
