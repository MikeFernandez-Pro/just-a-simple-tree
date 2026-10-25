import * as THREE from 'three/webgpu'
import { abs, cameraPosition, cross, float, floor, modelWorldMatrixInverse, normalize, select, step, texture, uniformArray, uv, varying, vec2, vec3, vec4 } from 'three/tsl'
import { Item } from 'three/addons/inspector/ui/Item.js'
import { createValueSpan } from 'three/addons/inspector/ui/utils.js'
import { IMPOSTOR, LEVELS, WOOD_SETTINGS } from './lod.js'
import { shadowColor, shadowDarkness, sunDirection } from './shading.js'

// The levels of detail, seen live in a LOD preview section of the panel.
// It shows the tree at any level, with its wind and
// shading, or the impostor, or the level an engine would pick for the share
// of the screen the tree takes. Off the tree as it is, the camera is let out
// far enough to see the tree as small as the last level shows it. The share
// is always read out, to set each level's against.
// Until the impostor is drawn, the last level stands in for it.
// Each level's settings are sliders, editing LEVELS in place, so the
// tree + LODs export, which reads them as it runs, comes out as they're
// set. Their coverages always fall from LOD0 to the impostor, as an engine
// switching between them needs. They're in the address and the resets like
// any other section, but what's shown isn't. Going back to the tree lets
// the impostor's atlas go. With `pnpm dev`, copy levels writes them out to
// paste back into lod.js

const FAR = 4000 // metres: how far the camera may back away while a level is previewed
const IMPOSTOR_AFTER = 600 // milliseconds after the tree last changed that the impostor is drawn again
const RETRY_AFTER = 5000 // milliseconds after the impostor failed to draw that it's tried again
// Each setting's slider: its least, its most and its step
const TUNING = {
  coverage: [0.001, 1, 0.001], // the share of the screen's height it shows down to
  sides: [0.1, 1, 0.05], // its sides round a branch / the tree's
  rings: [1, 4, 1], // a ring at every this many kinks
  cut: [0, 0.6, 0.01], // the thinnest branch it keeps / the trunk
  caps: [1, 3, 1], // rings closing each tip
  cards: [0.02, 1, 0.01], // its cards / the tree's
  grow: [0, 1, 0.05], // how much its cards grow for those left out, 0.5 covering the same area
  segments: [1, 4, 1], // squares a side each card is cut into
  merges: [0, 4, 1], // how many times over neighbouring clumps are merged in pairs
  fill: [0, 1, 0.05], // how big a merged clump grows, from keeping its pair's volume to wrapping round them
}
const BY_SHARE = 'by screen share'

