import * as THREE from 'three/webgpu'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { download, impostorDirection } from './capture.js'
import { LEAF_STOPS } from './foliage.js'
import { IMPOSTOR } from './lod.js'
import { BARK_STOPS } from './shading.js'
import { encodeTexture, textureWriter } from './textures.js'

// The tree as a GLB ready for a plain MeshStandardMaterial anywhere: the
// wood, and the leaf cards as they stand with no wind, lit by the clumps'
// normals, cut out by the leaf texture, darkened by the gradient and AO in
// their vertex colours, split by their age into leaves, young leaves and
// turned leaves. Each material keeps its cel ramp in its extras
// (userData once loaded in three.js), for the snippet in the README to put
// the look back. Leaves in a dropped image's colours carry the image
// instead, and no ramp. Or, in place of the tree, its impostor: one quad
// showing the view from its atlas nearest the camera's direction, which a
// plain viewer shows as the view from the front.
//
// Or the tree with levels of detail: each level a node, tree_LOD0 to
// tree_LODn, as Unity names them. Only the first is in the scene, so a
// plain viewer shows the full tree; it lists the others in glTF's MSFT_lod
// extension, with the share of the screen each wants in its extras. Each
// level's own extras say which it is, how many vertices it holds and the
// share of the screen it shows down to, so it can be told apart in Blender
// or an engine. The impostor may be the last level

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

