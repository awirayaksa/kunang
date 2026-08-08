import './encoding.test'
import './eol.test'
import './path-resolution.test'
import './sanitizer.test'
import './roundtrip.test'
import './watcher.test'
import { run } from './test-runner'

// Not top-level await: tsx transpiles this tree to CJS, which does not
// support it.
run().then((passed) => {
  process.exit(passed ? 0 : 1)
})
