// Minimal test runner for Node.js unit tests

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

interface SuiteResult {
  name: string
  tests: TestResult[]
}

const suites: SuiteResult[] = []
let currentSuite: SuiteResult | null = null

export function describe(name: string, fn: () => void) {
  currentSuite = { name, tests: [] }
  fn()
  suites.push(currentSuite)
  currentSuite = null
}

export function it(name: string, fn: () => void) {
  try {
    fn()
    currentSuite!.tests.push({ name, passed: true })
  } catch (e: any) {
    currentSuite!.tests.push({ name, passed: false, error: e.message || String(e) })
  }
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
      throw new Error('Expected function to throw')
    } catch (e: any) {
      if (e.message === 'Expected function to throw') throw e
    }
  },
}

export function run(): boolean {
  let totalTests = 0
  let totalPassed = 0
  let allPassed = true

  for (const suite of suites) {
    console.log(`\n${suite.name}`)
    for (const test of suite.tests) {
      totalTests++
      const icon = test.passed ? '  ✓' : '  ✗'
      console.log(`${icon} ${test.name}`)
      if (test.passed) {
        totalPassed++
      } else {
        allPassed = false
        console.log(`    ${test.error}`)
      }
    }
  }

  console.log(`\n${totalPassed}/${totalTests} tests passed`)
  return allPassed
}
