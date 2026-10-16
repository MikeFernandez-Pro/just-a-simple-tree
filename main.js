import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Inspector } from 'three/addons/inspector/Inspector.js'
import { addParameterFilter } from './inspector-filter.js'
import { addCopyConfig, addReset, closeAll, trackFolders } from './inspector-tools.js'
import { generateOak } from './oak.js'
import { createFoliage, fallingTexture, LEAF_TEXTURES } from './foliage.js'
import { createFallingLeaves } from './falling-leaves.js'
import {
  barkColors,
  barkMaterial,
  exposure,
  toneMappingType,
  TONE_MAPPINGS,
  groundMaterial,
  hemisphere,
  shadowColor,
  shadowDarkness,
  sun,
  sunDirection,
} from './shading.js'
import { sway, wind } from './wind.js'
import { instancedBufferAttribute, positionGeometry } from 'three/tsl'

const renderer = new THREE.WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#fef1fa')

// A long lens flattens the tree, like a painting
const camera = new THREE.PerspectiveCamera(20, innerWidth / innerHeight, 1, 200)
camera.position.set(0, 5, 30)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 3.5, 0)
controls.enableDamping = true

// The sun, and a sky-and-ground fill for what it doesn't reach
scene.add(sun)
scene.add(hemisphere)

// A floor that only shows the tree's shadow, so it melts into the background
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMaterial())
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const params = {
  seed: 25,
  size: 5.27,
  trunkThickness: 0.21,
  splitHeight: 0.34,
  mainLimbs: 3,
  levels: 1,
  branches: 4,
  spread: 0.9,
  crookedness: 0.5,
  leafiness: 0.67,
  sides: 10,
  smoothness: 3,
  cardsPerClump: 29,
  emitterSize: 1, // scales every leaf clump, and its cards with it
  aoDistance: 2.5, // the tutorial's AO node distance
  leavesTexture: 'round cluster',
  emitters: false,
  wireframe: false,
  leaves: true,
  brush: true,
  normals: 'transferred',
  showNormals: false,
  sunAngle: -0.931592653589793,
  sunHeight: 0.63,
}

const tree = new THREE.Mesh(new THREE.BufferGeometry(), barkMaterial())
tree.castShadow = true
tree.receiveShadow = true
scene.add(tree)

// The wood's wireframe, swaying with it, to see its vertices
const wireframe = new THREE.Mesh(tree.geometry, new THREE.MeshBasicNodeMaterial({ color: '#1e1e1e', wireframe: true }))
wireframe.material.positionNode = positionGeometry.add(sway(positionGeometry))
wireframe.visible = false
scene.add(wireframe)

const foliage = createFoliage()
scene.add(foliage.mesh)

// Leaves falling from the crown, in the foliage's colours
const falling = createFallingLeaves({
  colors: foliage.uniforms.colors,
  crownCenter: foliage.uniforms.crownCenter,
  crownSize: foliage.uniforms.crownSize,
})
foliage.setBrush(params.leavesTexture)
falling.setTexture(fallingTexture(params.leavesTexture))
scene.add(falling.mesh)

const vertexCount = document.createElement('div')
vertexCount.style.cssText = 'position:fixed;top:12px;left:14px;font:12px/1.4 monospace;color:#555;pointer-events:none'
document.body.appendChild(vertexCount)

// The leaf clumps the cards are scattered over; hidden, but handy to see.
// Each is a sphere at its branch tip, swaying with the wood
const MAX_CLUMPS = 8192
const clumpData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CLUMPS * 4), 4) // centre, radius
clumpData.setUsage(THREE.DynamicDrawUsage)
const clumpNode = instancedBufferAttribute(clumpData)
const clumpMaterial = new THREE.MeshLambertNodeMaterial({ color: '#4f7a3a' })
clumpMaterial.positionNode = clumpNode.xyz.add(sway(clumpNode.xyz)).add(positionGeometry.mul(clumpNode.w))
const emitters = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), clumpMaterial)
emitters.frustumCulled = false
emitters.visible = false
emitters.count = 0
scene.add(emitters)

function rebuild() {
  const oak = generateOak(params)
  tree.geometry.dispose()
  tree.geometry = oak.geometry
  wireframe.geometry = oak.geometry
  oak.geometry.computeBoundingBox()
  wind.height.value = oak.geometry.boundingBox.max.y

  foliage.update(oak.clumps, params)
  foliage.mesh.visible &&= params.leaves

  emitters.count = Math.min(oak.clumps.length, MAX_CLUMPS)
  for (let i = 0; i < emitters.count; i++) {
    const { position, radius } = oak.clumps[i]
    clumpData.array.set([position.x, position.y, position.z, radius], i * 4)
  }
  clumpData.needsUpdate = true

  countVertices()
}

// Vertices drawn: the wood, and every leaf card's
function countVertices() {
  const wood = tree.geometry.attributes.position.count
  const cards = foliage.mesh.count
  const perCard = foliage.mesh.geometry.attributes.position.count
  const f = (n) => n.toLocaleString('en')
  const fallen = falling.mesh.count * 4
  vertexCount.textContent =
    `${f(wood + cards * perCard + fallen)} vertices · wood ${f(wood)} · leaves ${f(cards)} cards × ${perCard} each` +
    ` · ${f(emitters.count)} clumps · falling ${f(falling.mesh.count)}`
}

