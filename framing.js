import * as THREE from 'three/webgpu'

// The camera backs away until the whole tree fits on screen, clear of the
// buttons round its edges, so a phone held upright, narrow as it is, sees
// the whole crown. It only ever backs away from where it starts, never
// comes closer, so a wide screen sees the tree as it always did. It eases
// out as the tree grows bigger and back in as it shrinks, and jumps
// straight there when the screen changes shape. Once you zoom yourself the
// distance is yours, until the screen changes shape again

const MARGIN = 12 // pixels kept clear between the tree and the buttons
const EASE = 4 // how quickly it eases to a new distance, per second

// clear gives the pixels the buttons take up along each edge of the
// screen, { top, bottom, left, right }
export function createFraming({ camera, controls, clear }) {
  const start = camera.position.distanceTo(controls.target)
  let box = null
  let goal = start
  let placed = start // the distance it last put the camera at
  let following = true
  let stale = true
  let jump = true
  let last = performance.now()

  const toCamera = new THREE.Vector3()
  const side = new THREE.Vector3()
  const up = new THREE.Vector3()
  const corner = new THREE.Vector3()

  // How far back the camera must be, looking the way it does now, for every
  // corner of the box to be on screen inside the clear edges. The target
  // stays in the middle of the screen, so each side of it has its own room
  function fitting() {
    toCamera.subVectors(camera.position, controls.target).normalize()
    side.set(0, 1, 0).cross(toCamera).normalize()
    up.crossVectors(toCamera, side)
    const edges = clear()
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const tanX = tanY * camera.aspect
    // How much of the half-screen on one side of the middle is free
    const room = (edge, size) => Math.max(1 - (2 * (edge + MARGIN)) / size, 0.2)
    let distance = start
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(controls.target)
      const x = corner.dot(side)
      const y = corner.dot(up)
      const z = corner.dot(toCamera)
      const across = tanX * room(x > 0 ? edges.right : edges.left, innerWidth)
      const high = tanY * room(y > 0 ? edges.top : edges.bottom, innerHeight)
      distance = Math.max(distance, z + Math.abs(x) / across, z + Math.abs(y) / high)
    }
    return Math.min(distance, controls.maxDistance)
  }

  // A new tree, or the same one changed: the box round it
  function fit(newBox) {
    box = newBox
    stale = true
  }

  // The screen changed shape: frame the tree afresh, at once
  function resize() {
    following = stale = jump = true
    placed = camera.position.distanceTo(controls.target)
  }

  // Once a frame, after the controls have moved the camera
  function update(now) {
    const seconds = Math.min((now - last) / 1000, 0.1)
    last = now
    const distance = camera.position.distanceTo(controls.target)
    // Orbiting and panning keep the distance, so only a zoom changes it
    if (Math.abs(distance - placed) > 1e-3) following = false
    if (!following || !box) return
    if (stale) goal = fitting()
    stale = false
    placed = jump ? goal : THREE.MathUtils.damp(distance, goal, EASE, seconds)
    jump = false
    camera.position.sub(controls.target).setLength(placed).add(controls.target)
  }

  return { fit, resize, update }
}
