import { INK, LINE } from './stickers.js'

// The tree's age and the season, as two upright sliders side by side on a
// white card at the right edge, across from the species, or in the bottom
// right corner of a narrow screen, which has room to spare below the tree
// rather than beside it: young at the
// bottom, old at the top, and the year from the leaves unfolding at the
// bottom to the bare tree at the top, an icon at each end and a name under
// each. Outlined and shadowed like the other cards, so they read on any
// background and theme. Each drives its control in the panel, so the
// address and the resets follow, and follows it back when a theme, a reset
// or a link moves it

const LENGTH = 150 // a slider's length, in pixels
const SMALL_LENGTH = 104 // on a small screen
// Each end's icon, in a 24 × 24 box, drawn in lines
const ICONS = {
  sapling: '<path d="M12 21v-8"/><path d="M12 14c-3.5 0-5.5-2-5.5-5.5 3.5 0 5.5 2 5.5 5.5z"/><path d="M12 12c0-3.5 2-5.5 5.5-5.5 0 3.5-2 5.5-5.5 5.5z"/>',
  oldTree: '<path d="M12 22v-6"/><path d="M8 22h8"/><path d="M7 16a4 4 0 0 1-.6-7.9 5.6 5.6 0 0 1 11.2 0A4 4 0 0 1 17 16z"/>',
  leaf: '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19l8-8"/>',
  winter: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>',
}
const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`

// controls: { age, season }, the panel's controls, each from 0 to 1.
// Returns each slider's label, so a species with no leaves can hide the season
export function createTimeSliders(controls) {
  const style = document.createElement('style')
  style.textContent = `
    .time { position: fixed; right: 16px; top: 50%; translate: 0 -50%; display: flex; gap: 6px; padding: 10px 8px 8px;
      border: 3px solid ${LINE}; border-radius: 14px; background: #fff; box-shadow: 4px 4px 0 var(--button-shadow);
      rotate: 1.5deg; user-select: none }
    .time label { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 46px; color: ${LINE};
      font: 700 11px/1 monospace; cursor: pointer }
    .time label > span { color: ${INK} }
    .time svg { width: 22px; height: 22px; flex: none }
    .time .track { position: relative; width: 24px; height: ${LENGTH}px }
    /* A level slider turned upright, which every browser can draw and drag,
       its track filled in charcoal from the bottom up to the knob, and the
       knob's shadow turned back so it falls down and right like the rest */
    .time input { --fill: 50%; appearance: none; position: absolute; left: 50%; top: 50%; width: ${LENGTH}px;
      height: 24px; margin: 0; translate: -50% -50%; rotate: -90deg; background: none; cursor: pointer }
    .time input:focus-visible { outline: 2px solid ${LINE}; outline-offset: 4px; border-radius: 4px }
    .time input::-webkit-slider-runnable-track { box-sizing: border-box; height: 10px; border: 2.5px solid ${LINE};
      border-radius: 5px; background: linear-gradient(to right, ${LINE} var(--fill), #fff var(--fill)) }
    .time input::-webkit-slider-thumb { appearance: none; box-sizing: border-box; width: 20px; height: 20px;
      margin-top: -7.5px; border: 2.5px solid ${LINE}; border-radius: 50%; background: #fff;
      box-shadow: -2px 2px 0 var(--button-shadow) }
    .time input::-moz-range-track { box-sizing: border-box; height: 10px; border: 2.5px solid ${LINE};
      border-radius: 5px; background: #fff }
    .time input::-moz-range-progress { height: 10px; border-radius: 5px; background: ${LINE} }
    .time input::-moz-range-thumb { box-sizing: border-box; width: 20px; height: 20px; border: 2.5px solid ${LINE};
      border-radius: 50%; background: #fff; box-shadow: -2px 2px 0 var(--button-shadow) }
    @media (max-width: 480px), (max-height: 500px) {
      .time { right: 10px; gap: 2px; padding: 8px 5px 6px; border-width: 2.5px; border-radius: 12px;
        box-shadow: 3px 3px 0 var(--button-shadow) }
      .time label { width: 38px; gap: 5px; font-size: 10px }
      .time svg { width: 18px; height: 18px }
      .time .track { height: ${SMALL_LENGTH}px }
      .time input { width: ${SMALL_LENGTH}px }
    }
    @media (max-width: 480px) { .time { top: auto; bottom: 84px; translate: none } }
  `
  document.head.appendChild(style)

  const card = document.createElement('div')
  card.className = 'time'
  document.body.appendChild(card)

  // One slider, its icon for 1 on top and for 0 under it, its name below
  function slider(control, name, title, top, bottom) {
    const label = document.createElement('label')
    label.title = title
    const input = document.createElement('input')
    input.type = 'range'
    input.min = 0
    input.max = 1
    input.step = 0.01
    input.setAttribute('aria-label', name)
    const track = document.createElement('div')
    track.className = 'track'
    track.append(input)
    const caption = document.createElement('span')
    caption.textContent = name
    label.insertAdjacentHTML('beforeend', svg(top))
    label.append(track)
    label.insertAdjacentHTML('beforeend', svg(bottom))
    label.append(caption)
    card.append(label)

    const show = (value) => {
      input.value = value
      input.style.setProperty('--fill', `${value * 100}%`)
    }
    show(control.getValue())
    input.addEventListener('input', () => {
      input.style.setProperty('--fill', `${input.value * 100}%`)
      control.setValue(Number(input.value))
    })
    // Let go of focus once it's set, so the keys step through the themes
    // and species again, and space makes a new tree
    input.addEventListener('change', () => input.blur())
    control.addEventListener('change', ({ value }) => show(value))
    return label
  }

  const age = slider(controls.age, 'age', 'the tree’s age: a sapling at the bottom, an old tree at the top', 'oldTree', 'sapling')
  const season = slider(controls.season, 'season', 'the season: the leaves unfolding at the bottom, a bare tree at the top', 'winter', 'leaf')

  return { card, age, season }
}
