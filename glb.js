import * as THREE from 'three/webgpu'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { LEAF_STOPS } from './foliage.js'
import { BARK_STOPS } from './shading.js'

// The tree as a GLB ready for a plain MeshStandardMaterial anywhere: the
// wood, and the leaf cards as they stand with no wind, lit by the clumps'
// normals, cut out by the leaf texture, darkened by the gradient and AO in
// their vertex colours. Each material keeps its cel ramp in its extras
// (userData once loaded in three.js), for the snippet in the README to put
// the look back

const hex = (color) => `#${color.getHexString()}`

// The leaf texture as glTF wants it: white leaves, cut out by alpha
function cutout(image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = data[i]
    data[i] = data[i + 1] = data[i + 2] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export async function exportGlb({ tree, foliage, barkColors, species, seed }) {
  const scene = new THREE.Scene()
  scene.name = 'Just a simple tree'
  scene.userData = { species, seed }

  // The wood, without what only the growing needs
  const woodGeometry = new THREE.BufferGeometry()
  woodGeometry.setAttribute('position', tree.geometry.attributes.position)
  woodGeometry.setAttribute('normal', tree.geometry.attributes.normal)
  woodGeometry.setIndex(tree.geometry.index)
  const bark = new THREE.MeshStandardMaterial({ name: 'bark', color: barkColors[1].value, roughness: 1, metalness: 0 })
  bark.userData.celRamp = BARK_STOPS.map((at, i) => [at, hex(barkColors[i].value)])
  const wood = new THREE.Mesh(woodGeometry, bark)
  wood.name = 'wood'
  scene.add(wood)

  // The leaves. A plain viewer shows them in the ramp's mid colour times
  // the vertex colours; those were divided by shadeScale, so it's multiplied
  // back into the colour, as far as a colour can go
  const { geometry, shadeScale, texture } = foliage.bake()
  if (geometry.index.count > 0) {
    const colors = foliage.uniforms.colors.map((uniform) => uniform.value)
    const leafMaterial = new THREE.MeshStandardMaterial({
      name: 'leaves',
      color: colors[2].clone().multiplyScalar(shadeScale),
      map: cutout(texture.image),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    leafMaterial.color.r = Math.min(leafMaterial.color.r, 1)
    leafMaterial.color.g = Math.min(leafMaterial.color.g, 1)
    leafMaterial.color.b = Math.min(leafMaterial.color.b, 1)
    leafMaterial.userData.celRamp = LEAF_STOPS.map((at, i) => [at, hex(colors[i])])
    leafMaterial.userData.shadeScale = shadeScale
    const leaves = new THREE.Mesh(geometry, leafMaterial)
    leaves.name = 'leaves'
    scene.add(leaves)
  }

  const glb = await new GLTFExporter().parseAsync(scene, { binary: true })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }))
  link.download = `${species}-${seed}.glb`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
