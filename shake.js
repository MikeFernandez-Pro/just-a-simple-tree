import * as THREE from 'three/webgpu'
import { wind } from './wind.js'

// A theme landing: the camera shakes a little over its sweep, a gust blows
// through the tree, and a handful of leaves are knocked off it.
//
// The shake: the camera jitters round where it is, a few centimetres and a
// fraction of a degree, sharply at first and dying away over the sweep. It's
// added for the frame drawn and taken off after, so the controls never see
// it. The gust: the wind blows harder for a moment, rising quickly and dying
// away slowly, so the tree swings out and settles after the shake

const SHAKE = 0.02 // metres at its strongest
const ROLL = 0.0015 // radians of roll at its strongest
const GUST = 2 // how much harder it blows at its strongest: 2 is three times
const GUST_SECONDS = 2.5

export function createShake({ camera, falling }) {
  let from = -Infinity
  let seconds = 1
  const offset = new THREE.Vector3()
  const axis = new THREE.Vector3(0, 0, 1)
  const saved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }

  // A shake lasting seconds, and its gust, from now
  function start(duration) {
    from = performance.now()
    seconds = duration
    falling.shake()
  }

  // The gust's share of the wind at the time now, in milliseconds
  function blow(now) {
    const t = (now - from) / 1000 / GUST_SECONDS
    wind.gust.value = t >= 0 && t < 1 ? GUST * THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - t) ** 2 : 0
  }

  // Draw a frame from the camera as shaken at the time now, then put it back
  function draw(now, render) {
    const t = (now - from) / 1000 / seconds
    if (!(t >= 0 && t < 1)) return render()
    const strength = Math.min(t / 0.06, 1) * (1 - t) ** 2
    const s = now / 1000
    // A few sines at odd rates, so it never quite repeats
    const x = Math.sin(s * 47) + 0.5 * Math.sin(s * 83 + 1.3)
    const y = Math.sin(s * 53 + 2.1) + 0.5 * Math.sin(s * 71 + 0.4)
    const r = Math.sin(s * 39 + 0.7)
    saved.position.copy(camera.position)
    saved.quaternion.copy(camera.quaternion)
    camera.updateMatrixWorld()
    camera.position.add(offset.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(x * SHAKE * strength))
    camera.position.add(offset.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(y * SHAKE * strength))
    camera.rotateOnAxis(axis, r * ROLL * strength)
    camera.updateMatrixWorld()
    render()
    camera.position.copy(saved.position)
    camera.quaternion.copy(saved.quaternion)
    camera.updateMatrixWorld()
  }

  return { start, blow, draw }
}
