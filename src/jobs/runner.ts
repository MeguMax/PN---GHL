import { syncContacts, syncContactsReverse } from '../modules/contacts/service.js'
import { syncAppointments, syncGhlAppointmentsReverse } from '../modules/appointments/service.js'
import { syncPurchases } from '../modules/purchase-history/purchases-service.js'

const CYCLE_DELAY_MS = Number(process.env.SYNC_CYCLE_DELAY_MS ?? 60_000)

let started = false
let running = false
let stopRequested = false

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runStep(name: string, job: () => Promise<unknown>) {
    const startedAt = new Date().toISOString()
    console.log(`[runner] START ${name} at ${startedAt}`)

    try {
        const result = await job()
        console.log(`[runner] DONE ${name}`, result)
        return result
    } catch (error: any) {
        console.error(`[runner] FAIL ${name}`, error?.message ?? error)
        return {
            ok: false,
            step: name,
            error: error?.message ?? String(error),
        }
    }
}

async function runCycle() {
    if (running) {
        console.log('[runner] Previous cycle still running, skip overlapping cycle')
        return
    }

    running = true

    try {
        await runStep('syncContacts', () => syncContacts(false))
        if (stopRequested) return

        await runStep('syncAppointments', () => syncAppointments(false))
        if (stopRequested) return

        await runStep('syncPurchases', () => syncPurchases(false))
        if (stopRequested) return

        await runStep('syncContactsReverse', () => syncContactsReverse(false))
        if (stopRequested) return

        await runStep('syncGhlAppointmentsReverse', () => syncGhlAppointmentsReverse(false))
    } finally {
        running = false
    }
}

export async function startSyncRunner() {
    if (started) {
        console.log('[runner] Sync runner already started')
        return
    }

    started = true
    console.log(`[runner] Sync runner started. Cycle delay: ${CYCLE_DELAY_MS}ms`)

    while (!stopRequested) {
        await runCycle()

        if (stopRequested) break

        console.log(`[runner] Sleeping for ${CYCLE_DELAY_MS}ms before next cycle`)
        await sleep(CYCLE_DELAY_MS)
    }

    console.log('[runner] Sync runner stopped')
}

export function stopSyncRunner() {
    console.log('[runner] Stop requested')
    stopRequested = true
}