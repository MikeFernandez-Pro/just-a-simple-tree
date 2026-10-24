import * as THREE from 'three/webgpu'
import { abs, cameraPosition, cross, float, floor, modelWorldMatrixInverse, normalize, select, step, texture, uniformArray, uv, varying, vec2, vec3, vec4 } from 'three/tsl'
import { Item } from 'three/addons/inspector/ui/Item.js'
import { createValueSpan } from 'three/addons/inspector/ui/utils.js'
import { IMPOSTOR, LEVELS } from './lod.js'
import { shadowColor, shadowDarkness, sunDirection } from './shading.js'

// The levels of detail, seen live while the app is being worked on, in a
// LOD preview section of the panel that only `pnpm dev` has, out of the
// address and the resets. It shows the tree at any level, with its wind and
// shading, or the impostor, or the level an engine would pick for the share
// of the screen the tree takes. Off the tree as it is, the camera is let out
// far enough to see the tree as small as the last level shows it. The share
// is always read out, to set each level's against.
// Until the impostor is drawn, the last level stands in for it.
// Each level's settings are sliders, editing LEVELS in place, and copy
// levels writes them out to paste back into lod.js

const FAR = 4000 // metres: how far the camera may back away while a level is previewed
const IMPOSTOR_AFTER = 600 // milliseconds after the tree last changed that the impostor is drawn again
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
// grows the tree at a level, tuned(level) says a level's settings changed;
// fullBounds gives the sphere round the tree as it is; setTreeVisible shows
// or hides it; captureImpostor(level) draws the impostor's quad from the
// tree grown at a level; changedAt gives when the tree last changed
export function createLodPreview({ inspector, camera, controls, scene, levelCount, impostorWanted, shadowWanted, showLevel, tuned, fullBounds, setTreeVisible, captureImpostor, changedAt }) {
  const section = inspector.createParameters('LOD preview')
  const state = { show: 'the tree' }
  const choices = ['the tree', ...LEVELS.map((_, i) => `LOD${i}`), 'impostor', BY_SHARE]
  section.add(state, 'show', choices).onChange(pick)
  const readout = (label) => {
    const value = createValueSpan()
    section.paramList.add(new Item(label, value))
    return value
  }
  const showingText = readout('showing')
  const shareText = readout('screen share')

  LEVELS.forEach((level, i) => {
    const folder = section.addFolder(`LOD${i}`)
    for (const key of i === 0 ? ['coverage'] : Object.keys(TUNING)) {
      const [min, max, step] = TUNING[key]
      folder.add(level, key, min, max, step).onChange(() => tuned(i))
    }
  })
  section.addFolder('impostor').add(IMPOSTOR, 'coverage', ...TUNING.coverage)
  section.add({ 'copy levels': copyLevels }, 'copy levels')

  let showing = 0 // a level, 'impostor', or 'nothing' below the last level's share
  let impostor = null
  let impostorAt = -Infinity // when the tree had last changed as the impostor was drawn
  let impostorFrom = -1 // the level it was drawn from, the export's last
  let impostorLit = '' // the sun and shadow it was drawn with
  let lit = '' // the sun and shadow now, and when they last changed
  let litAt = 0
  const lighting = () => [...sunDirection.value.toArray(), shadowColor.value.getHex(), shadowDarkness.value, shadowWanted()].join()
  let capturing = false
  let suspended = false
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
    if (state.show === BY_SHARE) return
    if (state.show === 'impostor') show('impostor')
    else show(previewing ? Number(state.show.slice(3)) : 0)
  }

  function show(what) {
    if (what === showing) return
    showing = what
    showLevel(typeof what === 'number' ? what : levelCount() - 1)
    apply()
  }

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

  // Once a frame, after the tree has been rebuilt
  function update() {
    const sphere = fullBounds()
    if (!sphere || suspended) return
    const distance = Math.max(camera.position.distanceTo(sphere.center), 1e-3)
    const share = sphere.radius / (distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    shareText.textContent = share.toFixed(3)
    if (state.show === BY_SHARE) show(levelFor(share))
    showingText.textContent = typeof showing === 'number' ? `LOD${showing}` : showing
    if (lighting() !== lit) [lit, litAt] = [lighting(), performance.now()]
    const stale = changedAt() > impostorAt || impostorFrom !== levelCount() - 1 || impostorLit !== lit
    const settled = performance.now() - Math.max(changedAt(), litAt) > IMPOSTOR_AFTER
    if (showing === 'impostor' && stale && settled && !capturing) drawImpostor()
  }

  // The impostor drawn afresh while it's seen, from the export's last
  // level, as the export draws it
  async function drawImpostor() {
    capturing = true
    impostorAt = changedAt()
    impostorFrom = levelCount() - 1
    impostorLit = lit
    suspend()
    try {
      const mesh = await captureImpostor(impostorFrom)
      faceCamera(mesh)
      if (impostor) {
        scene.remove(impostor)
        impostor.traverse((part) => {
          part.geometry.dispose()
          part.material.map?.dispose()
          part.material.dispose()
        })
      }
      impostor = mesh
      scene.add(impostor)
    } finally {
      capturing = false
      resume()
    }
  }

  // While an export draws and bakes the tree, the tree is seen and the
  // impostor isn't
  function suspend() {
    suspended = true
    setTreeVisible(true)
    if (impostor) impostor.visible = false
  }
  function resume() {
    suspended = false
    apply()
  }

  function copyLevels() {
    const literal = (object) => `{ ${Object.entries(object).map(([key, value]) => `${key}: ${+value.toFixed(3)}`).join(', ')} }`
    const text = `export const LEVELS = [\n${LEVELS.map((level) => `  ${literal(level)},`).join('\n')}\n]\nexport const IMPOSTOR = ${literal(IMPOSTOR)}\n`
    navigator.clipboard.writeText(text)
  }

  return { update, suspend, resume }
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
  mesh.material = material
  mesh.frustumCulled = false
}