function placeSun() {
  const h = params.sunHeight
  const a = params.sunAngle
  sunDirection.value.set(Math.cos(h) * Math.sin(a), Math.sin(h), Math.cos(h) * Math.cos(a))
  sun.position.copy(sunDirection.value).multiplyScalar(30)
}

placeSun()
rebuild()

// Controls live in three's WebGPU Inspector, in its Parameters tab
renderer.inspector = new Inspector()

const treeSection = renderer.inspector.createParameters('Tree')
trackFolders(treeSection)
const shape = treeSection.addFolder('shape')
shape.add(params, 'seed', 1, 50, 1).onChange(rebuild)
shape.add(params, 'size', 2, 8).onChange(rebuild)
shape.add(params, 'mainLimbs', 3, 6, 1).name('main limbs').onChange(rebuild)
shape.add(params, 'levels', 0, 4, 1).onChange(rebuild)
shape.add(params, 'branches', 2, 5, 1).onChange(rebuild)
shape.add(params, 'spread', 0.3, 1.3).onChange(rebuild)
shape.add(params, 'crookedness', 0, 1.5).onChange(rebuild)
const trunk = treeSection.addFolder('trunk')
trunk.add(params, 'trunkThickness', 0.1, 0.6).name('thickness').onChange(rebuild)
trunk.add(params, 'splitHeight', 0.15, 0.6).name('split height').onChange(rebuild)
// The wood's mesh: sides round each branch, and rings per kink along a
// curve through them. Its normals are smooth; more sides smooth the edges
// of the cel bands too
const woodMesh = treeSection.addFolder('mesh')
woodMesh.add(params, 'sides', 3, 24, 1).onChange(rebuild)
woodMesh.add(params, 'smoothness', 1, 8, 1).onChange(rebuild)

const leafSection = renderer.inspector.createParameters('Leaves')
// The clumps the cards are scattered over, one on each free branch tip:
// leafiness and emitter size grow them, and bigger clumps get more cards
const clumps = leafSection.addFolder('clumps')
clumps.add(params, 'leafiness', 0, 1).onChange(rebuild)
clumps.add(params, 'emitterSize', 0.3, 3).name('emitter size').onChange(rebuild)
clumps.add(params, 'cardsPerClump', 1, 160, 1).name('cards per clump').onChange(rebuild)
const cards = leafSection.addFolder('cards')
cards
  .add(params, 'leavesTexture', LEAF_TEXTURES)
  .name('texture')
  .onChange((name) => {
    foliage.setBrush(name)
    falling.setTexture(fallingTexture(name))
  })
cards.add(foliage.uniforms.particleSize, 'value', 0.1, 3).name('size')
// How many squares each card is cut into, and how far they wrap round their
// clump's sphere. Segments only show once roundness bends them
const SEGMENTS = { '1 × 1': 1, '2 × 2': 2, '3 × 3': 3, '4 × 4': 4 }
cards.add({ segments: '2 × 2' }, 'segments', Object.keys(SEGMENTS)).onChange((name) => {
  foliage.setSegments(SEGMENTS[name])
  countVertices()
})
cards.add(foliage.uniforms.roundness, 'value', 0, 1).name('roundness')
const leafShading = leafSection.addFolder('shading')
leafShading.add(foliage.uniforms.shadowSide, 'value', 0, 1, 0.005).name('shadow side')
leafShading.add(foliage.uniforms.ao, 'value', 0, 1).name('ao')
leafShading.add(params, 'aoDistance', 0.25, 6).name('ao distance').onChange(rebuild)

const breeze = renderer.inspector.createParameters('Wind')
breeze.add(wind.direction, 'value', -Math.PI, Math.PI).name('direction')
breeze.add(wind.strength, 'value', 0, 1).name('strength')
breeze.add(wind.speed, 'value', 0, 3).name('speed')
breeze.add(wind.frequency, 'value', 0.05, 1).name('gust size')
breeze.add(wind.flutter, 'value', 0, 1).name('leaf flutter')

const fall = renderer.inspector.createParameters('Falling leaves')
fall
  .add(falling.mesh, 'count', 0, falling.MAX_LEAVES, 1)
  .name('amount')
  .onChange(countVertices)
fall.add(falling.uniforms.size, 'value', 0.05, 0.8).name('leaf size')
fall.add(falling.uniforms.fallSpeed, 'value', 0.1, 3).name('fall speed')
fall.add(falling.uniforms.lifetime, 'value', 3, 40).name('lifetime')