// tree: { wood, leaves }, the wood's geometry and the leaves baked; or
// levels, each { wood, leaves, coverage }, the first the tree as it is; or
// impostor: { atlas, frames, crops, center, radius }, alone or after the
// levels
export async function exportGlb({ tree, levels, impostor, barkColors, species, seed, name }) {
  const scene = new THREE.Scene()
  scene.name = 'Just a simple tree'
  scene.userData = { species, seed }

  // One material each for the wood and the leaves
  const bark = new THREE.MeshStandardMaterial({ name: 'bark', color: barkColors[1].value, roughness: 1, metalness: 0 })
  bark.userData.celRamp = BARK_STOPS.map((at, i) => [at, hex(barkColors[i].value)])
  // A material for each part of the leaves, by their age: the leaves, young
  // leaves and turned leaves, each with its own ramp, and the same at
  // every level. Parts cut out the same way share one texture
  const cutouts = new Map()
  const leafMaterials = new Map()
  function leavesOf(part, leaves) {
    if (!leafMaterials.has(part.name)) leafMaterials.set(part.name, leafMaterial(part, leaves))
    return leafMaterials.get(part.name)
  }
  function leafMaterial({ name, colors, own }, { shadeScale, texture }) {
    // A plain viewer shows them in the ramp's mid colour times the vertex
    // colours; those were divided by shadeScale, so it's multiplied back into
    // the colour, as far as a colour can go. A dropped image's colours stand
    // as they are
    const color = own ? new THREE.Color(1, 1, 1) : colors[1].clone().multiplyScalar(shadeScale)
    const material = new THREE.MeshStandardMaterial({
      name,
      color: new THREE.Color(Math.min(color.r, 1), Math.min(color.g, 1), Math.min(color.b, 1)),
      map: cutouts.get(own) ?? cutouts.set(own, cutout(texture.image, own?.image)).get(own),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    if (!own) material.userData.celRamp = LEAF_STOPS.map((at, i) => [at, hex(colors[i])])
    material.userData.shadeScale = shadeScale
    return material
  }

  // The tree's meshes, with suffix on their names. A bush has no wood, and
  // a tree may have no leaves
  function meshes({ wood, leaves }, suffix = '') {
    const found = []
    if (wood.attributes.position.count > 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', wood.attributes.position)
      geometry.setAttribute('normal', wood.attributes.normal)
      geometry.setAttribute('uv', wood.attributes.uv)
      geometry.setIndex(wood.index)
      const mesh = new THREE.Mesh(geometry, bark)
      mesh.name = `wood${suffix}`
      found.push(mesh)
    }
    for (const part of leaves.parts) {
      const mesh = new THREE.Mesh(part.geometry, leavesOf(part, leaves))
      mesh.name = `${part.name}${suffix}`
      found.push(mesh)
    }
    return found
  }

  const plugins = []
  if (levels) {
    const nodes = levels.map((level, i) => {
      const node = new THREE.Group()
      node.name = `tree_LOD${i}`
      node.add(...meshes(level, `_LOD${i}`))
      node.userData = { level: i, detail: i === 0 ? 'full detail' : 'lighter', screenCoverage: level.coverage }
      return node
    })
    if (impostor) {
      const node = new THREE.Group()
      node.name = `tree_LOD${levels.length}`
      const mesh = impostorMesh(impostor)
      mesh.traverse((part) => (part.name += `_LOD${levels.length}`))
      node.add(mesh)
      node.userData = { level: levels.length, detail: 'impostor', screenCoverage: IMPOSTOR.coverage }
      nodes.push(node)
    }
    for (const node of nodes) {
      let vertices = 0
      node.traverse((part) => (vertices += part.geometry?.attributes.position.count ?? 0))
      node.userData.vertices = vertices
    }
    scene.add(...nodes)
    plugins.push((writer) => lodWriter(writer, nodes))
  } else scene.add(...(impostor ? [impostorMesh(impostor)] : meshes(tree)))

  // Every texture is written first as a PNG, by textures.js rather than
  // the exporter, so the colour under its transparent pixels comes through
  const maps = new Set()
  scene.traverse((object) => object.material?.map && maps.add(object.material.map))
  const encoded = new Map()
  for (const map of maps) encoded.set(map, await encodeTexture(map))
  plugins.push((writer) => textureWriter(writer, encoded))
  const exporter = new GLTFExporter()
  for (const plugin of plugins) exporter.register(plugin)
  const glb = await exporter.parseAsync(scene, { binary: true })
  download(new Blob([glb], { type: 'model/gltf-binary' }), name ?? `${species}-${seed}.glb`)
}

// MSFT_lod: the first node lists the others, which leave the scene, and
// the share of the screen each wants
function lodWriter(writer, [first, ...others]) {
  return {
    name: 'MSFT_lod',
    afterParse() {
      const { json, nodeMap } = writer
      const ids = others.map((node) => nodeMap.get(node))
      const node = json.nodes[nodeMap.get(first)]
      node.extensions = { ...node.extensions, MSFT_lod: { ids } }
      node.extras = { ...node.extras, MSFT_screencoverage: [first, ...others].map((n) => n.userData.screenCoverage) }
      for (const scene of json.scenes) scene.nodes = scene.nodes.filter((id) => !ids.includes(id))
      writer.extensionsUsed.MSFT_lod = true
    },
  }
}

// The impostor as one quad, unlit, the atlas's views on it. Its extras say
// how the atlas is laid out, for the README's snippet, each view's crop
// included, and where the sun was that lit it. With no shader, it shows the
// front frame, (frames - 1, 0), the quad its crop: that view looks along
// -z, its right +x and its up +y. The snippet tells the quad's corners
// apart by their UVs. With a shadow, its shadow on the ground is a quad
// under it
export function impostorMesh({ atlas, frames, crops, center, radius, sun, shadow }) {
  const [left, bottom, right, top] = crops[frames - 1]
  const geometry = new THREE.PlaneGeometry(right - left, top - bottom)
  geometry.translate(center.x + (left + right) / 2, center.y + (bottom + top) / 2, center.z)
  const uv = geometry.attributes.uv
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (frames - 1 + uv.getX(k)) / frames, uv.getY(k) / frames)
  const map = new THREE.CanvasTexture(atlas)
  map.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ name: 'impostor', map, alphaTest: 0.5, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'impostor'
  mesh.userData.impostor = { layout: 'hemi-octahedral', frames, radius, center: center.toArray(), crops, sun: sun.toArray() }
  if (shadow) mesh.add(shadowMesh({ atlas, frames, crops, center }, sun, shadow))
  return mesh
}

const LOWEST_SUN = 0.1 // the least the sun's direction rises, so a low sun's shadow ends about ten heights away
const SHADOW_LIFT = 0.02 // metres the shadow lies above the ground, so it never fights it

// The impostor's shadow: a quad on the ground, under the tree, showing the
// view in the atlas nearest the sun's direction, the tree as the sun sees
// it. That view is laid flat through the tree's centre and cast along the
// sunlight onto the ground: its crop's corners land there, and the quad
// stretches the view between them, which is exact, as the view is drawn
// with no perspective. Its texture is that view alone, white wherever the
// tree is, and the quad is the shadow colour at its darkness, so it looks
// as the floor's shadow does
function shadowMesh({ atlas, frames, crops, center }, sun, { color, darkness }) {
  const light = sun.clone().setY(Math.max(sun.y, LOWEST_SUN)).normalize()
  const spread = Math.abs(light.x) + Math.abs(light.y) + Math.abs(light.z)
  const [px, pz] = [light.x / spread, light.z / spread]
  const nearest = (value) => THREE.MathUtils.clamp(Math.floor((value * 0.5 + 0.5) * (frames - 1) + 0.5), 0, frames - 1)
  const [i, j] = [nearest(px + pz), nearest(px - pz)]
  const { direction, up } = impostorDirection(i, j, frames)
  const right = up.clone().cross(direction)
  const [left, bottom, far, top] = crops[j * frames + i]
  const corner = (across, high) => {
    const point = center.clone().addScaledVector(right, across).addScaledVector(up, high)
    return point.addScaledVector(light, -point.y / light.y).setY(SHADOW_LIFT)
  }
  const corners = [corner(left, bottom), corner(far, bottom), corner(far, top), corner(left, top)]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((point) => point.toArray()), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  // Wound to face up, whichever way round the corners landed
  const facesUp = new THREE.Vector3().subVectors(corners[1], corners[0]).cross(new THREE.Vector3().subVectors(corners[2], corners[0])).y > 0
  geometry.setIndex(facesUp ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])
  // The view copied out of the atlas, whose frame (i, j) counts up from
  // its bottom, and made white, keeping its alpha
  const frame = atlas.width / frames
  const size = Math.ceil(frame)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  context.drawImage(atlas, i * frame, (frames - 1 - j) * frame, frame, frame, 0, 0, size, size)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  // With no mipmaps: seen along the ground, they'd average the shadow
  // with the clear round it and fade it
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.generateMipmaps = false
  map.minFilter = THREE.LinearFilter
  const material = new THREE.MeshBasicMaterial({ name: 'impostor shadow', color, map, transparent: true, opacity: darkness, depthWrite: false })
  material.polygonOffset = true
  material.polygonOffsetFactor = material.polygonOffsetUnits = -1
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'impostor shadow'
  return mesh
}
