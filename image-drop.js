import { INK, LINE } from './stickers.js'

// An image of your own for the leaves: dropped anywhere on the page, or
// picked with the panel's button. While one is dragged over the page, a
// white card in the middle says what it's for, outlined and shadowed like
// the bar's buttons so it reads on any background and theme. The last image
// is kept in the browser, so a link that asks for it finds it again. While
// an image is dragged over the page, onDragging(true); false once it leaves,
// or once what was dropped turns out not to be an image. One that is goes
// to onImage

const KEY = 'just-a-simple-tree/leaf-image'
const KEPT_SIZE = 1024 // the longest side kept, in pixels
const MUTED = '#77737f' // the note under the words

export function createImageDrop({ onImage, onDragging }) {
  const style = document.createElement('style')
  style.textContent = `
    .image-drop { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none;
      opacity: 0; transition: opacity .12s; z-index: 10 }
    .image-drop.shown { opacity: 1 }
    .image-drop .card { display: grid; justify-items: center; gap: 6px; padding: 18px 28px; border: 3px solid ${LINE};
      border-radius: 10px; background: #fff; box-shadow: 5px 5px 0 var(--button-shadow); font: 700 18px/1.3 monospace;
      color: ${INK}; transform: rotate(-2deg); text-align: center }
    .image-drop .note { font-size: 12px; font-weight: 400; color: ${MUTED} }
  `
  document.head.appendChild(style)

  const overlay = document.createElement('div')
  overlay.className = 'image-drop'
  const card = document.createElement('div')
  card.className = 'card'
  const words = document.createElement('span')
  const note = document.createElement('span')
  note.className = 'note'
  card.append(words, note)
  overlay.append(card)
  document.body.appendChild(overlay)

  function say(main, small) {
    words.textContent = main
    note.textContent = small
  }
  let hiding
  function show(on) {
    clearTimeout(hiding)
    overlay.classList.toggle('shown', on)
  }

  const holdsFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  // dragleave fires going over every child too: only a drag that has left
  // the window hides the card
  addEventListener('dragover', (e) => {
    if (!holdsFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    say('drop to put it on the leaves', 'a PNG with transparency, or white leaves on black')
    show(true)
    onDragging(true)
  })
  addEventListener('dragleave', (e) => {
    if (e.relatedTarget) return
    show(false)
    onDragging(false)
  })
  addEventListener('drop', (e) => {
    if (!holdsFiles(e)) return
    e.preventDefault()
    take(e.dataTransfer.files[0])
  })

  // The picker for the panel's button
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', () => {
    if (input.files[0]) take(input.files[0])
    input.value = ''
  })

  async function take(file) {
    try {
      if (!file?.type.startsWith('image/')) throw new Error('not an image')
      const url = URL.createObjectURL(file)
      const image = await load(url).finally(() => URL.revokeObjectURL(url))
      show(false)
      keep(image)
      onImage(image, { restored: false })
    } catch {
      onDragging(false)
      say("that isn't an image", 'try a PNG, JPEG or WebP')
      show(true)
      hiding = setTimeout(() => show(false), 1600)
    }
  }

  // The image as a PNG, no bigger than it needs to be, in the browser's
  // storage. One too big for it simply isn't kept
  function keep(image) {
    const scale = Math.min(1, KEPT_SIZE / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    try {
      localStorage.setItem(KEY, canvas.toDataURL('image/png'))
    } catch {
      localStorage.removeItem(KEY)
    }
  }

  // The image kept from last time, if there is one
  async function restore() {
    const kept = localStorage.getItem(KEY)
    if (!kept) return
    try {
      onImage(await load(kept), { restored: true })
    } catch {
      localStorage.removeItem(KEY)
    }
  }

  return { pick: () => input.click(), restore }
}

function load(src) {
  const image = new Image()
  image.src = src
  return image.decode().then(() => image)
}
