import { INK, LINE } from './stickers.js'

// The buttons at the bottom, like stickers: white, a soft outline and a
// hard shadow off to the side, tilted a little, so they read on any
// background and theme. A new tree, and exporting it as a GLB; each says what
// it's doing while it runs. Both are laid out alike and as wide as each
// other: an icon on the left, then their words centred, with a quieter note
// underneath

const MUTED = '#8a8692' // the note under the words

// Drawn in strokes, in the ink's colour, in a 24 × 24 box
const ICONS = {
  regrow: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/>',
  download: '<path d="M12 3.5v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  done: '<path d="m5 12.5 4.5 4.5L19 7"/>',
}
const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

export function createBar({ onNewTree, onSave }) {
  const style = document.createElement('style')
  style.textContent = `
    .bar { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); display: grid;
      grid-auto-flow: column; grid-auto-columns: 1fr; gap: 22px; user-select: none }
    .bar button { display: flex; align-items: center; gap: 14px; padding: 11px 22px 11px 18px;
      border: 3px solid ${LINE}; border-radius: 10px; background: #fff; box-shadow: 5px 5px 0 var(--button-shadow);
      font: 700 16px/1.2 monospace; letter-spacing: .02em; color: ${INK}; cursor: pointer;
      transform: rotate(-2deg); transition: box-shadow .08s, translate .08s }
    .bar button:nth-child(2) { transform: rotate(1.5deg) }
    .bar button svg { flex: none; width: 26px; height: 26px }
    .bar button .words { flex: 1; display: grid; justify-items: center; white-space: pre; text-align: center }
    .bar button .main { display: grid; place-items: center }
    .bar button .main > span { grid-area: 1 / 1 }
    .bar button .note { font-size: 12px; font-weight: 400; color: ${MUTED}; margin-top: 2px }
    .bar button:hover { box-shadow: 7px 7px 0 var(--button-shadow) }
    .bar button:active, .bar button.running { box-shadow: 1px 1px 0 var(--button-shadow); translate: 4px 4px }
    .bar button.running { cursor: default; color: #999 }
    .bar button.running.again { cursor: pointer; color: ${INK} }
    .bar button.running.spins svg { animation: bar-spin .9s linear infinite }
    @keyframes bar-spin { to { rotate: 360deg } }
    @media (max-width: 480px), (max-height: 500px) {
      .bar { bottom: 18px; gap: 14px }
      .bar button { gap: 10px; padding: 9px 16px 9px 13px; font-size: 14px; box-shadow: 4px 4px 0 var(--button-shadow) }
      .bar button svg { width: 22px; height: 22px }
      .bar button .note { font-size: 11px }
    }
  `
  document.head.appendChild(style)

  const bar = document.createElement('div')
  bar.className = 'bar'

  // A button that runs something, pressed in and showing busy while it runs,
  // and done for a moment after, if it has a word for that. Its words may
  // run over a few lines; its note, if it has one, stays the same
  // throughout. One that can go again presses on while it runs: run
  // is called again, and the first press's run is to carry on until the
  // latest has finished. One that spins turns its icon while it runs
  function action({ label, note, icon, busy, done, doneIcon, again = false, spins = false }, run) {
    const button = document.createElement('button')
    button.type = 'button'
    const iconSpan = document.createElement('span')
    iconSpan.style.display = 'contents'
    const words = document.createElement('span')
    words.className = 'words'
    // Every wording it can show, stacked in one cell with only the current
    // one visible, so the button is as wide as the longest of them in
    // whatever font draws them, and doesn't change size as they change
    const main = document.createElement('span')
    main.className = 'main'
    const wordings = new Map(
      [label, busy, done].filter(Boolean).map((text) => {
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
    const show = (i, text) => {
      iconSpan.innerHTML = svg(i)
      for (const [wording, span] of wordings) span.style.visibility = wording === text ? '' : 'hidden'
    }
    show(icon, label)
    let running = false
    if (again) button.classList.add('again')
    if (spins) button.classList.add('spins')
    async function trigger() {
      if (running) {
        if (again) run()
        return
      }
      running = true
      button.classList.add('running')
      show(icon, busy)
      await run()
      button.classList.remove('running')
      if (done) {
        show(doneIcon, done)
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      show(icon, label)
      running = false
    }
    // Let go of focus, so space makes a new tree instead of pressing this again
    button.addEventListener('click', () => {
      button.blur()
      trigger()
    })
    bar.appendChild(button)
    return trigger
  }

  const newTree = action(
    { label: 'generate a\nnew tree', icon: 'regrow', busy: 'growing…', again: true, spins: true },
    onNewTree,
  )
  action(
    { label: 'export tree', note: '(.glb)', icon: 'download', busy: 'exporting…', done: 'exported', doneIcon: 'done' },
    onSave,
  )
  document.body.appendChild(bar)

  return { newTree }
}
