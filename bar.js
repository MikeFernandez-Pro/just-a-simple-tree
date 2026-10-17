import { INK, LINE } from './stickers.js'

// The buttons at the bottom, like stickers: white, a soft outline and a
// hard shadow off to the side, tilted a little, so they read on any
// background and theme. A new tree, and saving it as a GLB; each says what
// it's doing while it runs

export function createBar({ onNewTree, onSave }) {
  const style = document.createElement('style')
  style.textContent = `
    .bar { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%); display: flex; gap: 22px; user-select: none }
    .bar button { display: flex; align-items: center; gap: 10px; padding: 13px 26px;
      border: 3px solid ${LINE}; border-radius: 10px; background: #fff; box-shadow: 5px 5px 0 var(--button-shadow);
      font: 700 16px/1.2 monospace; letter-spacing: .02em; color: ${INK}; cursor: pointer;
      transform: rotate(-2deg); transition: box-shadow .08s, translate .08s }
    .bar button:nth-child(2) { transform: rotate(1.5deg) }
    .bar button .icon { font-size: 18px }
    .bar button:hover { box-shadow: 7px 7px 0 var(--button-shadow) }
    .bar button:active, .bar button.running { box-shadow: 1px 1px 0 var(--button-shadow); translate: 4px 4px }
    .bar button.running { cursor: default; color: #999 }
    @media (max-width: 480px), (max-height: 500px) {
      .bar { bottom: 18px; gap: 14px }
      .bar button { gap: 8px; padding: 10px 16px; font-size: 14px; box-shadow: 4px 4px 0 var(--button-shadow) }
      .bar button .icon { font-size: 16px }
    }
  `
  document.head.appendChild(style)

  const bar = document.createElement('div')
  bar.className = 'bar'

  // A button that runs something, pressed in and showing busy while it runs,
  // and done for a moment after, if it has a word for that. Its icon goes
  // before or after its words, which may run over a few lines
  function action({ label, icon, iconAfter = false, busy, done, doneIcon }, run) {
    const button = document.createElement('button')
    button.type = 'button'
    const iconSpan = document.createElement('span')
    iconSpan.className = 'icon'
    const labelSpan = document.createElement('span')
    button.append(...(iconAfter ? [labelSpan, iconSpan] : [iconSpan, labelSpan]))
    const show = (i, text) => {
      iconSpan.textContent = i
      labelSpan.textContent = text
    }
    show(icon, label)
    // As wide and tall as its longest words, so it doesn't change size as
    // they change
    const lines = [label, busy, done ?? ''].flatMap((words) => words.split('\n'))
    labelSpan.style.cssText =
      `display:flex;align-items:center;white-space:pre;text-align:left;` +
      `min-width:${Math.max(...lines.map((line) => line.length))}ch;min-height:${label.split('\n').length * 1.2}em`
    let running = false
    async function trigger() {
      if (running) return
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

  const newTree = action({ label: 'generate\nnew tree', icon: '⟳', iconAfter: true, busy: 'growing…' }, onNewTree)
  action({ label: 'save .glb', icon: '↓', busy: 'saving…', done: 'saved', doneIcon: '✓' }, onSave)
  document.body.appendChild(bar)

  return { newTree }
}
