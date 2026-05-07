import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const HISTORY_FILE = join(process.cwd(), 'data', 'appointments-sync-history.json')

export function loadSyncHistory(): Record<string, string> {
    if (!existsSync(HISTORY_FILE)) return {}
    try {
        return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
    } catch {
        return {}
    }
}

export function saveSyncHistory(history: Record<string, string>): void {
    const dir = join(process.cwd(), 'data')
    if (!existsSync(dir)) {
        import('fs').then(fs => fs.mkdirSync(dir, { recursive: true }))
    }
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
}