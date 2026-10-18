import * as THREE from 'three/webgpu'
import { wind } from './wind.js'
import { burst, growth } from './regenerate.js'

// The tree drawn into images: a picture from the camera, a sprite sheet of
// views round it, and an impostor's atlas of views over the sky above it.
// The render loop stops while it draws. The tree stands still, fully grown,
// with no wind, the background clear if asked, and for sprites and impostors
// on its own: no floor, grass or falling leaves. Each view is drawn at twice
// its size, while that stays within MAX_DRAWN, and copied straight off the
// canvas into a 2D one, smoothed down, so the alpha-cut leaves come out
// clean. The lighting is the sun's at the time, baked in

const MAX_DRAWN = 4096 // the most pixels a side the canvas is drawn at
const WEBP_QUALITY = 1 // a WebP's, from 0 to 1: at 1 it's lossless, every pixel as drawn
const BATCH = 8 // views drawn before the browser gets a moment, so the GPU's watchdog never trips
export const MAX_ATLAS = 4096 // the most pixels a side of an impostor's atlas or a sprite sheet

export function createCapture({ renderer, scene, loop, scenery, tree }) {
  // Draws each camera's view into its place in a 2D context: at(i) gives
  // the top left corner of the i-th, width x height pixels
  async function shoot(cameras, { width, height, transparent, bare, into, at }) {
    const scale = Math.max(width, height) * 2 <= MAX_DRAWN ? 2 : 1
    const restore = still({ transparent, bare })
    renderer.setPixelRatio(1)
    renderer.setSize(width * scale, height * scale, false)
    into.imageSmoothingEnabled = true
    into.imageSmoothingQuality = 'high'
    try {
      for (let i = 0; i < cameras.length; i++) {
        renderer.render(scene, cameras[i])
        const [x, y] = at(i)
        into.drawImage(renderer.domElement, 0, 0, width * scale, height * scale, x, y, width, height)
        if (i % BATCH === BATCH - 1) await new Promise((resolve) => setTimeout(resolve))
      }
    } finally {
      restore()
    }
  }

  // The scene made still for drawing, and a function putting it back
  function still({ transparent, bare }) {
    renderer.setAnimationLoop(null)
    const saved = {
      pixelRatio: renderer.getPixelRatio(),
      clear: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(),
      background: scene.background,
      backgroundNode: scene.backgroundNode,
      wind: [wind.strength.value, wind.flutter.value, wind.gust.value],
      growth: [growth.value, burst.value],
      shown: scenery.map((object) => object.visible),
      scales: tree.map((object) => object.scale.clone()),
    }
    wind.strength.value = wind.flutter.value = wind.gust.value = 0
    growth.value = 1
    burst.value = 0
    for (const object of tree) object.scale.setScalar(1)
    if (bare) for (const object of scenery) object.visible = false
    if (transparent) {
      scene.background = null
      scene.backgroundNode = null
      renderer.setClearColor(0x000000, 0)
    }
    return () => {
      renderer.setClearColor(saved.clear, saved.alpha)
      scene.background = saved.background
      scene.backgroundNode = saved.backgroundNode
      ;[wind.strength.value, wind.flutter.value, wind.gust.value] = saved.wind
      ;[growth.value, burst.value] = saved.growth
      scenery.forEach((object, i) => (object.visible = saved.shown[i]))
      tree.forEach((object, i) => object.scale.copy(saved.scales[i]))
      renderer.setPixelRatio(saved.pixelRatio)
      renderer.setSize(innerWidth, innerHeight)
      renderer.setAnimationLoop(loop)
    }
  }

  // The view from the camera, its long side size pixels, the floor's
  // shadow, the grass and the falling leaves included. On the background
  // it's drawn on a canvas with no alpha, so the PNG comes out RGB
  async function picture(camera, { size, transparent }) {
    const aspect = innerWidth / innerHeight
    const width = Math.round(aspect >= 1 ? size : size * aspect)
    const height = Math.round(aspect >= 1 ? size / aspect : size)
    const view = camera.clone()
    view.aspect = width / height
    view.updateProjectionMatrix()
    const canvas = canvasOf(width, height)
    const into = canvas.getContext('2d', { alpha: transparent })
    await shoot([view], { width, height, transparent, into, at: () => [0, 0] })
    return canvas
  }

  // The tree from count bearings round it, looking down from elevation
  // radians above level, in a sheet four frames wide, left to right then
  // top to bottom. Frame k is seen from k / count of the way round,
  // counter-clockwise seen from above, from the front (+z) first. Every
  // frame has the same scale and the tree's foot on the same pixel
  async function sprites({ balls, box }, { count, size, elevation }) {
    const columns = Math.min(count, 4)
    const rows = Math.ceil(count / columns)
    const directions = Array.from({ length: count }, (_, k) => {
      const around = (k / count) * Math.PI * 2
      return new THREE.Vector3(Math.sin(around) * Math.cos(elevation), Math.sin(elevation), Math.cos(around) * Math.cos(elevation))
    })
    // How far the tree reaches across and up and down in every view, round
    // the trunk's axis, so the foot stays centred
    const axis = new THREE.Vector3(0, box.min.y, 0)
    const reach = box.getSize(new THREE.Vector3()).length()
    let across = 0
    let low = Infinity
    let high = -Infinity
    const point = new THREE.Vector3()
    const view = new THREE.OrthographicCamera()
    for (const direction of directions) {
      look(view, axis, direction, reach)
      for (const [x, y, z, r] of balls) {
        point.set(x, y, z).applyMatrix4(view.matrixWorldInverse)
        across = Math.max(across, Math.abs(point.x) + r)
        low = Math.min(low, point.y - r)
        high = Math.max(high, point.y + r)
      }
    }
    const half = Math.max(across, (high - low) / 2) * 1.02
    const middle = (low + high) / 2
    const cameras = directions.map((direction) => {
      const camera = new THREE.OrthographicCamera(-half, half, middle + half, middle - half, 0.01, reach * 4)
      look(camera, axis, direction, reach * 2)
      return camera
    })
    const canvas = canvasOf(columns * size, rows * size)
    const at = (k) => [(k % columns) * size, Math.floor(k / columns) * size]
    await shoot(cameras, { width: size, height: size, transparent: true, bare: true, into: canvas.getContext('2d'), at })
    return { canvas, columns, rows }
  }

  // An impostor's atlas: frames x frames views of the tree, each looking at
  // the sphere round it, from directions spread over the sky above it by a
  // hemi-octahedral map. Frame (i, j), i from the left and j from the
  // bottom, is seen from impostorDirection(i, j, frames)
  async function impostor({ center, radius }, { frames, size }) {
    const cameras = []
    for (let j = 0; j < frames; j++) {
      for (let i = 0; i < frames; i++) {
        const { direction, up } = impostorDirection(i, j, frames)
        const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, radius * 0.5, radius * 5.5)
        camera.up.copy(up)
        look(camera, center, direction, radius * 3)
        cameras.push(camera)
      }
    }
    const canvas = canvasOf(frames * size, frames * size)
    const at = (n) => [(n % frames) * size, (frames - 1 - Math.floor(n / frames)) * size]
    await shoot(cameras, { width: size, height: size, transparent: true, bare: true, into: canvas.getContext('2d'), at })
    return canvas
  }

  return { picture, sprites, impostor }
}

// A frame's direction from the impostor's centre, decoded from its place in
// the hemi-octahedral grid, and its view's up, square to it: the world's up
// leant back, or, looking straight down, -z
export function impostorDirection(i, j, frames) {
  const x = (i / (frames - 1)) * 2 - 1
  const y = (j / (frames - 1)) * 2 - 1
  const px = (x + y) / 2
  const pz = (x - y) / 2
  const direction = new THREE.Vector3(px, 1 - Math.abs(px) - Math.abs(pz), pz).normalize()
  const right = Math.abs(direction.y) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(direction).normalize()
  return { direction, up: direction.clone().cross(right) }
}

// A camera distance away from target along direction, looking at it
function look(camera, target, direction, distance) {
  camera.position.copy(target).addScaledVector(direction, distance)
  camera.lookAt(target)
  camera.updateMatrixWorld()
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

// Saves a file, as the browser's download
export function download(blob, name) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

// A canvas as an image file, a PNG or a WebP, and the extension it takes.
// A browser that can't write WebP, like Safari, writes a PNG instead, so the
// extension follows what was written
export async function encode(canvas, format) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, `image/${format}`, WEBP_QUALITY))
  return { blob, extension: blob.type === 'image/webp' ? 'webp' : 'png' }
}
