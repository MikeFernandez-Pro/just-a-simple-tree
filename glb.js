import * as THREE from 'three/webgpu'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { download } from './capture.js'
import { LEAF_STOPS } from './foliage.js'
import { BARK_STOPS } from './shading.js'
import { encodeTexture, textureWriter } from './textures.js'

// The tree as a GLB ready for a plain MeshStandardMaterial anywhere: the
// wood, and the leaf cards as they stand with no wind, lit by the clumps'
// normals, cut out by the leaf texture, darkened by the gradient and AO in
// their vertex colours. Each material keeps its cel ramp in its extras
// (userData once loaded in three.js), for the snippet in the README to put
// the look back. Leaves in a dropped image's colours carry the image
// instead, and no ramp.
//
// With levels of detail, each level is a node, tree_LOD0 to tree_LODn, as
// Unity names them. Only the first is in the scene, so a plain viewer shows
// the full tree; it lists the others in glTF's MSFT_lod extension, with the
// share of the screen each wants in its extras. Each level's own extras say
// which it is, how many vertices it holds and the share of the screen it
// shows down to, so it can be told apart in Blender or an engine. The last
// level may be the impostor: one quad showing the view from its atlas
// nearest the camera's direction, which a plain viewer shows as the view
// from the front

// Screen shares down to which each level shows, the last the impostor's
const COVERAGE = [0.5, 0.25, 0.12, 0.05, 0.01]
// Each of count levels' share, the last always the last's
const coverageOf = (count) => [...COVERAGE.slice(0, count - 1), COVERAGE.at(-1)]

const hex = (color) => `#${color.getHexString()}`

// The leaf texture as glTF wants it: white leaves, cut out by alpha, or a
// dropped image's colours, cut out by its leaves
function cutout(leaves, colors) {
  const canvas = document.createElement('canvas')
  canvas.width = leaves.width
  canvas.height = leaves.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(leaves, 0, 0)
  const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let pixels = mask
  if (colors) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(colors, 0, 0, canvas.width, canvas.height)
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  }
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = mask.data[i]
    if (!colors) data[i] = data[i + 1] = data[i + 2] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// levels: each { wood, leaves }, the wood's geometry and the leaves baked.
