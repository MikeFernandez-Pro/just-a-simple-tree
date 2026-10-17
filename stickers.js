// Round white stickers, the buttons picking a theme along the top and a
// species down the left: outlined like the bar at the bottom, with a hard
// shadow, tilted a little either way. Once picked, one is pressed in and
// a ring in the outline's charcoal springs round it, a little way out. It
// can still be hovered for its name. White so they read on any background

const LINE = '#46434d' // the outline, as in the bar
const SIZE = 50 // a sticker's width, in pixels

let styled = false

// The stickers' look, added once; a row of them is any element with the
// stickers class, its own place left to it
function addStyle() {
  if (styled) return
  styled = true
  const style = document.createElement('style')
  style.textContent = `
    .stickers { display: flex; gap: 20px; user-select: none }
    .stickers button { width: ${SIZE}px; height: ${SIZE}px; padding: 0; border: 3px solid ${LINE};
      border-radius: 50%; background: #fff; box-shadow: 4px 4px 0 var(--button-shadow); font-size: 22px; line-height: 1;
      color: ${LINE}; display: flex; align-items: center; justify-content: center;
      cursor: pointer; position: relative;
      transition: box-shadow .08s, translate .08s, scale .25s cubic-bezier(.34, 1.8, .64, 1) }
    .stickers button::before { content: ''; position: absolute; inset: -9px; border: 3px solid ${LINE}; border-radius: 50%;
      opacity: 0; scale: .7; pointer-events: none;
      transition: opacity .12s, scale .3s cubic-bezier(.34, 1.8, .64, 1) }
    .stickers button.picked::before { opacity: 1; scale: 1 }
    .stickers button svg { width: 60%; height: 60% }
    .stickers button:nth-child(odd) { rotate: -6deg }
    .stickers button:nth-child(even) { rotate: 5deg }
    .stickers button:hover { box-shadow: 6px 6px 0 var(--button-shadow); scale: 1.08 }
    .stickers button:active, .stickers button.picked { box-shadow: 1px 1px 0 var(--button-shadow); translate: 3px 3px }
    .stickers button.picked { scale: 1.12; cursor: default }
    @media (max-width: 480px), (max-height: 500px) {
      .stickers { gap: 14px }
      .stickers button { width: ${SIZE * 0.68}px; height: ${SIZE * 0.68}px; border-width: 2.5px; font-size: 16px;
        box-shadow: 3px 3px 0 var(--button-shadow) }
      .stickers button::before { inset: -7px; border-width: 2.5px }
    }
  `
  document.head.appendChild(style)
}

// A row of stickers, one per choice, each showing its content (text or an
// SVG) and named for screen readers and on hover. Picking one calls onPick;
// the one picked can't be picked again. Returns the row, and show, marking
// a choice as the one picked
export function createStickers({ className, choices, label, onPick }) {
  addStyle()
  const row = document.createElement('div')
  row.className = `stickers ${className}`
  const buttons = {}
  for (const [name, content] of Object.entries(choices)) {
    const button = document.createElement('button')
    button.type = 'button'
    if (content.startsWith('<svg')) button.innerHTML = content
    else button.textContent = content
    button.title = name
    button.setAttribute('aria-label', label(name))
    // Let go of focus, so space makes a new tree instead of pressing this again
    button.addEventListener('click', () => {
      button.blur()
      if (button.classList.contains('picked')) return
      onPick(name)
    })
    buttons[name] = button
    row.appendChild(button)
  }
  document.body.appendChild(row)

  function show(name) {
    for (const [other, button] of Object.entries(buttons)) button.classList.toggle('picked', other === name)
  }
  return { row, show }
}
