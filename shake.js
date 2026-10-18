import * as THREE from 'three/webgpu'
import { wind } from './wind.js'
import { arrival } from './transition.js'

// A theme landing hits the tree: the moment the sweep's front reaches the
// crown on screen, everything goes off at once. The tree squashes, the camera
// is knocked along the sweep and shakes, a gust blows through the tree and a
// handful of leaves are knocked off it. Picks made while a front is still on
// its way each land their own hit.
//
// The squash: the hit sets a spring going, pushing the tree down, shorter and
// wider, its volume kept, then back up past its height, taller and thinner,
// and it bounces a couple of times as it settles. A hit while it's still
// bouncing adds to the bounce. The shake: the camera jumps the way the
// front travels, springs back, and jitters round where it is, dying away.
// It's added for the frame drawn and taken off after, so the controls never
// see it. The gust: once the knocked leaves have dropped a little, the wind
// blows harder for a moment, rising quickly and dying away slowly, taking
// the leaves sideways, and the tree swings out and settles after the shake

const SQUASH = 0.07 // how much shorter a hit makes the tree at its lowest: 0.07 is 7%, and about 3.5% wider
const MOST = 0.2 // the most the tree is ever squashed, however many hits pile up
const BOUNCE = 3 // bounces a second
const DAMPING = 0.4 // of the spring: 0 bounces for ever, 1 settles with no bounce; 0.4 overshoots by a quarter
const KICK = 0.25 // metres the camera jumps along the sweep on a hit
const KICK_BOUNCE = 6 // its springs back a second
const SHAKE = 0.06 // metres of jitter at its strongest
const ROLL = 0.004 // radians of roll at its strongest
const SHAKE_SECONDS = 0.6 // how long the camera takes to settle
const GUST = 2 // how much harder it blows at its strongest: 2 is three times
const GUST_SECONDS = 2.5 // how long the gust takes to rise and die away
const GUST_DELAY = 0.6 // seconds after a hit before it blows, while the knocked leaves drop

export function createShake({ camera, falling, tree, crownCenter }) {
  let from = -Infinity // when the last hit landed
  const hits = [] // when the fronts still on their way reach the crown
  const crown = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const axis = new THREE.Vector3(0, 0, 1)
  const saved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }

  // The spring: how squashed the tree is (below 0 shorter, above 0 taller)
  // and how fast that's changing
  let squash = 0
  let speed = 0
  let last = performance.now()
  // The push a hit gives the spring, so its lowest is SQUASH down: a damped
  // spring pushed at speed v goes v / omega down, less what it loses on the way
  const omega = BOUNCE * Math.PI * 2
  const lost = Math.exp((-DAMPING / Math.sqrt(1 - DAMPING ** 2)) * Math.acos(DAMPING))
  const push = (SQUASH * omega) / lost

  // A sweep lasting seconds has started: its hit lands when its front reaches
  // the crown
  function start(seconds) {
    crown.copy(crownCenter.value).project(camera)
    hits.push(performance.now() + arrival(crown.x, crown.y, camera.aspect) * seconds * 1000)
  }

  function hit(now) {
    from = now
    speed -= push
    falling.shake()
  }

  // Lands any hit due by the time now, in milliseconds, and moves the spring
  // and the gust on to it
  function update(now) {
    while (hits.length && hits[0] <= now) hit(hits.shift())

    // A step of a frame at most a thirtieth of a second, in small steps, so a
    // hidden tab doesn't come back to a spring flung off
    let left = Math.min((now - last) / 1000, 1 / 30)
    last = now
    while (left > 0) {
      const dt = Math.min(left, 1 / 240)
      speed += (-omega * omega * squash - 2 * DAMPING * omega * speed) * dt
      squash = Math.max(squash + speed * dt, -MOST)
      left -= dt
    }
    if (Math.abs(squash) < 1e-4 && Math.abs(speed) < 1e-3) squash = speed = 0
    // Shorter or taller from its foot, as much wider or thinner, so it keeps
    // its volume
    const height = 1 + squash
    for (const object of tree) object.scale.set(1 / Math.sqrt(height), height, 1 / Math.sqrt(height))

    const t = ((now - from) / 1000 - GUST_DELAY) / GUST_SECONDS
    wind.gust.value = t >= 0 && t < 1 ? GUST * THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - t) ** 2 : 0
  }

  // Draw a frame from the camera as shaken at the time now, then put it back
  function draw(now, render) {
    const seconds = (now - from) / 1000
    const t = seconds / SHAKE_SECONDS
    if (!(t >= 0 && t < 1)) return render()
    const strength = (1 - t) ** 2
    // The kick: the picture jumps the way the front travels, up and to the
    // right, so the camera goes down and to the left, and springs back
    const kick = -KICK * Math.cos(seconds * KICK_BOUNCE * Math.PI * 2) * strength * Math.SQRT1_2
    // The jitter: a few sines at odd rates, so it never quite repeats
    const s = now / 1000
    const x = kick + (Math.sin(s * 47) + 0.5 * Math.sin(s * 83 + 1.3)) * SHAKE * strength
    const y = kick + (Math.sin(s * 53 + 2.1) + 0.5 * Math.sin(s * 71 + 0.4)) * SHAKE * strength
    const r = Math.sin(s * 39 + 0.7) * ROLL * strength
    saved.position.copy(camera.position)
    saved.quaternion.copy(camera.quaternion)
    camera.updateMatrixWorld()
    camera.position.add(offset.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(x))
    camera.position.add(offset.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(y))
    camera.rotateOnAxis(axis, r)
    camera.updateMatrixWorld()
    render()
    camera.position.copy(saved.position)
    camera.quaternion.copy(saved.quaternion)
    camera.updateMatrixWorld()
  }

  return { start, update, draw }
}
