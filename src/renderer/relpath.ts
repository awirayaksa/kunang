// Turning an absolute dropped-file path into a link relative to the open
// document. The inverse of resolveRelativePath in render.ts.
//
// This lives in the renderer, which has no access to node's path module, so
// the Windows-specific rules are handled explicitly: separators may be mixed,
// comparison is case-insensitive, and two paths on different drives have no
// relative form at all.

function split(p: string): string[] {
  return p.replace(/\\/g, '/').split('/').filter((s) => s.length > 0)
}

function driveOf(p: string): string {
  const m = /^([a-zA-Z]):/.exec(p)
  return m ? m[1].toLowerCase() : ''
}

/**
 * Path to `target` relative to directory `fromDir`, using forward slashes.
 *
 * Returns an absolute path unchanged when no relative form exists — different
 * drives, or a UNC share against a local path.
 */
export function toRelativePath(fromDir: string, target: string): string {
  if (!fromDir || !target) return target

  const fromUnc = /^[/\\]{2}/.test(fromDir)
  const targetUnc = /^[/\\]{2}/.test(target)
  if (fromUnc !== targetUnc) return target

  const fromDrive = driveOf(fromDir)
  const targetDrive = driveOf(target)
  if (fromDrive !== targetDrive) return target

  const fromParts = split(fromDir)
  const targetParts = split(target)

  let common = 0
  while (
    common < fromParts.length &&
    common < targetParts.length &&
    fromParts[common].toLowerCase() === targetParts[common].toLowerCase()
  ) {
    common++
  }

  // A UNC path's server and share are not directories that '..' can climb
  // out of, so refuse to walk above them.
  if (targetUnc && common < 2) return target

  const up = fromParts.length - common
  const down = targetParts.slice(common)

  if (up === 0 && down.length === 0) return target

  const rel = [...Array(up).fill('..'), ...down].join('/')

  // Prefix a same-directory path with ./ so it can never be mistaken for a
  // protocol-relative or absolute reference.
  return up === 0 ? `./${rel}` : rel
}

/** Final path segment, for use as image alt text. */
export function basename(p: string): string {
  const parts = split(p)
  return parts.length > 0 ? parts[parts.length - 1] : p
}
