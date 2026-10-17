// A filter box for the WebGPU Inspector's Parameters tab: type part of a
// name and only the parameters that match stay, inside their groups, which
// open to show them; a group whose own name matches keeps all its
// parameters. Clearing the box puts every row back and restores which
// groups were open.
// It walks the tab's items through their public API (children, isOpen,
// toggle, show, hide), so it could move into three.js's Parameters tab as is.
// A control set unavailable stays hidden whatever the filter does

// Shows or hides a control for good, past the filter: like a slider that
// only one species of tree has
export function setAvailable(control, available) {
  control.domElement.dataset.unavailable = available ? '' : 'true'
  if (available) control.show()
  else control.hide()
}
const unavailable = (item) => item.data?.[1]?.dataset?.unavailable === 'true'

export function addParameterFilter(inspector) {
  const parameters = inspector.parameters

  const box = document.createElement('div')
  box.style.cssText = 'padding:6px 8px;position:sticky;top:0;z-index:1;background:inherit'
  const field = document.createElement('div')
  field.style.cssText = 'position:relative'
  // A small magnifier inside the box, on the left
  const icon = document.createElement('span')
  icon.style.cssText =
    'position:absolute;left:8px;top:50%;transform:translateY(-50%);display:flex;' +
    'color:var(--text-secondary);pointer-events:none'
  icon.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>'
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = 'Filter parameters…'
  input.style.cssText =
    'width:100%;box-sizing:border-box;padding:5px 8px 5px 28px;font:inherit;color:var(--text-primary);' +
    'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;outline:none'
  input.addEventListener('focus', () => (input.style.borderColor = 'var(--color-accent)'))
  input.addEventListener('blur', () => (input.style.borderColor = 'rgba(255,255,255,0.12)'))
  field.append(icon, input)
  box.appendChild(field)
  // Right above the list, wherever it lives: the tab moves its content
  // between its full view and its small floating panel, siblings included
  const list = parameters.paramList.domElement.parentElement
  list.parentElement.insertBefore(box, list)

  // Which groups were open before filtering, to put back when it's cleared
  let openBefore = null

  // A group's name is a string, a parameter's an element holding it
  const label = (item) => {
    const name = item.data[0]
    return String(typeof name === 'string' ? name : (name?.textContent ?? '')).trim().toLowerCase()
  }
  const groups = () => parameters.groups.map((group) => group.paramList)

  function walk(item, visit) {
    visit(item)
    for (const child of item.children) walk(child, visit)
  }
  const show = (item) => unavailable(item) || item.show()

  function setOpen(item, open) {
    if (item.children.length > 0 && item.isOpen !== open) item.toggle()
  }

  // Shows the item if it or anything under it matches; returns whether it did
  function filter(item, query) {
    if (unavailable(item)) return false
    if (label(item).includes(query)) {
      walk(item, (inner) => {
        show(inner)
        setOpen(inner, true)
      })
      return true
    }
    let found = false
    for (const child of item.children) found = filter(child, query) || found
    if (found) {
      item.show()
      setOpen(item, true)
    } else {
      item.hide()
    }
    return found
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase()
    if (query) {
      if (!openBefore) {
        openBefore = new Map()
        for (const group of groups()) walk(group, (item) => openBefore.set(item, item.isOpen))
      }
      for (const group of groups()) filter(group, query)
    } else if (openBefore) {
      for (const group of groups()) {
        walk(group, (item) => {
          show(item)
          if (openBefore.has(item)) setOpen(item, openBefore.get(item))
        })
      }
      openBefore = null
    }
  })

  return input
}