// levelCount and impostorWanted give the export's levels, and shadowWanted
// whether its impostor has a shadow; showLevel(level)
// grows the tree at a level, tuned(level) says a level's settings changed,
// other than its coverage, which changes nothing grown;
// fullBounds gives the sphere round the tree as it is; setTreeVisible shows
// or hides it; captureImpostor(level) draws the impostor's quad from the
// tree grown at a level; changedAt gives when the tree last changed;
// debugView keeps a control out of the address, and woodSetting marks one
// hidden for a species that grows no wood. It gives back oneAtATime, for
// the exports to wait their turn with its impostor
export function createLodPreview({ inspector, camera, controls, scene, levelCount, impostorWanted, shadowWanted, showLevel, tuned, fullBounds, setTreeVisible, captureImpostor, changedAt, debugView, woodSetting }) {
  const section = inspector.createParameters('LOD preview')
  const state = { show: 'the tree' }
  const choices = ['the tree', ...LEVELS.map((_, i) => `LOD${i}`), 'impostor', BY_SHARE]
  debugView(section.add(state, 'show', choices)).onChange(pick)
  const readout = (label) => {
    const value = createValueSpan()
    section.paramList.add(new Item(label, value))
    return value
  }
  const showingText = readout('showing')
  const shareText = readout('screen share')

  const coverageControls = []
  LEVELS.forEach((level, i) => {
    const folder = section.addFolder(`LOD${i}`)
    for (const key of i === 0 ? ['coverage'] : Object.keys(TUNING)) {
      const [min, max, step] = TUNING[key]
      const control = folder.add(level, key, min, max, step)
      if (key === 'coverage') coverageControls.push(control.onChange(() => keepInOrder(i)))
      else control.onChange(() => tuned(i))
      if (WOOD_SETTINGS.includes(key)) woodSetting(control)
    }
  })
  coverageControls.push(section.addFolder('impostor').add(IMPOSTOR, 'coverage', ...TUNING.coverage).onChange(() => keepInOrder(LEVELS.length)))
  if (import.meta.env.DEV) section.add({ 'copy levels': copyLevels }, 'copy levels')

  // A coverage set past a neighbour's pushes it on, a notch at a time,
  // and one pushed against an end of its slider stops short of it, leaving
  // room for those beyond
  function keepInOrder(i) {
    const [least, most, notch] = TUNING.coverage
    const levels = [...LEVELS, IMPOSTOR]
    const setCoverage = (j, coverage) => {
      const rounded = +coverage.toFixed(3)
      if (rounded !== levels[j].coverage) coverageControls[j].setValue(rounded)
    }
    setCoverage(i, THREE.MathUtils.clamp(levels[i].coverage, least + (levels.length - 1 - i) * notch, most - i * notch))
    for (let j = i - 1; j >= 0; j--) setCoverage(j, Math.max(levels[j].coverage, levels[j + 1].coverage + notch))
    for (let j = i + 1; j < levels.length; j++) setCoverage(j, Math.min(levels[j].coverage, levels[j - 1].coverage - notch))
  }

  let showing = 0 // a level, 'impostor', or 'nothing' below the last level's share
  let impostor = null
  // What the impostor is drawn from, as one key: when the tree last
  // changed, the level and the lights. The key it was drawn from, and the
  // key now, kept up while the preview is open, and since when
  let drawnSource = ''
  let source = ''
  let sourceSince = 0
  let failedAt = -Infinity // when the impostor last failed to draw
  const lighting = () => [...sunDirection.value.toArray(), shadowColor.value.getHex(), shadowDarkness.value, shadowWanted()].join()
  let capturing = false
  let suspended = false // while an export or the impostor draws the tree
  let far = null // the camera's own far plane and farthest zoom, while they're let out

  function pick() {
    const previewing = state.show !== 'the tree'
    if (previewing && !far) {
      far = { far: camera.far, maxDistance: controls.maxDistance }
      camera.far = FAR
      controls.maxDistance = FAR - 20
      camera.updateProjectionMatrix()
    } else if (!previewing && far) {
      camera.far = far.far
      controls.maxDistance = far.maxDistance
      camera.updateProjectionMatrix()
      far = null
    }
    if (!previewing) dropImpostor()
    if (state.show === BY_SHARE) return
    if (state.show === 'impostor') show('impostor')
    else show(previewing ? Number(state.show.slice(3)) : 0)
  }

  // While an export or the impostor has the tree, a level picked waits for
  // it to finish, so the tree isn't regrown under it
  function show(what) {
    if (what === showing) return
    showing = what
    if (suspended) return
    showLevel(levelShown())
    apply()
  }
  const levelShown = () => (typeof showing === 'number' ? showing : levelCount() - 1)

  // Whichever of the tree and the impostor is to be seen, the tree standing
  // in for the impostor until it's drawn
  function apply() {
    if (suspended) return
    const tree = typeof showing === 'number' || (showing === 'impostor' && !impostor)
    setTreeVisible(tree)
    if (impostor) impostor.visible = showing === 'impostor'
  }

  // The level an engine would show for the share of the screen's height
  // the sphere round the tree takes: the first it's still above, then the
  // impostor, then nothing
  function levelFor(share) {
    const count = levelCount()
    for (let level = 0; level < count; level++) if (share >= LEVELS[level].coverage) return level
    if (impostorWanted() && share >= IMPOSTOR.coverage) return 'impostor'
    return 'nothing'
  }

  // Once a frame, after the tree has been rebuilt. The read-outs are only
  // written when they change, and what the impostor is drawn from only
  // looked at while the preview is open. Opened afresh, it's drawn at once
  function update() {
    const sphere = fullBounds()
    if (!sphere || suspended) return
    const distance = Math.max(camera.position.distanceTo(sphere.center), 1e-3)
    const share = sphere.radius / (distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    write(shareText, share.toFixed(3))
    if (state.show === BY_SHARE) show(levelFor(share))
    write(showingText, typeof showing === 'number' ? `LOD${showing}` : showing)
    if (state.show === 'the tree') return
    const now = performance.now()
    const sourceNow = [changedAt(), levelCount() - 1, lighting()].join()
    if (sourceNow !== source) [source, sourceSince] = [sourceNow, source ? now : 0]
    const stale = !impostor || source !== drawnSource
    const settled = now - sourceSince > IMPOSTOR_AFTER && now - failedAt > RETRY_AFTER
    if (showing === 'impostor' && stale && settled && !capturing) drawImpostor()
  }
  function write(span, text) {
    if (span.textContent !== text) span.textContent = text
  }

  // The impostor drawn afresh while it's seen, from the export's last
  // level, as the export draws it. One that fails is tried again a while
  // later, and one no longer wanted by the time it's drawn goes at once. It
  // comes in hidden, in case an export has the tree out by then
  async function drawImpostor() {
    capturing = true
    const drawing = source
    let mesh = null
    try {
      mesh = await oneAtATime(() => captureImpostor(levelCount() - 1))
      faceCamera(mesh)
      if (impostor) discard(impostor)
      impostor = mesh
      impostor.visible = false
      scene.add(impostor)
      drawnSource = drawing
    } catch (error) {
      console.error(error)
      failedAt = performance.now()
      if (mesh && mesh !== impostor) discard(mesh)
    } finally {
      capturing = false
      if (state.show === 'the tree') dropImpostor()
      apply()
    }
  }

  // The impostor and its atlas let go, to be drawn afresh when it's wanted
  // again. One still being drawn goes once it's done
  function dropImpostor() {
    if (impostor && !capturing) {
      discard(impostor)
      impostor = null
    }
    source = ''
  }
  function discard(mesh) {
    scene.remove(mesh)
    mesh.userData.atlas?.dispose()
    mesh.traverse((part) => {
      part.geometry.dispose()
      part.material.map?.dispose()
      part.material.dispose()
    })
  }

  // The exports and the impostor each grow the tree at a level and take the
  // canvas over to draw it, so they wait for each other, one at a time, the
  // tree seen meanwhile and the impostor not. Then the level picked
  // meanwhile goes on. The queue keeps nothing of what each gives back
  let lastTurn = Promise.resolve()
  function oneAtATime(task) {
    const turn = lastTurn.then(async () => {
      suspended = true
      setTreeVisible(true)
      if (impostor) impostor.visible = false
      try {
        return await task()
      } finally {
        suspended = false
        showLevel(levelShown())
        apply()
      }
    })
    lastTurn = turn.then(() => {}, () => {})
    return turn
  }

  function copyLevels() {
    const literal = (object) => `{ ${Object.entries(object).map(([key, value]) => `${key}: ${+value.toFixed(3)}`).join(', ')} }`
    const text = `export const LEVELS = [\n${LEVELS.map((level) => `  ${literal(level)},`).join('\n')}\n]\nexport const IMPOSTOR = ${literal(IMPOSTOR)}\n`
    navigator.clipboard.writeText(text)
  }

  return { section, update, oneAtATime }
}

// The README's impostor for WebGPURenderer: its quad turns to the view in
// its atlas nearest the camera's direction, and shows it. Kept the same,
// so the preview shows what the snippet does
function faceCamera(mesh) {
  const { frames, radius, center, crops } = mesh.userData.impostor
  const old = mesh.material
  const n = float(frames)
  const c = vec3(...center)
  const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.sub(c)
  const above = vec3(eye.x, eye.y.max(0), eye.z)
  const p = above.xz.div(abs(above.x).add(abs(above.y)).add(abs(above.z)))
  const frame = floor(vec2(p.x.add(p.y), p.x.sub(p.y)).mul(0.5).add(0.5).mul(n.sub(1)).add(0.5)).clamp(0, n.sub(1))
  const o = frame.div(n.sub(1)).mul(2).sub(1)
  const q = vec2(o.x.add(o.y), o.x.sub(o.y)).mul(0.5)
  const look = normalize(vec3(q.x, float(1).sub(abs(q.x)).sub(abs(q.y)), q.y))
  const right = select(abs(look.y).greaterThan(0.999), vec3(1, 0, 0), normalize(cross(vec3(0, 1, 0), look)))
  const up = cross(look, right)
  const corner = vec2(uv().x.mul(n).sub(n.sub(1)), uv().y.mul(n)).mul(2).sub(1)
  const crop = uniformArray(crops.map((crop) => new THREE.Vector4(...crop))).element(frame.y.mul(n).add(frame.x).toInt())
  const inFrame = varying(corner.mul(radius).sub(crop.xy).div(crop.zw.sub(crop.xy)))
  const view = texture(old.map, varying(frame.add(inFrame).div(n)))
  const material = new THREE.MeshBasicNodeMaterial({ alphaTest: old.alphaTest, side: old.side })
  material.positionNode = c.add(right.mul(corner.x).add(up.mul(corner.y)).mul(radius))
  material.colorNode = view
  const inside = step(0, inFrame.x).mul(step(inFrame.x, 1)).mul(step(0, inFrame.y)).mul(step(inFrame.y, 1))
  material.opacityNode = view.a.mul(inside)
  // The node material reads the atlas through its texture node, not its
  // map, so the atlas is kept on the mesh to be let go with it
  mesh.material = material
  mesh.userData.atlas = old.map
  old.dispose()
  mesh.frustumCulled = false
}
