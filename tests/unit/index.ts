import './encoding.test'
import './eol.test'
import './path-resolution.test'
import './sanitizer.test'
import { run } from './test-runner'

const passed = run()
process.exit(passed ? 0 : 1)