// impostor: { atlas, frames, center, radius }, or none. textures: how the
// textures are written, one of textures.js' GLB_TEXTURES
export async function exportGlb({ levels, impostor, foliage, barkColors, species, seed, name, textures = 'png' }) {
  const scene = new THREE.Scene()
  scene.name = 'Just a simple tree'
  scene.userData = { species, seed }

  // One material each for the wood and the leaves, whatever the level
  const bark = new THREE.MeshStandardMaterial({ name: 'bark', color: barkColors[1].value, roughness: 1, metalness: 0 })
  bark.userData.celRamp = BARK_STOPS.map((at, i) => [at, hex(barkColors[i].value)])
  let leafMaterial
  function leavesOf(baked) {
    if (leafMaterial) return leafMaterial
    // A plain viewer shows them in the ramp's mid colour times the vertex
    // colours; those were divided by shadeScale, so it's multiplied back into
    // the colour, as far as a colour can go. A dropped image's colours stand
    // as they are
    const { shadeScale, texture, colors: own } = baked
    const colors = foliage.uniforms.colors.map((uniform) => uniform.value)
    const color = own ? new THREE.Color(1, 1, 1) : colors[1].clone().multiplyScalar(shadeScale)
    leafMaterial = new THREE.MeshStandardMaterial({
      name: 'leaves',
      color: new THREE.Color(Math.min(color.r, 1), Math.min(color.g, 1), Math.min(color.b, 1)),
      map: cutout(texture.image, own?.image),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    if (!own) leafMaterial.userData.celRamp = LEAF_STOPS.map((at, i) => [at, hex(colors[i])])
    leafMaterial.userData.shadeScale = shadeScale
    return leafMaterial
  }

  // A level's meshes, with suffix on their names. A bush has no wood, and a
  // tree may have no leaves
  function meshes({ wood, leaves }, suffix = '') {
    const found = []
    if (wood.attributes.position.count > 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', wood.attributes.position)
      geometry.setAttribute('normal', wood.attributes.normal)
      geometry.setIndex(wood.index)
      const mesh = new THREE.Mesh(geometry, bark)
      mesh.name = `wood${suffix}`
      found.push(mesh)
    }
    if (leaves.geometry.index.count > 0) {
      const mesh = new THREE.Mesh(leaves.geometry, leavesOf(leaves))
      mesh.name = `leaves${suffix}`
      found.push(mesh)
    }
    return found
  }

  const plugins = []
  const count = levels.length + (impostor ? 1 : 0)
  if (count === 1) {
    scene.add(...(impostor ? [impostorMesh(impostor)] : meshes(levels[0])))
  } else {
    const nodes = levels.map((level, i) => {
      const node = new THREE.Group()
      node.name = `tree_LOD${i}`
      node.add(...meshes(level, `_LOD${i}`))
      return node
    })
    if (impostor) {
      const node = new THREE.Group()
      node.name = `tree_LOD${levels.length}`
      const mesh = impostorMesh(impostor)
      mesh.name = `impostor_LOD${levels.length}`
      node.add(mesh)
      nodes.push(node)
    }
    const coverage = coverageOf(nodes.length)
    nodes.forEach((node, i) => {
      const vertices = node.children.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0)
      const what = i === 0 ? 'full detail' : impostor && i === nodes.length - 1 ? 'impostor' : 'lighter'
      node.userData = { level: i, detail: what, vertices, screenCoverage: coverage[i] }
    })
    scene.add(...nodes)
    plugins.push((writer) => lodWriter(writer, nodes))
  }

  // Every texture is encoded first, by textures.js rather than the
  // exporter, so the colour under its transparent pixels comes through
  const maps = new Set()
  scene.traverse((object) => object.material?.map && maps.add(object.material.map))
  const encoded = new Map()
  for (const map of maps) encoded.set(map, await encodeTexture(map, textures))
  plugins.push((writer) => textureWriter(writer, encoded))

  const exporter = new GLTFExporter()
  for (const plugin of plugins) exporter.register(plugin)
  const glb = await exporter.parseAsync(scene, { binary: true })
  download(new Blob([glb], { type: 'model/gltf-binary' }), name ?? `${species}-${seed}.glb`)
}

// MSFT_lod: the first node lists the others, which leave the scene, and
// the screen share each wants
function lodWriter(writer, [first, ...others]) {
  return {
    name: 'MSFT_lod',
    afterParse() {
      const { json, nodeMap } = writer
      const ids = others.map((node) => nodeMap.get(node))
      const node = json.nodes[nodeMap.get(first)]
      node.extensions = { ...node.extensions, MSFT_lod: { ids } }
      node.extras = { ...node.extras, MSFT_screencoverage: coverageOf(ids.length + 1) }
      for (const scene of json.scenes) scene.nodes = scene.nodes.filter((id) => !ids.includes(id))
      writer.extensionsUsed.MSFT_lod = true
    },
  }
}

// The impostor as one quad round the tree's sphere, unlit, the atlas's
// views on it. Its extras say how the atlas is laid out, for the README's
// snippet; with no shader, it shows the front frame, (frames - 1, 0)
function impostorMesh({ atlas, frames, center, radius }) {
  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2)
  geometry.translate(center.x, center.y, center.z)
  const uv = geometry.attributes.uv
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (frames - 1 + uv.getX(k)) / frames, uv.getY(k) / frames)
  const map = new THREE.CanvasTexture(atlas)
  map.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ name: 'impostor', map, alphaTest: 0.5, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'impostor'
  mesh.userData.impostor = { layout: 'hemi-octahedral', frames, radius, center: center.toArray() }
  return mesh
}
