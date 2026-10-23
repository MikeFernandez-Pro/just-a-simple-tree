import { INK, LINE, PHONE } from './stickers.js'

// The buttons at the bottom, like stickers: white, a soft outline and a
// hard shadow off to the side, tilted a little, so they read on any
// background and theme. Both are laid out alike and as wide as each other:
// an icon on the left, then their words centred, with a quieter note
// underneath. A new tree can be asked for at any moment, even while the last
// one is still growing, so its button never shows busy: its arrow turns once
// each time, and the tree growing is the rest of the answer. Export opens a
// menu above it of what to save, grouped as 3D models and images, each
// just its name, what it's for in its tooltip, with a way to the panel's
// settings for them, where the file types are picked. It shows busy while it exports, as one export runs at
// a time, the panel's own export buttons going through it too. A phone has
// no export button, only a new tree, its exports left to the panel

const MUTED = '#8a8692' // the notes under the buttons' words, and the menu's headings

// Drawn in strokes, in the ink's colour, in a 24 × 24 box
const ICONS = {
  regrow: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/>',
  download: '<path d="M12 3.5v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  done: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  caret: '<path d="m6 15 6-6 6 6"/>',
  settings:
    '<path d="M4 7h9"/><path d="M19 7h1"/><circle cx="16" cy="7" r="2.5"/><path d="M4 17h3"/><path d="M13 17h7"/><circle cx="10" cy="17" r="2.5"/>',
}
const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

