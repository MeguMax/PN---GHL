import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'data')
const SYNC_STATE_FILE = join(DATA_DIR, 'sync-state.json')
const APPOINTMENTS_HISTORY_FILE = join(DATA_DIR, 'appointments-sync-history.json')
const PURCHASES_HISTORY_FILE = join(DATA_DIR, 'purchases-sync-history.json')

function readJsonFile<T>(filePath: string, fallback: T): T {
    try {
        if (!existsSync(filePath)) return fallback

        const raw = readFileSync(filePath, 'utf-8').trim()
        if (!raw) return fallback

        return JSON.parse(raw) as T
    } catch {
        return fallback
    }
}

function countKeys(obj: Record<string, unknown>): number {
    return Object.keys(obj).length
}

export function getSyncStatus() {
    const syncState = readJsonFile<Record<string, string>>(SYNC_STATE_FILE, {})
    const appointmentsHistory = readJsonFile<Record<string, string>>(APPOINTMENTS_HISTORY_FILE, {})
    const purchasesHistory = readJsonFile<Record<string, string>>(PURCHASES_HISTORY_FILE, {})

    return {
        ok: true,
        now: new Date().toISOString(),
        syncState,
        history: {
            appointments: {
                fileExists: existsSync(APPOINTMENTS_HISTORY_FILE),
                syncedCount: countKeys(appointmentsHistory),
            },
            purchases: {
                fileExists: existsSync(PURCHASES_HISTORY_FILE),
                syncedCount: countKeys(purchasesHistory),
            },
        },
    }
}