import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { propMaterial } from './shading.js'

// The pumpkins from Last Light's well (a game on three-vat), at a
// species' foot when it grows some: a pair side by side and a carved one,
// each a node of public/models/pumpkins.glb standing on its foot at the
// origin, looking along +z. The species says where each goes and which way
// it looks; without any, they're hidden. Their colours are the well's,
// cel shaded as the wood is
export function createPumpkins() {
  const group = new THREE.Group()
  group.visible = false
  const parts = {}
  let spots = null
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/pumpkins.glb`, (gltf) => {
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return
      object.material = propMaterial(object.material.color)
      object.castShadow = object.receiveShadow = true
    })
    for (const part of [...gltf.scene.children]) {
      parts[part.name] = part
      group.add(part)
    }
    place(spots)
  })

  // spots: { [name]: { position, around } }, each pumpkin's place and the
  // compass bearing it looks out along, or null for none
  function place(next) {
    spots = next ?? null
    group.visible = !!spots
    if (!spots) return
    for (const [name, { position, around }] of Object.entries(spots)) {
      const part = parts[name]
      if (!part) continue
      part.position.copy(position)
      // Its +z turned to look along around
      part.rotation.y = Math.PI / 2 - around
    }
  }

  return { group, place }
}
