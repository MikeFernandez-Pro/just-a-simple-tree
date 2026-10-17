import { createStickers } from './stickers.js'

// The buttons picking the species, a column of stickers down the left side,
// centred, each with its species' small flat silhouette in the outline's
// ink. Hovering one shows its name beside it, on a little sticker of its own

const LINE = '#46434d' // the outline, as in the stickers
const INK = '#2b2a30' // the words, as in the bar

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${paths}</svg>`

export function createSpeciesButtons({ species, onPick }) {
  const style = document.createElement('style')
  style.textContent = `
    .species { position: fixed; left: 16px; top: 50%; transform: translateY(-50%); flex-direction: column }
    @media (max-width: 480px), (max-height: 500px) {
      .species { left: 12px }
    }
    .species button::after { content: attr(data-name); position: absolute; left: calc(100% + 20px); top: 50%;
      translate: -6px -50%; padding: 5px 10px; border: 2.5px solid ${LINE}; border-radius: 8px; background: #fff;
      box-shadow: 3px 3px 0 var(--button-shadow); font: 700 14px/1.2 monospace; color: ${INK}; white-space: nowrap;
      opacity: 0; pointer-events: none; transition: opacity .12s, translate .12s }
    @media (hover: hover) {
      .species button:hover::after { opacity: 1; translate: 0 -50% }
    }
  `
  document.head.appendChild(style)

  const choices = Object.fromEntries(Object.entries(species).map(([key, { icon }]) => [key, svg(icon)]))
  const { row, show } = createStickers({
    className: 'species',
    choices,
    label: (key) => `${species[key].name} tree`,
    onPick,
  })
  // The name shows beside the button, so the browser's own tooltip would
  // only repeat it
  for (const button of row.children) {
    button.dataset.name = species[button.title].name
    button.removeAttribute('title')
  }
  return { show }
}
