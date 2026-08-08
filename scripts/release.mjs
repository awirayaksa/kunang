// Cuts a release: bumps the version, tags it, and pushes.
//
//   npm run release            -> patch  (0.1.0 -> 0.1.1)
//   npm run release -- minor   -> minor  (0.1.0 -> 0.2.0)
//   npm run release -- major   -> major  (0.1.0 -> 1.0.0)
//   npm run release -- 1.2.3   -> exact version
//
// Pushing the tag is what actually builds and publishes: .github/workflows/
// release.yml triggers on v*, builds the portable exe on a Windows runner, and
// uploads it to the GitHub release. Nothing is built locally here.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim()
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

function fail(msg) {
  process.stderr.write(`\nrelease aborted: ${msg}\n`)
  process.exit(1)
}

const bump = process.argv[2] || 'patch'
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  fail(`unknown version bump "${bump}" — use patch, minor, major, or an exact x.y.z`)
}

// A release must be reproducible from what is on the remote, so refuse to tag
// anything that only exists on this machine.
if (git(['status', '--porcelain'])) {
  fail('working tree is dirty — commit or stash first')
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') {
  fail(`on branch "${branch}" — releases are cut from main`)
}

git(['fetch', 'origin', 'main', '--quiet'])
if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) {
  fail('local main differs from origin/main — push or pull first')
}

process.stdout.write('> npm test\n')
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'])

// npm version writes package.json + package-lock.json, commits, and tags.
process.stdout.write(`\n> npm version ${bump}\n`)
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['version', bump, '-m', 'Release v%s'])

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

process.stdout.write('\n> pushing commit and tag\n')
run('git', ['push', '--follow-tags', 'origin', 'main'])

process.stdout.write(
  `\nReleased v${version}.\n` +
    `The release workflow is now building kunang-portable-${version}.exe.\n` +
    `Watch it: https://github.com/awirayaksa/kunang/actions\n` +
    `Release:  https://github.com/awirayaksa/kunang/releases/tag/v${version}\n`,
)
