import * as THREE from 'three/webgpu'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { download } from './capture.js'
import { LEAF_STOPS } from './foliage.js'
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
// plain viewer shows as the view from the front

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
// impostor: { atlas, frames, crops, center, radius }
export async function exportGlb({ tree, impostor, barkColors, species, seed, name }) {
  const scene = new THREE.Scene()
  scene.name = 'Just a simple tree'
  scene.userData = { species, seed }

  // One material each for the wood and the leaves
  const bark = new THREE.MeshStandardMaterial({ name: 'bark', color: barkColors[1].value, roughness: 1, metalness: 0 })
  bark.userData.celRamp = BARK_STOPS.map((at, i) => [at, hex(barkColors[i].value)])
  // A material for each part of the leaves, by their age: the leaves, young
  // leaves and turned leaves, each with its own ramp. Parts cut out the
  // same way share one texture
  const cutouts = new Map()
  function leavesOf({ name, colors, own }, { shadeScale, texture }) {
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

  // The tree's meshes. A bush has no wood, and a tree may have no leaves
  function meshes({ wood, leaves }) {
    const found = []
    if (wood.attributes.position.count > 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', wood.attributes.position)
      geometry.setAttribute('normal', wood.attributes.normal)
      geometry.setIndex(wood.index)
      const mesh = new THREE.Mesh(geometry, bark)
      mesh.name = 'wood'
      found.push(mesh)
    }
    for (const part of leaves.parts) {
      const mesh = new THREE.Mesh(part.geometry, leavesOf(part, leaves))
      mesh.name = part.name
      found.push(mesh)
    }
    return found
  }

  scene.add(...(impostor ? [impostorMesh(impostor)] : meshes(tree)))

  // Every texture is written first as a PNG, by textures.js rather than
  // the exporter, so the colour under its transparent pixels comes through
  const maps = new Set()
  scene.traverse((object) => object.material?.map && maps.add(object.material.map))
  const encoded = new Map()
  for (const map of maps) encoded.set(map, await encodeTexture(map))
  const exporter = new GLTFExporter()
  exporter.register((writer) => textureWriter(writer, encoded))
  const glb = await exporter.parseAsync(scene, { binary: true })
  download(new Blob([glb], { type: 'model/gltf-binary' }), name ?? `${species}-${seed}.glb`)
}

// The impostor as one quad, unlit, the atlas's views on it. Its extras say
// how the atlas is laid out, for the README's snippet, each view's crop
// included. With no shader, it shows the front frame, (frames - 1, 0), the
// quad its crop: that view looks along -z, its right +x and its up +y. The
// snippet tells the quad's corners apart by their UVs
function impostorMesh({ atlas, frames, crops, center, radius }) {
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
  mesh.userData.impostor = { layout: 'hemi-octahedral', frames, radius, center: center.toArray(), crops }
  return mesh
}
