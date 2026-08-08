// KaTeX and Mermaid are large and most documents use neither, so they are
// imported only once a rendered document is found to contain them. Keeping
// them out of the initial bundle is the whole point: the double-click path is
// measured in tens of milliseconds and must not pay for features this document
// does not use.

let katexModule: typeof import('katex') | null = null
let mermaidModule: typeof import('mermaid') | null = null
let mermaidReady = false

// Bumped on every enhance() call. An in-flight import that finishes after the
// document has moved on must not paint into the new one.
let generation = 0

async function loadKatex() {
  if (!katexModule) {
    const [mod] = await Promise.all([
      import('katex'),
      // Side-effect import; the bundler emits it as part of the same lazy chunk.
      import('katex/dist/katex.min.css'),
    ])
    katexModule = mod
  }
  return katexModule
}

async function loadMermaid(dark: boolean) {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid')
  }

  if (!mermaidReady) {
    mermaidModule.default.initialize({
      startOnLoad: false,
      // Diagram text comes from an untrusted document. strict disables click
      // handlers and raw HTML in labels.
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
    })
    mermaidReady = true
  }

  return mermaidModule.default
}

function renderMath(katex: typeof import('katex'), root: HTMLElement) {
  const nodes = root.querySelectorAll<HTMLElement>('.math-inline, .math-block')

  nodes.forEach((el) => {
    // textContent, not innerHTML: the source was escaped into the element, and
    // this reverses that exactly.
    const source = el.textContent ?? ''
    if (!source.trim()) return

    try {
      katex.default.render(source, el, {
        displayMode: el.classList.contains('math-block'),
        // Show the offending source in red rather than throwing away the
        // whole document because one formula is malformed.
        throwOnError: false,
        strict: false,
      })
    } catch {
      el.classList.add('math-error')
    }
  })
}

async function renderMermaid(root: HTMLElement, dark: boolean, mine: number) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'))
  if (blocks.length === 0) return

  const mermaid = await loadMermaid(dark)
  if (mine !== generation) return

  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]
    const source = el.textContent ?? ''
    if (!source.trim()) continue

    try {
      const { svg } = await mermaid.render(`kunang-mermaid-${mine}-${i}`, source)
      if (mine !== generation) return
      el.innerHTML = svg
      el.classList.add('mermaid-rendered')
    } catch (err) {
      // Leave the source visible and say why, rather than showing a blank box.
      el.classList.add('mermaid-error')
      el.setAttribute('title', String(err))
    }
  }
}

/**
 * Fill in any math or diagram placeholders inside `root`.
 *
 * Safe to call on every render: it returns immediately when the document
 * contains neither, which is the common case.
 */
export async function enhance(root: HTMLElement, dark: boolean): Promise<void> {
  const mine = ++generation

  const hasMath = root.querySelector('.math-inline, .math-block') !== null
  const hasMermaid = root.querySelector('.mermaid-block') !== null
  if (!hasMath && !hasMermaid) return

  try {
    if (hasMath) {
      const katex = await loadKatex()
      if (mine !== generation) return
      renderMath(katex, root)
    }

    if (hasMermaid) {
      await renderMermaid(root, dark, mine)
    }
  } catch (err) {
    console.error('lazy render failed', err)
  }
}
