import { patientNowClient, withApiKeyParams } from '../../integrations/patientnow/client.js'
import { getSyncSince, saveSyncTimestamp } from '../../lib/sync-state.js'

export async function fetchPatientNowPurchaseHistory(params: Record<string, any> = {}) {
    const res = await patientNowClient.get('/api/v1/tickethistory', withApiKeyParams(params))
    return res.data
}

export async function syncPurchaseHistory(dryRun = false) {
    const since = getSyncSince('purchases')
    const syncStartedAt = new Date().toISOString()

    const purchases = await fetchPatientNowPurchaseHistory({
        ModifiedOnStart: since,
    })

    const sourceCount = Array.isArray(purchases) ? purchases.length : 0

    if (!Array.isArray(purchases) || purchases.length === 0) {
        if (!dryRun) saveSyncTimestamp('purchases', syncStartedAt)
        return {
            ok: true,
            since,
            sourceCount: 0,
            message: 'No purchase history records found in PatientNow',
        }
    }

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            since,
            sourceCount,
            dataPreview: purchases.slice(0, 5),
            message: `Dry run: ${sourceCount} purchase history records fetched`,
        }
    }

    if (!dryRun) saveSyncTimestamp('purchases', syncStartedAt)

    return {
        ok: true,
        since,
        sourceCount,
        message: 'Purchase history sync draft executed',
    }
}