// Colour themes: four leaf bands from core to light, three trunk bands. Summer
// is the tutorial's; the others keep full-coloured leaves on muted wood, each
// with its own
const THEMES = {
  summer: { leaves: ['#306e5a', '#357d44', '#539e43', '#9fcb68'], trunk: ['#312e2b', '#4d463a', '#6b604a'] },
  spring: { leaves: ['#3f7f63', '#5fae4e', '#8fd16a', '#d7f08c'], trunk: ['#4a423c', '#6e6258', '#948676'] },
  autumn: { leaves: ['#6b2f2a', '#a8432b', '#e0782f', '#f6c35a'], trunk: ['#3d3430', '#5a4c44', '#7a6a5e'] },
  blossom: { leaves: ['#a0577a', '#d47f9e', '#f2abc2', '#ffe0ea'], trunk: ['#a9a4a6', '#d3cfd0', '#f4f2f2'] },
  frost: { leaves: ['#4f6f86', '#7f9fb5', '#b9d3e2', '#f2f8fb'], trunk: ['#45474b', '#66686c', '#8b8d90'] },
  night: { leaves: ['#14273a', '#1e3d4f', '#2e5a62', '#5f8f86'], trunk: ['#1d1f24', '#2c2f36', '#40444c'] },
}

// A ramp's colours, one picker each on the uniforms' own colours (the
// Inspector reads and writes them as sRGB hex). Returns the pickers, so a
// theme can set them
function addRamp(folder, uniforms, names) {
  return uniforms.map((uniform, i) => folder.addColor(uniform, 'value').name(names[i]))
}
// The tree starts in blossom
const START_THEME = 'blossom'
THEMES[START_THEME].leaves.forEach((hex, i) => foliage.uniforms.colors[i].value.set(hex))
THEMES[START_THEME].trunk.forEach((hex, i) => barkColors[i].value.set(hex))
const colours = renderer.inspector.createParameters('Colours')
colours.add({ theme: START_THEME }, 'theme', Object.keys(THEMES)).onChange((name) => {
  THEMES[name].leaves.forEach((hex, i) => leafPickers[i].setValue(hex))
  THEMES[name].trunk.forEach((hex, i) => trunkPickers[i].setValue(hex))
})
// The background, as picked: tone mapping runs in the tree's materials, not
// over the frame. The floor only draws shadow, so it follows on its own
colours.addColor(scene, 'background').name('background')
const leafPickers = addRamp(colours.addFolder('leaves'), foliage.uniforms.colors, ['core', 'shadow', 'mid', 'light'])
const trunkPickers = addRamp(colours.addFolder('trunk'), barkColors, ['shadow', 'mid', 'light'])

// The lights' colours reach the tree and leaves: their cel band follows the
// light's brightness, their tint its colour
const light = renderer.inspector.createParameters('Lights')
const sunFolder = light.addFolder('sun')
sunFolder.add(params, 'sunAngle', -Math.PI, Math.PI).name('angle').onChange(placeSun)
sunFolder.add(params, 'sunHeight', 0.1, 1.5).name('height').onChange(placeSun)
sunFolder.add(sun, 'intensity', 0, 15).name('intensity')
sunFolder.addColor(sun, 'color').name('colour')
const skyFolder = light.addFolder('hemisphere')
skyFolder.add(hemisphere, 'intensity', 0, 5).name('intensity')
skyFolder.addColor(hemisphere, 'color').name('sky colour')
skyFolder.addColor(hemisphere, 'groundColor').name('ground colour')
const shadowFolder = light.addFolder('shadows')
shadowFolder.addColor(shadowColor, 'value').name('colour')
shadowFolder.add(shadowDarkness, 'value', 0, 1).name('darkness')
// Tone mapping of the tree and leaves: its type, and its exposure
const toneFolder = light.addFolder('tone mapping')
toneFolder
  .add({ type: 'neutral' }, 'type', Object.keys(TONE_MAPPINGS))
  .name('type')
  .onChange((name) => (toneMappingType.value = TONE_MAPPINGS[name]))
toneFolder.add(exposure, 'value', 0.1, 3).name('exposure')

const debug = renderer.inspector.createParameters('Debug')
const view = debug.addFolder('view')
view.add(params, 'leaves').name('show leaves').onChange((v) => (foliage.mesh.visible = v && foliage.mesh.count > 0))
view.add(params, 'emitters').name('show emitters').onChange((v) => (emitters.visible = v))
view.add(params, 'wireframe').name('wood wireframe').onChange((v) => (wireframe.visible = v))
const cardDebug = debug.addFolder('leaf cards')
cardDebug.add(params, 'brush').name('brush texture').onChange((v) => (foliage.uniforms.brush.value = v ? 1 : 0))
cardDebug
  .add(params, 'normals', ['transferred', 'flat card'])
  .onChange((v) => (foliage.uniforms.flatNormals.value = v === 'flat card' ? 1 : 0))
cardDebug.add(params, 'showNormals').name('show normals').onChange((v) => (foliage.uniforms.showNormals.value = v ? 1 : 0))

// A reset button under each section, and a copy-config button always in view
// under them all
const sections = [treeSection, leafSection, breeze, fall, colours, light, debug]
sections.forEach(addReset)
addCopyConfig(renderer.inspector, sections)

// Every section and folder starts closed
sections.forEach(closeAll)

// A filter box at the top of the Parameters tab
addParameterFilter(renderer.inspector)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => {
  controls.update()
  falling.update(renderer)
  renderer.render(scene, camera)
})
