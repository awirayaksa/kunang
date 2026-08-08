import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface AppState {
  theme: 'auto' | 'light' | 'dark'
  idleTimeoutMinutes: number
  scrollPositions: Record<string, number>
  bounds: { x: number; y: number; width: number; height: number } | null
}

const APPDATA_DIR = join(process.env.LOCALAPPDATA || app.getPath('userData'), 'kunang')
const STATE_PATH = join(APPDATA_DIR, 'state.json')

export function loadState(): AppState {
  try {
    // Using require here would need special handling, but since this is a
    // simple JSON read we'll do it synchronously at startup
    const fs = require('fs')
    const data = fs.readFileSync(STATE_PATH, 'utf8')
    const parsed = JSON.parse(data)
    return {
      theme: parsed.theme || 'auto',
      idleTimeoutMinutes: parsed.idleTimeoutMinutes || 0,
      scrollPositions: parsed.scrollPositions || {},
      bounds: parsed.bounds || null,
    }
  } catch {
    return {
      theme: 'auto',
      idleTimeoutMinutes: 0,
      scrollPositions: {},
      bounds: null,
    }
  }
}

export async function saveState(state: AppState): Promise<void> {
  const dir = APPDATA_DIR
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to save state:', err)
  }
}
