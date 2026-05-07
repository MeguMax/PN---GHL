import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const STATE_FILE = join(process.cwd(), 'data', 'sync-state.json')

export type SyncStateKey = 'contacts' | 'appointments' | 'purchases'
type SyncState = Partial<Record<SyncStateKey, string>>

export function loadSyncState(): SyncState {
    try {
        if (!existsSync(STATE_FILE)) return {}

        const raw = readFileSync(STATE_FILE, 'utf-8').trim()
        if (!raw) return {}

        return JSON.parse(raw) as SyncState
    } catch {
        return {}
    }
}

export function getSyncSince(key: SyncStateKey, fallback = '2020-01-01'): string {
    const state = loadSyncState()
    return state[key] ?? fallback
}

export function saveSyncTimestamp(
    key: SyncStateKey,
    timestamp: string = new Date().toISOString(),
): void {
    const state = loadSyncState()
    state[key] = timestamp

    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}