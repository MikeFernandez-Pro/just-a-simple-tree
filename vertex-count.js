// How many vertices save .glb would write, the trunk's (all the wood) and
// the leaves', and under a rule both together, on a small white card in the
// bottom left corner, outlined and shadowed like the bar's buttons so it
// reads on any background and theme. On a small screen it sits above the
// bar instead

const LINE = '#46434d' // the outline, as in the bar
const INK = '#2b2a30' // the numbers
const MUTED = '#77737f' // the words

export function createVertexCount() {
  const style = document.createElement('style')
  style.textContent = `
    .vertex-count { position: fixed; left: 26px; bottom: 26px; display: grid; grid-template-columns: auto auto;
      column-gap: 14px; padding: 9px 14px; border: 3px solid ${LINE}; border-radius: 10px; background: #fff;
      box-shadow: 4px 4px 0 var(--button-shadow); font: 13px/1.45 monospace; color: ${MUTED};
      transform: rotate(-1.5deg); user-select: none; pointer-events: none }
    .vertex-count .title { grid-column: 1 / -1; font-weight: 700; color: ${INK}; margin-bottom: 2px }
    .vertex-count b { color: ${INK}; text-align: right; font-variant-numeric: tabular-nums }
    .vertex-count hr { grid-column: 1 / -1; width: 100%; margin: 4px 0; border: 0; border-top: 2px solid ${LINE} }
    .vertex-count .total { color: ${INK}; font-weight: 700 }
    @media (max-width: 760px), (max-height: 500px) {
      .vertex-count { left: 50%; bottom: 96px; translate: -50% 0; padding: 6px 10px; font-size: 11px;
        border-width: 2.5px; box-shadow: 3px 3px 0 var(--button-shadow) }
    }
    @media (max-width: 480px), (max-height: 500px) {
      .vertex-count { bottom: 78px }
    }
  `
  document.head.appendChild(style)

  const card = document.createElement('div')
  card.className = 'vertex-count'
  card.setAttribute('aria-live', 'polite')
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = 'exported vertices'
  card.append(title)
  const row = (label) => {
    const name = document.createElement('span')
    name.textContent = label
    const value = document.createElement('b')
    card.append(name, value)
    return value
  }
  const trunk = row('trunk')
  const leaves = row('leaves')
  card.append(document.createElement('hr'))
  const total = row('total:')
  total.previousSibling.className = 'total'
  document.body.appendChild(card)

  function show(trunkCount, leafCount) {
    trunk.textContent = trunkCount.toLocaleString('en-US')
    leaves.textContent = leafCount.toLocaleString('en-US')
    total.textContent = (trunkCount + leafCount).toLocaleString('en-US')
  }

  return { show }
}
