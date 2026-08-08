// In-page find for view mode. Edit mode has CodeMirror's own search panel.
//
// Matches are painted with the CSS Custom Highlight API rather than by
// wrapping hits in <mark> elements. Wrapping would mutate the rendered DOM,
// which carries the data-line anchors that scroll sync and the outline depend
// on, and would fight morphdom in the live preview. Highlights are painted
// from Range objects and touch nothing.

const ALL = 'kunang-find'
const CURRENT = 'kunang-find-current'

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

declare const Highlight: {
  new (...ranges: Range[]): unknown
}

function registry(): HighlightRegistryLike | null {
  const css = (globalThis as any).CSS
  if (!css || !css.highlights || typeof Highlight === 'undefined') return null
  return css.highlights as HighlightRegistryLike
}

let bar: HTMLElement
let input: HTMLInputElement
let countEl: HTMLElement
let scrollContainer: HTMLElement
let searchRoot: HTMLElement

let matches: Range[] = []
let current = -1
let open = false

export function isFindOpen(): boolean {
  return open
}

interface Segment {
  node: Text
  start: number
  end: number
}

export interface Bounds {
  start: number
  end: number
}

/**
 * Start indices of every non-overlapping, case-insensitive occurrence.
 *
 * Pure and exported for testing: the advance-past-the-match step is what stops
 * a search for "aa" in "aaaa" reporting three overlapping hits.
 */
export function findMatchIndices(haystack: string, needle: string): number[] {
  if (!needle) return []

  const hay = haystack.toLowerCase()
  const pin = needle.toLowerCase()
  const out: number[] = []

  let from = 0
  for (;;) {
    const at = hay.indexOf(pin, from)
    if (at === -1) return out
    out.push(at)
    from = at + pin.length
  }
}

/**
 * Map an index in the concatenated text back to the segment containing it.
 *
 * `preferEnd` resolves a boundary index to the end of the preceding segment
 * rather than offset 0 of the next one. A match that ends exactly on a segment
 * boundary otherwise produces a range whose end sits before its own last
 * character, and the highlight comes up short.
 */
export function locateIndex(
  bounds: Bounds[],
  index: number,
  preferEnd: boolean,
): { segment: number; offset: number } | null {
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]
    const hit = preferEnd ? index > b.start && index <= b.end : index >= b.start && index < b.end
    if (hit) return { segment: i, offset: index - b.start }
  }
  return null
}

function collectSegments(root: Element): { text: string; segments: Segment[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const segments: Segment[] = []
  let text = ''

  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = node as Text
    const data = t.data
    if (!data) continue
    segments.push({ node: t, start: text.length, end: text.length + data.length })
    text += data
  }

  return { text, segments }
}

function buildRanges(query: string): Range[] {
  if (!query) return []

  const { text, segments } = collectSegments(searchRoot)
  if (!text) return []

  const found: Range[] = []

  for (const at of findMatchIndices(text, query)) {
    const start = locateIndex(segments, at, false)
    const end = locateIndex(segments, at + query.length, true)
    if (!start || !end) continue

    const range = document.createRange()
    try {
      range.setStart(segments[start.segment].node, start.offset)
      range.setEnd(segments[end.segment].node, end.offset)
      found.push(range)
    } catch {
      // Ignore a range the DOM rejects; the remaining matches still stand.
    }
  }

  return found
}

function paint() {
  const reg = registry()
  if (!reg) return

  if (matches.length === 0) {
    reg.delete(ALL)
    reg.delete(CURRENT)
    return
  }

  const others = matches.filter((_, i) => i !== current)
  reg.set(ALL, new Highlight(...others))
  reg.set(CURRENT, current >= 0 ? new Highlight(matches[current]) : new Highlight())
}

function updateCount() {
  countEl.textContent = matches.length === 0
    ? (input.value ? 'no results' : '')
    : `${current + 1}/${matches.length}`
  input.classList.toggle('no-match', input.value.length > 0 && matches.length === 0)
}

function scrollToCurrent() {
  if (current < 0 || current >= matches.length) return

  const rect = matches[current].getBoundingClientRect()
  // A collapsed rect means the match is inside a hidden or detached subtree.
  if (rect.height === 0 && rect.width === 0) return

  const view = scrollContainer.getBoundingClientRect()
  if (rect.top >= view.top && rect.bottom <= view.bottom) return

  // Land the match a third of the way down rather than hard against the top,
  // so surrounding context stays visible.
  scrollContainer.scrollTop += rect.top - view.top - scrollContainer.clientHeight / 3
}

function search(resetPosition: boolean) {
  matches = buildRanges(input.value)
  if (matches.length === 0) {
    current = -1
  } else if (resetPosition || current < 0 || current >= matches.length) {
    current = 0
  }
  paint()
  updateCount()
  if (resetPosition) scrollToCurrent()
}

function step(delta: number) {
  if (matches.length === 0) return
  current = (current + delta + matches.length) % matches.length
  paint()
  updateCount()
  scrollToCurrent()
}

/** Re-run the current query — call after the document is re-rendered, since
 *  the old Ranges point at replaced nodes. */
export function refreshFind() {
  if (!open) return
  search(false)
}

export function openFind() {
  if (!bar) return

  open = true
  bar.hidden = false
  input.focus()
  input.select()

  // Re-run rather than reuse: the document may have changed since last time.
  search(true)
}

export function closeFind() {
  if (!bar || !open) return

  open = false
  bar.hidden = true
  matches = []
  current = -1

  const reg = registry()
  if (reg) {
    reg.delete(ALL)
    reg.delete(CURRENT)
  }
}

export function initFind(container: HTMLElement, root: HTMLElement) {
  bar = document.getElementById('find-bar')!
  input = document.getElementById('find-input') as HTMLInputElement
  countEl = document.getElementById('find-count')!
  scrollContainer = container
  searchRoot = root

  if (!registry()) {
    // Without the highlight API the bar can still navigate, it just cannot
    // colour matches. Better than removing the feature outright.
    console.warn('CSS Custom Highlight API unavailable; find will not highlight matches')
  }

  input.addEventListener('input', () => search(true))

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
    }
  })

  document.getElementById('find-next')!.addEventListener('click', () => step(1))
  document.getElementById('find-prev')!.addEventListener('click', () => step(-1))
  document.getElementById('find-close')!.addEventListener('click', () => closeFind())
}
