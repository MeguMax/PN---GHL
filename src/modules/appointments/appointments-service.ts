import { patientNowClient, withApiKeyParams } from '../../integrations/patientnow/client.js'
import { ghlClient } from '../../integrations/ghl/client.js'
import { env } from '../../config/env.js'
import fs from 'fs'
import path from 'path'

// Types

export type PatientNowAppointment = {
    AppointmentId: string
    CompanyId?: string
    CustomerId?: string
    EmployeeId?: string
    ServiceId?: string
    Customer?: string
    Employee?: string
    Service?: string
    ApptType?: string
    StartDate?: string
    Init?: number
    Delay?: number
    Complete?: number
    Notes?: string
    BookedOnline?: boolean
}

// Sync history

const HISTORY_FILE = path.resolve('data/appointments-sync-history.json')

function loadHistory(): Record<string, string> {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
        }
    } catch {}
    return {}
}

function saveHistory(history: Record<string, string>) {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
}

// PatientNow fetchers

export async function fetchAllAppointments(params: Record<string, any> = {}): Promise<PatientNowAppointment[]> {
    const res = await patientNowClient.get('/api/v1/appointments', withApiKeyParams(params))
    return Array.isArray(res.data) ? res.data : []
}

export async function fetchCustomerAppointments(
    customerId: string,
    params: Record<string, any> = {},
): Promise<PatientNowAppointment[]> {
    const res = await patientNowClient.post(
        `/api/v1/customers/${customerId}/Appointments`,
        {},
        withApiKeyParams(params),
    )
    return Array.isArray(res.data) ? res.data : []
}

// GHL helpers

async function findGhlContactByCustomerId(customerId: string): Promise<string | null> {
    if (!customerId) return null
    try {
        const res = await ghlClient.get('/contacts/', {
            params: {
                locationId: env.GHL_LOCATION_ID,
                query: customerId,
            },
        })
        const contacts = res.data?.contacts ?? []

        const match = contacts.find((c: any) =>
            c.customFields?.some((f: any) => f.key === 'patientnow_customer_id' && f.value === customerId)
        )
        return match?.id ?? null
    } catch {
        return null
    }
}

async function createGhlAppointmentNote(contactId: string, body: string): Promise<string | null> {
    try {
        const res = await ghlClient.post(`/contacts/${contactId}/notes`, {
            userId: contactId,
            body,
        })
        return res.data?.note?.id ?? res.data?.id ?? null
    } catch {
        return null
    }
}

// Formatter

function formatAppointmentNote(appt: PatientNowAppointment): string {
    const date = appt.StartDate
        ? new Date(appt.StartDate).toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          })
        : 'Unknown date'

    const lines: string[] = [
        `[Appointment] ${appt.Service ?? appt.ApptType ?? 'Service'} — ${date}`,
    ]

    if (appt.Employee)  lines.push(`Provider: ${appt.Employee}`)
    if (appt.Service)   lines.push(`Service: ${appt.Service}`)
    if (appt.ApptType)  lines.push(`Type: ${appt.ApptType}`)

    if (appt.Complete != null) lines.push(`Duration: ${appt.Complete} min`)

    if (appt.Notes?.trim()) {
        lines.push('')
        lines.push(`Notes: ${appt.Notes.trim()}`)
    }

    if (appt.BookedOnline) lines.push('Booked online: Yes')

    lines.push('')
    lines.push(`PatientNow AppointmentId: ${appt.AppointmentId}`)
    if (appt.CustomerId) lines.push(`PatientNow CustomerId: ${appt.CustomerId}`)

    return lines.join('\n')
}

// Main sync

export async function syncAppointments(dryRun = false) {
    const appointments = await fetchAllAppointments({
        StartDate: '2020-01-01',
        EndDate:   '2030-12-31',
    })

    if (!appointments.length) {
        return { ok: true, sourceCount: 0, message: 'No appointments found in PatientNow' }
    }

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            sourceCount: appointments.length,
            dataPreview: appointments.slice(0, 3),
            message: `Dry run: ${appointments.length} appointments found, no GHL notes created`,
        }
    }

    const history = loadHistory()

    const succeeded: { appointmentId: string; ghlNoteId?: string; skipped?: boolean }[] = []
    const failed:    { appointmentId: string; error: string }[] = []

    for (const appt of appointments) {
        try {

            if (history[appt.AppointmentId]) {
                succeeded.push({ appointmentId: appt.AppointmentId, ghlNoteId: history[appt.AppointmentId], skipped: true })
                continue
            }

            if (!appt.CustomerId) {
                failed.push({ appointmentId: appt.AppointmentId, error: 'Missing CustomerId on appointment' })
                continue
            }

            const ghlContactId = await findGhlContactByCustomerId(appt.CustomerId)

            if (!ghlContactId) {
                failed.push({
                    appointmentId: appt.AppointmentId,
                    error: `No GHL contact found for CustomerId: ${appt.CustomerId}`,
                })
                continue
            }

            const noteBody  = formatAppointmentNote(appt)
            const ghlNoteId = await createGhlAppointmentNote(ghlContactId, noteBody)

            if (!ghlNoteId) {
                failed.push({ appointmentId: appt.AppointmentId, error: 'GHL note creation returned no ID' })
                continue
            }

            history[appt.AppointmentId] = ghlNoteId
            succeeded.push({ appointmentId: appt.AppointmentId, ghlNoteId })

        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)
            failed.push({ appointmentId: appt.AppointmentId, error: message })
        }
    }

    saveHistory(history)

    const created = succeeded.filter(x => !x.skipped).length
    const skipped = succeeded.filter(x => x.skipped).length

    return {
        ok: failed.length === 0,
        sourceCount: appointments.length,
        createdCount: created,
        skippedCount: skipped,
        failedCount:  failed.length,
        syncedPreview: succeeded.slice(0, 5),
        errors: failed.slice(0, 10),
        message:
            failed.length === 0
                ? `All ${appointments.length} processed: ${created} notes created, ${skipped} already existed`
                : `Created ${created}, skipped ${skipped}, failed ${failed.length}`,
    }
}

// Single customer appointments sync

export async function syncCustomerAppointments(customerId: string, ghlContactId: string) {
    const appointments = await fetchCustomerAppointments(customerId)

    if (!appointments.length) {
        return { ok: true, sourceCount: 0, message: 'No appointments for this customer' }
    }

    const history = loadHistory()
    const results: { appointmentId: string; ghlNoteId?: string; skipped?: boolean; error?: string }[] = []

    for (const appt of appointments) {
        if (history[appt.AppointmentId]) {
            results.push({ appointmentId: appt.AppointmentId, ghlNoteId: history[appt.AppointmentId], skipped: true })
            continue
        }

        const noteBody  = formatAppointmentNote(appt)
        const ghlNoteId = await createGhlAppointmentNote(ghlContactId, noteBody)

        if (ghlNoteId) {
            history[appt.AppointmentId] = ghlNoteId
            results.push({ appointmentId: appt.AppointmentId, ghlNoteId })
        } else {
            results.push({ appointmentId: appt.AppointmentId, error: 'GHL note creation failed' })
        }
    }

    saveHistory(history)

    return { ok: true, sourceCount: appointments.length, results }
}
