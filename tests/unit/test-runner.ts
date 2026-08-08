// Minimal test runner for Node.js unit tests.
//
// describe/it register tests; run() executes them. Registration is separate
// from execution so that a test body may be async — the watcher tests need to
// wait on real filesystem events.

type TestFn = () => void | Promise<void>

interface TestCase {
  name: string
  fn: TestFn
}

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

interface Suite {
  name: string
  tests: TestCase[]
}

const suites: Suite[] = []
let currentSuite: Suite | null = null

export function describe(name: string, fn: () => void) {
  currentSuite = { name, tests: [] }
  fn()
  suites.push(currentSuite)
  currentSuite = null
}

export function it(name: string, fn: TestFn) {
  if (!currentSuite) {
    throw new Error(`it("${name}") called outside describe()`)
  }
  currentSuite.tests.push({ name, fn })
}

export const assert = {
  equal: (actual: any, expected: any) => {
    if (actual !== expected) {
      throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  },
  deepEqual: (actual: any, expected: any) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) {
      throw new Error(`Expected ${b}, got ${a}`)
    }
  },
  ok: (value: any) => {
    if (!value) {
      throw new Error('Expected truthy value')
    }
  },
  throws: (fn: () => void) => {
    try {
      fn()
    } catch {
      return
    }
    throw new Error('Expected function to throw')
  },
}

export async function run(): Promise<boolean> {
  let totalTests = 0
  let totalPassed = 0
  let allPassed = true

  for (const suite of suites) {
    console.log(`\n${suite.name}`)

    for (const test of suite.tests) {
      totalTests++

      let result: TestResult
      try {
        await test.fn()
        result = { name: test.name, passed: true }
      } catch (e: any) {
        result = { name: test.name, passed: false, error: e?.message || String(e) }
      }

      console.log(`${result.passed ? '  ✓' : '  ✗'} ${result.name}`)
      if (result.passed) {
        totalPassed++
      } else {
        allPassed = false
        console.log(`    ${result.error}`)
      }
    }
  }

  console.log(`\n${totalPassed}/${totalTests} tests passed`)
  return allPassed
}