export function createBar({ onNewTree, exports, onSettings }) {
  const style = document.createElement('style')
  style.textContent = `
    .bar { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); display: grid;
      grid-auto-flow: column; grid-auto-columns: 1fr; gap: 22px; user-select: none }
    .bar > button { display: flex; align-items: center; gap: 14px; padding: 11px 22px 11px 18px;
      border: 3px solid ${LINE}; border-radius: 10px; background: #fff; box-shadow: 5px 5px 0 var(--button-shadow);
      font: 700 16px/1.2 monospace; letter-spacing: .02em; color: ${INK}; cursor: pointer;
      transform: rotate(-2deg); transition: box-shadow .08s, translate .08s }
    .bar > button:nth-child(2) { transform: rotate(1.5deg); padding-right: 16px }
    .bar > button svg { flex: none; width: 26px; height: 26px }
    .bar > button .words { flex: 1; display: grid; justify-items: center; white-space: pre; text-align: center }
    .bar > button .main { display: grid; place-items: center }
    .bar > button .main > span { grid-area: 1 / 1 }
    .bar > button .note { font-size: 12px; font-weight: 400; color: ${MUTED}; margin-top: 2px }
    .bar > button .caret { display: contents }
    .bar > button .caret svg { width: 16px; height: 16px; transition: rotate .15s }
    .bar > button.open .caret svg { rotate: 180deg }
    .bar > button:hover { box-shadow: 7px 7px 0 var(--button-shadow) }
    .bar > button:active, .bar > button.open, .bar > button.running { box-shadow: 1px 1px 0 var(--button-shadow); translate: 4px 4px }
    .bar > button.running { cursor: default; color: #999 }
    .bar > button svg.turn { animation: bar-turn .55s cubic-bezier(.34, 1.4, .64, 1) }
    @keyframes bar-turn { from { rotate: 0deg } to { rotate: 360deg } }
    .bar .menu { position: absolute; right: 0; bottom: calc(100% + 18px); display: none; padding: 8px;
      box-sizing: border-box; width: max-content; max-width: min(400px, calc(100vw - 24px));
      border: 3px solid ${LINE}; border-radius: 10px; background: #fff; box-shadow: 5px 5px 0 var(--button-shadow);
      transform: rotate(1deg) }
    .bar .menu.open { display: grid }
    .bar .menu .heading { padding: 8px 14px 4px; font: 700 11px/1.2 monospace; letter-spacing: .1em;
      text-transform: uppercase; color: ${MUTED} }
    .bar .menu .heading ~ .heading { margin-top: 4px }
    .bar .menu button { display: block; padding: 7px 14px; border: 0; border-radius: 6px;
      background: none; font: 700 15px/1.3 monospace; color: ${INK}; text-align: left; cursor: pointer; white-space: nowrap }
    .bar .menu button:hover, .bar .menu button:focus-visible { background: #efedf2; outline: none }
    .bar .menu .rule { height: 2px; margin: 6px 8px; background: #ecebef }
    .bar .menu button.settings { display: flex; align-items: center; gap: 10px; font-size: 13px }
    .bar .menu button.settings svg { width: 18px; height: 18px }
    @media (hover: none) { .bar > button .note { display: none } }
    @media (max-width: 480px), (max-height: 500px) {
      .bar { bottom: 18px; gap: 14px }
      .bar > button { gap: 10px; padding: 9px 16px 9px 13px; font-size: 14px; box-shadow: 4px 4px 0 var(--button-shadow) }
      .bar > button svg { width: 22px; height: 22px }
      .bar > button .note { font-size: 11px }
      .bar > button .words { white-space: normal }
      .bar .menu { right: 50%; translate: 50% 0 }
    }
    @media ${PHONE} { .bar > button.export { display: none } }
  `
  document.head.appendChild(style)

  const bar = document.createElement('div')
  bar.className = 'bar'

  // A button with an icon, its words, and maybe a note under them and a mark
  // after them. Every wording it can show is stacked in one cell with only
  // the current one visible, so the button is as wide as the longest of them
  // in whatever font draws them, and doesn't change size as they change
  function sticker({ icon, wordings, note, after }) {
    const button = document.createElement('button')
    button.type = 'button'
    const iconSpan = document.createElement('span')
    iconSpan.style.display = 'contents'
    const words = document.createElement('span')
    words.className = 'words'
    const main = document.createElement('span')
    main.className = 'main'
    const spans = new Map(
      wordings.map((text) => {
        const span = document.createElement('span')
        span.textContent = text
        main.append(span)
        return [text, span]
      }),
    )
    words.append(main)
    if (note) {
      const noteSpan = document.createElement('span')
      noteSpan.className = 'note'
      noteSpan.textContent = note
      words.append(noteSpan)
    }
    button.append(iconSpan, words)
    if (after) {
      const mark = document.createElement('span')
      mark.className = 'caret'
      mark.innerHTML = svg(after)
      button.append(mark)
    }
    const show = (name, text) => {
      iconSpan.innerHTML = svg(name)
      for (const [wording, span] of spans) span.style.visibility = wording === text ? '' : 'hidden'
    }
    show(icon, wordings[0])
    bar.appendChild(button)
    return { button, show }
  }

  // A new tree: its arrow starts a turn afresh each press, however soon
  const regrow = sticker({ icon: 'regrow', wordings: ['new tree'], note: '(space)' })
  function newTree() {
    const arrow = regrow.button.querySelector('svg')
    arrow.classList.remove('turn')
    arrow.getBoundingClientRect()
    arrow.classList.add('turn')
    ;(async () => onNewTree())().catch(console.error)
  }
  // Let go of focus, so space makes a new tree instead of pressing this again
  regrow.button.addEventListener('click', () => {
    regrow.button.blur()
    newTree()
  })

  // Export: busy while it runs, then saved for a moment, unless it failed.
  // Another export may start while saved still shows, and its busy replaces it
  const save = sticker({ icon: 'download', wordings: ['export', 'exporting…', 'saved'], note: '(glb, png)', after: 'caret' })
  save.button.classList.add('export')
  let exporting = false
  let runs = 0
  async function run(what) {
    if (exporting) return
    exporting = true
    const mine = ++runs
    save.button.classList.add('running')
    save.show('download', 'exporting…')
    let failed = false
    try {
      await what()
    } catch (error) {
      console.error(error)
      failed = true
    }
    save.button.classList.remove('running')
    exporting = false
    if (!failed) {
      save.show('done', 'saved')
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
    if (mine === runs) save.show('download', 'export')
  }

  // The menu, in its groups. Each choice has its name, and what it's for as
  // its tooltip. Picking one closes the menu and exports
  const menu = document.createElement('div')
  menu.className = 'menu'
  for (const group of new Set(exports.map((choice) => choice.group))) {
    const heading = document.createElement('div')
    heading.className = 'heading'
    heading.textContent = group
    menu.append(heading)
    for (const { label, use, run: what } of exports.filter((choice) => choice.group === group)) {
      const item = document.createElement('button')
      item.type = 'button'
      item.title = use
      item.textContent = label
      item.addEventListener('click', () => {
        open(false)
        run(what)
      })
      menu.append(item)
    }
  }
  const rule = document.createElement('div')
  rule.className = 'rule'
  const settings = document.createElement('button')
  settings.type = 'button'
  settings.className = 'settings'
  settings.innerHTML = `${svg('settings')}<span>export settings…</span>`
  settings.addEventListener('click', () => {
    open(false)
    onSettings()
  })
  menu.append(rule, settings)

  const isOpen = () => menu.classList.contains('open')
  function open(on) {
    menu.classList.toggle('open', on)
    save.button.classList.toggle('open', on)
    save.button.setAttribute('aria-expanded', on)
  }
  save.button.setAttribute('aria-haspopup', 'menu')
  save.button.setAttribute('aria-expanded', false)
  save.button.addEventListener('click', () => {
    save.button.blur()
    if (!exporting) open(!isOpen())
  })
  addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target) && !save.button.contains(e.target)) open(false)
  })
  // Escape closes the menu; the arrows step through its choices, round from
  // either end
  addEventListener('keydown', (e) => {
    if (!isOpen()) return
    if (e.key === 'Escape') open(false)
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...menu.querySelectorAll('button')]
    const at = items.indexOf(document.activeElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next = at === -1 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length
    items[next].focus()
  })
  bar.append(menu)
  document.body.appendChild(bar)

  return { newTree, menuOpen: isOpen, run }
}
