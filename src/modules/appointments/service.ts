import { patientNowClient, withApiKeyParams } from '../../integrations/patientnow/client.js'
import { ghlClient } from '../../integrations/ghl/client.js'
import { env } from '../../config/env.js'
import { fetchPatientNowContacts } from '../contacts/service.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getSyncSince, saveSyncTimestamp } from '../../lib/sync-state.js'
import { fetchGhlAppointmentsForContact } from '../../integrations/ghl/appointments.js'

// Sync history

const HISTORY_DIR = join(process.cwd(), 'data')
const HISTORY_FILE = join(HISTORY_DIR, 'appointments-sync-history.json')
const GHL_SNAPSHOT_FILE = join(HISTORY_DIR, 'ghl-appointments-snapshot.json')

function loadSyncHistory(): AppointmentSyncHistory {
    if (!existsSync(HISTORY_FILE)) return {}
    try {
        const raw = readFileSync(HISTORY_FILE, 'utf-8')
        const parsed = JSON.parse(raw)

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const migrated: AppointmentSyncHistory = {}

            for (const [appointmentId, value] of Object.entries(parsed)) {
                if (typeof value === 'string') {
                    migrated[appointmentId] = {
                        ghlAppointmentId: value,
                        lastSyncedAt: new Date().toISOString(),
                        lastSource: 'patientnow',
                    }
                } else if (value && typeof value === 'object') {
                    const v = value as any
                    if (typeof v.ghlAppointmentId === 'string') {
                        migrated[appointmentId] = {
                            ghlAppointmentId: v.ghlAppointmentId,
                            patientNowCustomerId: typeof v.patientNowCustomerId === 'string'
                                ? v.patientNowCustomerId
                                : undefined,
                            startTime: typeof v.startTime === 'string'
                                ? v.startTime
                                : undefined,
                            endTime: typeof v.endTime === 'string'
                                ? v.endTime
                                : undefined,
                            title: typeof v.title === 'string'
                                ? v.title
                                : undefined,
                            lastSyncedAt: typeof v.lastSyncedAt === 'string'
                                ? v.lastSyncedAt
                                : new Date().toISOString(),
                            lastSource: v.lastSource === 'ghl' ? 'ghl' : 'patientnow',
                        }
                    }
                }
            }

            return migrated
        }

        return {}
    } catch {
        return {}
    }
}

type AppointmentSyncRecord = {
    ghlAppointmentId: string
    patientNowCustomerId?: string
    startTime?: string
    endTime?: string
    title?: string
    lastSyncedAt: string
    lastSource: 'patientnow' | 'ghl'
}

type AppointmentSyncHistory = Record<string, AppointmentSyncRecord>

function saveSyncHistory(history: AppointmentSyncHistory): void {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true })
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
}

function findPatientNowAppointmentIdByGhlId(
    history: AppointmentSyncHistory,
    ghlAppointmentId: string,
): { patientNowAppointmentId: string; record: AppointmentSyncRecord } | null {
    for (const [patientNowAppointmentId, record] of Object.entries(history)) {
        if (record.ghlAppointmentId === ghlAppointmentId) {
            return { patientNowAppointmentId, record }
        }
    }
    return null
}

function toTimestamp(value?: string): number | null {
    if (!value) return null

    const normalized = value.includes('T')
        ? value
        : value.replace(' ', 'T')

    const date = new Date(normalized)
    const ts = date.getTime()

    return Number.isNaN(ts) ? null : ts
}

function isGhlNewerThanHistory(ghlUpdatedAt?: string, lastSyncedAt?: string): boolean {
    const ghlTs = toTimestamp(ghlUpdatedAt)
    const historyTs = toTimestamp(lastSyncedAt)

    if (ghlTs === null) return false
    if (historyTs === null) return true

    return ghlTs > historyTs
}

function normalizeDateTimeForCompare(value?: string): string {
    return String(value ?? '')
        .trim()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '')
        .replace(/Z$/, '')
}

function isSameDateTime(a?: string, b?: string): boolean {
    return normalizeDateTimeForCompare(a) === normalizeDateTimeForCompare(b)
}

// Types

export type PatientNowAppointment = {
    AppointmentId: string
    CompanyId?: string
    CustomerId: string
    EmployeeId?: string
    ServiceId?: string
    Customer?: string
    Employee?: string
    Service?: string
    ServiceName?: string
    ProviderName?: string
    ApptType?: string
    StartDate: string
    EndDate?: string
    Init?: number
    Delay?: number
    Complete?: number
    Status?: string
    Notes?: string
    BookedOnline?: boolean
}

// PatientNow

export async function fetchPatientNowAppointments(params: Record<string, any> = {}) {
    const res = await patientNowClient.get('/api/v1/appointments', withApiKeyParams(params))
    return res.data
}

async function fetchPatientNowAppointmentsByCustomerId(customerId: string): Promise<PatientNowAppointment[]> {
    const res = await patientNowClient.get(
        '/api/v1/appointments',
        withApiKeyParams({
            CustomerId: customerId,
            StartDate: '2020-01-01',
            EndDate: '2030-12-31',
            Rows: 200,
        }),
    )

    return Array.isArray(res.data) ? res.data : []
}

async function fetchPatientNowAppointmentById(id: string): Promise<PatientNowAppointment | null> {
    try {
        const res = await patientNowClient.get(`/api/v1/appointments/${id}`, withApiKeyParams())
        return res.data as PatientNowAppointment
    } catch {
        return null
    }
}

async function updatePatientNowAppointment(
    appointmentId: string,
    baseAppointment: PatientNowAppointment,
    patch: {
        StartDate?: string
        EndDate?: string
        Status?: string
    },
) {
    const body = {
        ...baseAppointment,
        ...patch,
        AppointmentId: appointmentId,
    }

    console.log('PatientNow update attempt', {
        url: '/api/v1/appointments',
        body,
    })

    const res = await patientNowClient.post(
        '/api/v1/appointments',
        body,
        withApiKeyParams(),
    )

    return res.data
}

async function createPatientNowAppointment(
    baseAppointment: PatientNowAppointment,
    patch: {
        StartDate?: string
        EndDate?: string
        Status?: string
    },
): Promise<PatientNowAppointment | null> {
    const body = {
        ...baseAppointment,
        ...patch,
        AppointmentId: undefined,
    }

    console.log('PatientNow create attempt (move replacement)', {
        url: '/api/v1/appointments',
        body,
    })

    const res = await patientNowClient.post(
        '/api/v1/appointments',
        body,
        withApiKeyParams(),
    )

    console.log('PatientNow create response (raw)', {
        status: res.status,
        data: res.data,
    })

    let createdId: string | null = null
    const raw = res.data

    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed.id === 'string') {
                createdId = parsed.id
            }
        } catch {
            createdId = null
        }
    } else if (raw && typeof raw === 'object' && typeof raw.id === 'string') {
        createdId = raw.id
    }

    if (!createdId) {
        return null
    }

    const createdAppointment = await fetchPatientNowAppointmentById(createdId)

    console.log('PatientNow create verification', {
        createdId,
        createdAppointment,
    })

    return createdAppointment
}

// GHL helpers

async function findGhlContactByCustomerId(_customerId: string, email?: string): Promise<string | null> {
    if (!email) return null

    try {
        const res = await ghlClient.get('/contacts/', {
            params: {
                locationId: env.GHL_LOCATION_ID,
                limit: 100,
                query: email,
            },
        })

        const contacts = res.data?.contacts ?? []

        const exactByEmail = contacts.find(
            (c: any) => String(c.email ?? '').toLowerCase() === String(email).toLowerCase(),
        )

        return exactByEmail?.id ?? null
    } catch {
        return null
    }
}

// Mapping

function normalizeText(value?: string): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
}

function isSameService(patientNowAppointment: PatientNowAppointment, ghlTitle?: string): boolean {
    const pnService = normalizeText(
        patientNowAppointment.Service ||
        patientNowAppointment.ServiceName ||
        ''
    )

    const ghlService = normalizeText(ghlTitle)

    if (!pnService || !ghlService) return false

    return pnService === ghlService
}

function resolveAppointmentStatus(appointment: PatientNowAppointment): string {
    if (appointment.Status?.toLowerCase() === 'cancelled') return 'cancelled'
    if (appointment.ApptType === 'C') return 'cancelled'
    if (appointment.ApptType === 'N') return 'no_show'
    if (appointment.Complete === 1) return 'showed'
    return 'confirmed'
}

function buildAppointmentNotes(appointment: PatientNowAppointment): string {
    const serviceName = appointment.Service || appointment.ServiceName || ''
    const providerName = appointment.Employee || appointment.ProviderName || ''
    return [
        serviceName ? `Service: ${serviceName}` : '',
        providerName ? `Provider: ${providerName}` : '',
        appointment.Notes ? `Notes: ${appointment.Notes}` : '',
        `PatientNow ID: ${appointment.AppointmentId}`,
        `PatientNow CustomerId: ${appointment.CustomerId}`,
    ].filter(Boolean).join('\n')
}

function mapAppointmentToGhlEvent(appointment: PatientNowAppointment, contactId: string) {
    const start = new Date(appointment.StartDate)
    const durationMinutes = appointment.Init && appointment.Init > 0 ? appointment.Init : 60
    const end = appointment.EndDate
        ? new Date(appointment.EndDate)
        : new Date(start.getTime() + durationMinutes * 60 * 1000)

    const serviceName = appointment.Service || appointment.ServiceName || 'PatientNow Appointment'

    return {
        calendarId: env.GHL_CALENDAR_ID,
        locationId: env.GHL_LOCATION_ID,
        contactId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        title: serviceName,
        appointmentStatus: resolveAppointmentStatus(appointment),
        notes: buildAppointmentNotes(appointment),
    }
}

// GHL: past appointment → Contact Note

async function createGhlContactNote(
    appointment: PatientNowAppointment,
    contactId: string,
): Promise<string> {
    const serviceName = appointment.Service || appointment.ServiceName || 'Appointment'
    const date = new Date(appointment.StartDate).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
    const body = `[Past Appointment] ${serviceName} — ${date}\n${buildAppointmentNotes(appointment)}`
    const res = await ghlClient.post(`/contacts/${contactId}/notes`, {
        body,
        userId: env.GHL_LOCATION_ID,
    })
    return res.data?.id ?? res.data?.note?.id ?? 'note-created'
}

// GHL: future appointment Calendar

async function createGhlCalendarEvent(
    appointment: PatientNowAppointment,
    contactId: string,
): Promise<{ id: string; type: 'calendar' | 'note' }> {
    try {
        const payload = mapAppointmentToGhlEvent(appointment, contactId)

        console.log('GHL appointment payload', {
            appointmentId: appointment.AppointmentId,
            originalStartDate: appointment.StartDate,
            originalEndDate: appointment.EndDate,
            payload,
        })

        const res = await ghlClient.post('/calendars/events/appointments', payload)
        return { id: res.data?.id, type: 'calendar' }
    } catch (err: any) {
        const status = err?.response?.status
        const data = err?.response?.data ?? null
        const msg = String(data?.message ?? err?.message ?? '')

        console.error('GHL appointment create failed', {
            appointmentId: appointment.AppointmentId,
            customerId: appointment.CustomerId,
            contactId,
            startDate: appointment.StartDate,
            status,
            message: msg,
            data,
        })

        const normalizedMsg = msg.toLowerCase()
        const isSlotError =
            status === 400 &&
            (
                normalizedMsg.includes('slot') ||
                normalizedMsg.includes('available') ||
                normalizedMsg.includes('inactive') ||
                normalizedMsg.includes('resource')
            )

        if (isSlotError) {
            const noteId = await createGhlContactNote(appointment, contactId)
            return { id: noteId, type: 'note' }
        }

        throw err
    }
}

// GHL: update existing calendar appointment

async function updateGhlCalendarEvent(
    ghlAppointmentId: string,
    appointment: PatientNowAppointment,
    contactId: string,
): Promise<{ success: boolean; notFound?: boolean }> {
    const payload = mapAppointmentToGhlEvent(appointment, contactId)

    console.log('GHL appointment update payload', {
        patientNowAppointmentId: appointment.AppointmentId,
        ghlAppointmentId,
        originalStartDate: appointment.StartDate,
        originalEndDate: appointment.EndDate,
        payload,
    })

    try {
        await ghlClient.put(`/calendars/events/appointments/${ghlAppointmentId}`, payload)
        return { success: true }
    } catch (err: any) {
        const status = err?.response?.status
        const message = String(err?.response?.data?.message ?? err?.message ?? '')

        console.error('GHL appointment update failed', {
            patientNowAppointmentId: appointment.AppointmentId,
            ghlAppointmentId,
            status,
            message,
        })

        const normalizedMessage = message.toLowerCase()

        const isInvalidEventId =
            status === 404 ||
            (status === 400 && (
                normalizedMessage.includes('event id is invalid') ||
                normalizedMessage.includes('valid calendar event id')
            ))

        if (isInvalidEventId) {
            return { success: false, notFound: true }
        }

        throw err
    }
}

async function deleteGhlCalendarEvent(
    ghlAppointmentId: string,
): Promise<{ success: boolean; notFound?: boolean }> {
    console.log('GHL appointment delete attempt', {
        ghlAppointmentId,
        url: `/calendars/events/appointments/${ghlAppointmentId}`,
    })

    try {
        await ghlClient.delete(`/calendars/events/appointments/${ghlAppointmentId}`)
        return { success: true }
    } catch (err: any) {
        const status = err?.response?.status
        const message = String(err?.response?.data?.message ?? err?.message ?? '')

        console.error('GHL appointment delete failed', {
            ghlAppointmentId,
            status,
            message,
        })

        const normalizedMessage = message.toLowerCase()

        const isInvalidEventId =
            status === 404 ||
            (status === 400 && (
                normalizedMessage.includes('event id is invalid') ||
                normalizedMessage.includes('valid calendar event id')
            ))

        if (isInvalidEventId) {
            return { success: false, notFound: true }
        }

        throw err
    }
}

async function cancelGhlCalendarEvent(
    ghlAppointmentId: string,
    patientNowAppointmentId: string,
    patientNowCustomerId: string,
): Promise<{ success: boolean; notFound?: boolean }> {
    const payload = {
        calendarId: env.GHL_CALENDAR_ID,
        locationId: env.GHL_LOCATION_ID,
        appointmentStatus: 'cancelled',
        title: 'Cancelled in PatientNow',
        notes: [
            'Deleted in PatientNow',
            `PatientNow ID: ${patientNowAppointmentId}`,
            `PatientNow CustomerId: ${patientNowCustomerId}`,
        ].join('\n'),
    }

    console.log('GHL appointment cancel payload', {
        ghlAppointmentId,
        patientNowAppointmentId,
        patientNowCustomerId,
        payload,
    })

    try {
        await ghlClient.put(`/calendars/events/appointments/${ghlAppointmentId}`, payload)
        return { success: true }
    } catch (err: any) {
        const status = err?.response?.status
        const message = String(err?.response?.data?.message ?? err?.message ?? '')

        console.error('GHL appointment cancel failed', {
            ghlAppointmentId,
            status,
            message,
        })

        const normalizedMessage = message.toLowerCase()

        const isInvalidEventId =
            status === 404 ||
            (status === 400 && (
                normalizedMessage.includes('event id is invalid') ||
                normalizedMessage.includes('valid calendar event id')
            ))

        if (isInvalidEventId) {
            return { success: false, notFound: true }
        }

        throw err
    }
}

async function createPatientNowAppointmentFromGhl(item: {
    patientNowCustomerId: string
    startTime: string
    endTime?: string
    status?: string
    title?: string
}): Promise<PatientNowAppointment | null> {
    const customerAppointments = await fetchPatientNowAppointmentsByCustomerId(item.patientNowCustomerId)
    const reference = customerAppointments[0]

    if (!reference) {
        return null
    }

    const durationMinutes = (() => {
        const start = toTimestamp(item.startTime)
        const end = toTimestamp(item.endTime)
        if (start !== null && end !== null && end > start) {
            return Math.round((end - start) / 60000)
        }
        return reference.Init && reference.Init > 0 ? reference.Init : 30
    })()

    const patch: {
        StartDate?: string
        EndDate?: string
        Status?: string
    } = {
        StartDate: item.startTime,
        EndDate: item.endTime,
        Status: item.status || 'confirmed',
    }

    const baseAppointment: PatientNowAppointment = {
        ...reference,
        AppointmentId: '',
        CustomerId: item.patientNowCustomerId,
        Service: item.title || reference.Service || reference.ServiceName,
        ServiceName: item.title || reference.ServiceName || reference.Service,
        Init: durationMinutes,
    }

    return await createPatientNowAppointment(baseAppointment, patch)
}

// Sync

export async function syncAppointments(dryRun = false) {
    const since = getSyncSince('appointments')
    const syncStartedAt = new Date().toISOString()

    const appointments: PatientNowAppointment[] = await fetchPatientNowAppointments({
        ModifiedOnStart: since,
        endDate: '2030-12-31',
    })

    if (!Array.isArray(appointments) || appointments.length === 0) {
        if (!dryRun) saveSyncTimestamp('appointments', syncStartedAt)
        return {
            ok: true,
            since,
            sourceCount: 0,
            message: 'No appointments found in PatientNow',
        }
    }

    if (dryRun) {
        const now = new Date()
        const future = appointments.filter(a => new Date(a.StartDate) >= now)
        const past = appointments.filter(a => new Date(a.StartDate) < now)
        return {
            ok: true,
            dryRun: true,
            sourceCount: appointments.length,
            futureCount: future.length,
            pastCount: past.length,
            dataPreview: appointments.slice(0, 3),
            message: `Dry run: ${future.length} future (→ Calendar), ${past.length} past (→ Contact Note)`,
        }
    }

    const syncHistory = loadSyncHistory()
    const customers = await fetchPatientNowContacts()
    const customerEmailMap = new Map(customers.map(c => [c.CustomerId, c.Email]))
    const now = new Date()

    const succeeded: {
        appointmentId: string
        ghlId?: string
        type: 'calendar' | 'note' | 'skipped'
    }[] = []
    const failed: { appointmentId: string; error: string }[] = []
    let historyUpdated = false
    let ghlDeletedCount = 0

    for (const appointment of appointments) {
        try {
            const email = customerEmailMap.get(appointment.CustomerId)
            const contactId = await findGhlContactByCustomerId(appointment.CustomerId, email ?? '')

            if (!contactId) {
                failed.push({
                    appointmentId: appointment.AppointmentId,
                    error: `No GHL contact for CustomerId: ${appointment.CustomerId} (email: ${email ?? 'unknown'})`,
                })
                continue
            }

            const isPast = new Date(appointment.StartDate) < now
            const existingRecord = syncHistory[appointment.AppointmentId]
            const existingGhlId = existingRecord?.ghlAppointmentId

            let ghlId: string | undefined
            let type: 'calendar' | 'note' | 'skipped'

            if (existingGhlId && !isPast) {
                const updateResult = await updateGhlCalendarEvent(existingGhlId, appointment, contactId)

                if (updateResult.success) {
                    ghlId = existingGhlId
                    type = 'calendar'

                    syncHistory[appointment.AppointmentId] = {
                        ghlAppointmentId: existingGhlId,
                        patientNowCustomerId: appointment.CustomerId,
                        startTime: appointment.StartDate,
                        endTime: appointment.EndDate,
                        title: appointment.Service || appointment.ServiceName || 'Appointment',
                        lastSyncedAt: new Date().toISOString(),
                        lastSource: 'patientnow',
                    }
                    historyUpdated = true
                } else if (updateResult.notFound) {
                    const result = await createGhlCalendarEvent(appointment, contactId)
                    ghlId = result.id
                    type = result.type

                    syncHistory[appointment.AppointmentId] = {
                        ghlAppointmentId: ghlId,
                        patientNowCustomerId: appointment.CustomerId,
                        startTime: appointment.StartDate,
                        endTime: appointment.EndDate,
                        title: appointment.Service || appointment.ServiceName || 'Appointment',
                        lastSyncedAt: new Date().toISOString(),
                        lastSource: 'patientnow',
                    }
                    historyUpdated = true
                } else {
                    throw new Error('Unknown updateGhlCalendarEvent result state')
                }
            } else if (existingGhlId && isPast) {
                ghlId = existingGhlId
                type = 'skipped'
            } else {
                if (isPast) {
                    ghlId = await createGhlContactNote(appointment, contactId)
                    type = 'note'
                } else {
                    const result = await createGhlCalendarEvent(appointment, contactId)
                    ghlId = result.id
                    type = result.type
                }

                if (ghlId) {
                    syncHistory[appointment.AppointmentId] = {
                        ghlAppointmentId: ghlId,
                        patientNowCustomerId: appointment.CustomerId,
                        startTime: appointment.StartDate,
                        endTime: appointment.EndDate,
                        title: appointment.Service || appointment.ServiceName || 'Appointment',
                        lastSyncedAt: new Date().toISOString(),
                        lastSource: 'patientnow',
                    }
                    historyUpdated = true
                }
            }

            succeeded.push({ appointmentId: appointment.AppointmentId, ghlId, type })
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)
            failed.push({ appointmentId: appointment.AppointmentId, error: message })
        }
    }

    const historyCustomerIds = Array.from(
        new Set(
            Object.values(syncHistory)
                .map((record) => record.patientNowCustomerId)
                .filter((value): value is string => Boolean(value)),
        ),
    )

    const currentAppointmentsByCustomerId = new Map<string, Set<string>>()

    for (const customerId of historyCustomerIds) {
        try {
            const customerAppointments = await fetchPatientNowAppointmentsByCustomerId(customerId)
            currentAppointmentsByCustomerId.set(
                customerId,
                new Set(
                    customerAppointments
                        .map((appointment) => appointment.AppointmentId)
                        .filter(Boolean),
                ),
            )
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)

            failed.push({
                appointmentId: `customer:${customerId}`,
                error: `Failed to load PatientNow appointments for delete sync: ${message}`,
            })
        }
    }

    for (const [patientNowAppointmentId, record] of Object.entries(syncHistory)) {
        if (!record?.ghlAppointmentId) continue
        if (!record?.patientNowCustomerId) continue

        const currentAppointmentIds = currentAppointmentsByCustomerId.get(record.patientNowCustomerId)
        if (!currentAppointmentIds) continue

        const stillExistsInPatientNow = currentAppointmentIds.has(patientNowAppointmentId)
        if (stillExistsInPatientNow) continue

        try {
            const cancelResult = await cancelGhlCalendarEvent(
                record.ghlAppointmentId,
                patientNowAppointmentId,
                record.patientNowCustomerId,
            )

            if (cancelResult.success || cancelResult.notFound) {
                console.log('GHL appointment cancelled from PatientNow removal', {
                    patientNowAppointmentId,
                    ghlAppointmentId: record.ghlAppointmentId,
                    patientNowCustomerId: record.patientNowCustomerId,
                })

                delete syncHistory[patientNowAppointmentId]
                historyUpdated = true
                ghlDeletedCount += 1
            }
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)

            failed.push({
                appointmentId: patientNowAppointmentId,
                error: `Failed to delete GHL appointment ${record.ghlAppointmentId}: ${message}`,
            })
        }
    }

    if (historyUpdated) saveSyncHistory(syncHistory)

    if (failed.length === 0 && !dryRun) {
        saveSyncTimestamp('appointments', syncStartedAt)
    }

    const calendarEventsCreated = succeeded.filter(x => x.type === 'calendar').length
    const contactNotesCreated = succeeded.filter(x => x.type === 'note').length
    const skippedCount = succeeded.filter(x => x.type === 'skipped').length

    return {
        ok: failed.length === 0,
        since,
        sourceCount: appointments.length,
        calendarEventsCreated,
        contactNotesCreated,
        skippedCount,
        ghlDeletedCount,
        failedCount: failed.length,
        syncedPreview: succeeded.slice(0, 5),
        errors: failed.slice(0, 10),
        message:
            failed.length === 0
                ? `All ${appointments.length} processed: ${calendarEventsCreated} calendar events, ${contactNotesCreated} contact notes, ${skippedCount} skipped, ${ghlDeletedCount} deleted in GHL`
                : `Calendar: ${calendarEventsCreated}, Notes: ${contactNotesCreated}, Skipped: ${skippedCount}, Deleted in GHL: ${ghlDeletedCount}, Failed: ${failed.length}`,
    }
}

type GhlAppointmentSnapshot = {
    appointmentId: string
    contactId: string
    patientNowCustomerId: string
    startTime: string
    endTime: string
    status: string
    title: string
    updatedAt: string
}

type GhlAppointmentChange = GhlAppointmentSnapshot & {
    patientNowAppointmentId?: string
}

function loadGhlSnapshot(): Record<string, GhlAppointmentSnapshot> {
    if (!existsSync(GHL_SNAPSHOT_FILE)) return {}
    try {
        return JSON.parse(readFileSync(GHL_SNAPSHOT_FILE, 'utf-8'))
    } catch {
        return {}
    }
}

function saveGhlSnapshot(snapshot: Record<string, GhlAppointmentSnapshot>): void {
    if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true })
    writeFileSync(GHL_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8')
}

function normalizeArray<T>(value: any): T[] {
    if (Array.isArray(value)) return value
    if (Array.isArray(value?.contacts)) return value.contacts
    if (Array.isArray(value?.data?.contacts)) return value.data.contacts
    if (Array.isArray(value?.appointments)) return value.appointments
    if (Array.isArray(value?.data?.appointments)) return value.data.appointments
    if (Array.isArray(value?.events)) return value.events
    if (Array.isArray(value?.data?.events)) return value.data.events
    return []
}

const PATIENTNOW_CUSTOMER_ID_FIELD_ID = 'nVXfFclA1GLobfAJnZcO'

function extractPatientNowCustomerId(contact: any): string {
    const fields = contact?.customFields ?? []

    const match = fields.find(
        (f: any) => f.id === PATIENTNOW_CUSTOMER_ID_FIELD_ID,
    )

    return String(match?.value ?? '').trim()
}

function extractPatientNowAppointmentIdFromNotes(raw: any): string | null {
    const notes: string = String(raw?.notes ?? raw?.description ?? '').trim()
    if (!notes) return null

    const lines = notes.split(/\r?\n/)
    for (const line of lines) {
        const match = line.match(/PatientNow ID:\s*(\S+)/i)
        if (match && match[1]) {
            return match[1].trim()
        }
    }

    return null
}

function normalizeGhlAppointment(
    raw: any,
    contactId: string,
    patientNowCustomerId: string,
): GhlAppointmentSnapshot | null {
    const appointmentId = String(raw?.id ?? raw?._id ?? raw?.appointmentId ?? '').trim()
    if (!appointmentId) return null

    console.log('normalizeGhlAppointment raw sample', {
        id: raw?.id,
        title: raw?.title,
        notes: raw?.notes,
        calendarName: raw?.calendarName,
        description: raw?.description,
    })

    return {
        appointmentId,
        contactId,
        patientNowCustomerId,
        startTime: String(raw?.startTime ?? raw?.start ?? raw?.start_time ?? ''),
        endTime: String(raw?.endTime ?? raw?.end ?? raw?.end_time ?? ''),
        status: String(raw?.appointmentStatus ?? raw?.status ?? '').trim(),
        title: String(raw?.title ?? raw?.calendarName ?? raw?.name ?? '').trim(),
        updatedAt: String(raw?.updatedAt ?? raw?.dateUpdated ?? raw?.lastUpdated ?? raw?.startTime ?? ''),
    }
}

async function fetchGhlContactsWithPatientNowId() {
    const res = await ghlClient.get('/contacts/', {
        params: {
            locationId: env.GHL_LOCATION_ID,
            limit: 100,
        },
    })

    const contacts = normalizeArray<any>(res.data)
    return contacts.filter((contact) => !!extractPatientNowCustomerId(contact))
}

export async function pollGhlAppointments(dryRun = false) {
    const contacts = await fetchGhlContactsWithPatientNowId()
    const previousSnapshot = loadGhlSnapshot()
    const nextSnapshot: Record<string, GhlAppointmentSnapshot> = {}

    const changed: GhlAppointmentSnapshot[] = []
    const unchanged: GhlAppointmentSnapshot[] = []
    const failed: { contactId: string; error: string }[] = []

    for (const contact of contacts) {
        const patientNowCustomerId = extractPatientNowCustomerId(contact)

        try {
            const raw = await fetchGhlAppointmentsForContact(contact.id)
            const appointments = normalizeArray<any>(raw)

            for (const item of appointments) {
                const normalized = normalizeGhlAppointment(
                    item,
                    contact.id,
                    patientNowCustomerId,
                )

                if (!normalized) continue

                nextSnapshot[normalized.appointmentId] = normalized

                const previous = previousSnapshot[normalized.appointmentId]
                if (!previous || JSON.stringify(previous) !== JSON.stringify(normalized)) {
                    changed.push(normalized)
                } else {
                    unchanged.push(normalized)
                }
            }
        } catch (err: any) {
            const message = err?.response?.data
                ? JSON.stringify(err.response.data)
                : err?.message ?? String(err)

            failed.push({
                contactId: contact.id,
                error: message,
            })
        }
    }

    const removed = Object.values(previousSnapshot).filter(
        (item) => !nextSnapshot[item.appointmentId],
    )

    if (!dryRun) {
        saveGhlSnapshot(nextSnapshot)
    }

    console.log('GHL poll result (reverse)', {
        dryRun,
        contactsScanned: contacts.length,
        changedCount: changed.length,
        removedCount: removed.length,
    })

    return {
        ok: failed.length === 0,
        dryRun,
        contactsScanned: contacts.length,
        changedCount: changed.length,
        removedCount: removed.length,
        unchangedCount: unchanged.length,
        failedCount: failed.length,
        changedPreview: changed.slice(0, 10),
        removedPreview: removed.slice(0, 10),
        errors: failed.slice(0, 10),
        snapshotFile: GHL_SNAPSHOT_FILE,
        message: dryRun
            ? 'Dry run: GHL appointments polled and compared, snapshot not saved'
            : 'GHL appointments polled and snapshot updated',
    }
}

async function deletePatientNowAppointment(appointmentId: string) {
    console.log('PatientNow delete attempt', {
        url: `/api/v1/appointments/${appointmentId}`,
    })

    const res = await patientNowClient.delete(
        `/api/v1/appointments/${appointmentId}`,
        withApiKeyParams(),
    )

    return res.data
}

async function applyGhlAppointmentChangesToPatientNow(
    changed: GhlAppointmentChange[],
    removed: GhlAppointmentChange[],
    dryRun: boolean,
) {
    console.log('applyGhlAppointmentChangesToPatientNow called', {
        dryRun,
        changedCount: changed.length,
        removedCount: removed.length,
    })

    const syncHistory = loadSyncHistory()
    const errors: any[] = []
    const candidatesForCreate: any[] = []
    const candidatesForUpdate: any[] = []
    const candidatesForDelete: any[] = []
    const skippedAsOlderOrSame: any[] = []

    for (const item of changed) {

        const isCancelledInGhl = String(item.status ?? '').trim().toLowerCase() === 'cancelled'

        if (isCancelledInGhl) {
            const link = findPatientNowAppointmentIdByGhlId(syncHistory, item.appointmentId)

            if (!link) {
                errors.push({
                    type: 'missingLinkInHistoryForCancelled',
                    ghlAppointmentId: item.appointmentId,
                    patientNowCustomerId: item.patientNowCustomerId,
                    title: item.title,
                    startTime: item.startTime,
                    status: item.status,
                })
                continue
            }

            const { patientNowAppointmentId, record } = link
            const shouldSyncToPatientNow = isGhlNewerThanHistory(item.updatedAt, record.lastSyncedAt)

            if (!shouldSyncToPatientNow) {
                skippedAsOlderOrSame.push({
                    patientNowAppointmentId,
                    ghlAppointmentId: item.appointmentId,
                    ghlUpdatedAt: item.updatedAt,
                    lastSyncedAt: record.lastSyncedAt,
                    lastSource: record.lastSource,
                    cancelled: true,
                })
                continue
            }

            candidatesForDelete.push({
                patientNowAppointmentId,
                ghlAppointmentId: item.appointmentId,
                patientNowCustomerId: item.patientNowCustomerId,
                startTime: item.startTime,
                endTime: item.endTime,
                status: item.status,
                title: item.title,
                ghlUpdatedAt: item.updatedAt,
                lastSyncedAt: record.lastSyncedAt,
                lastSource: record.lastSource,
                cancelled: true,
            })

            continue
        }

        const link = findPatientNowAppointmentIdByGhlId(syncHistory, item.appointmentId)

        if (!link) {
            if (!item.patientNowCustomerId) {
                errors.push({
                    type: 'missingPatientNowCustomerId',
                    ghlAppointmentId: item.appointmentId,
                    title: item.title,
                    startTime: item.startTime,
                    status: item.status,
                })
                continue
            }

            candidatesForCreate.push({
                ghlAppointmentId: item.appointmentId,
                patientNowCustomerId: item.patientNowCustomerId,
                startTime: item.startTime,
                endTime: item.endTime,
                status: item.status,
                title: item.title,
                ghlUpdatedAt: item.updatedAt,
            })
            continue
        }

        const { patientNowAppointmentId, record } = link
        const shouldSyncToPatientNow = isGhlNewerThanHistory(item.updatedAt, record.lastSyncedAt)

        if (!shouldSyncToPatientNow) {
            skippedAsOlderOrSame.push({
                patientNowAppointmentId,
                ghlAppointmentId: item.appointmentId,
                ghlUpdatedAt: item.updatedAt,
                lastSyncedAt: record.lastSyncedAt,
                lastSource: record.lastSource,
            })
            continue
        }

        candidatesForUpdate.push({
            patientNowAppointmentId,
            ghlAppointmentId: item.appointmentId,
            patientNowCustomerId: item.patientNowCustomerId,
            startTime: item.startTime,
            endTime: item.endTime,
            status: item.status,
            title: item.title,
            ghlUpdatedAt: item.updatedAt,
            lastSyncedAt: record.lastSyncedAt,
            lastSource: record.lastSource,
        })
    }

    for (const item of removed) {
        const link = findPatientNowAppointmentIdByGhlId(syncHistory, item.appointmentId)

        if (!link) {
            console.log('GHL removed appointment skipped: no link in history', {
                ghlAppointmentId: item.appointmentId,
                patientNowCustomerId: item.patientNowCustomerId,
                title: item.title,
                startTime: item.startTime,
                status: item.status,
            })
            continue
        }

        const { patientNowAppointmentId, record } = link
        const shouldSyncToPatientNow = isGhlNewerThanHistory(item.updatedAt, record.lastSyncedAt)

        if (!shouldSyncToPatientNow) {
            skippedAsOlderOrSame.push({
                patientNowAppointmentId,
                ghlAppointmentId: item.appointmentId,
                ghlUpdatedAt: item.updatedAt,
                lastSyncedAt: record.lastSyncedAt,
                lastSource: record.lastSource,
                removed: true,
            })
            continue
        }

        candidatesForDelete.push({
            patientNowAppointmentId,
            ghlAppointmentId: item.appointmentId,
            patientNowCustomerId: item.patientNowCustomerId,
            startTime: item.startTime,
            endTime: item.endTime,
            status: item.status,
            title: item.title,
            ghlUpdatedAt: item.updatedAt,
            lastSyncedAt: record.lastSyncedAt,
            lastSource: record.lastSource,
        })
    }

    console.log('GHL → PatientNow reverse candidates', {
        dryRun,
        createCandidatesCount: candidatesForCreate.length,
        updateCandidatesCount: candidatesForUpdate.length,
        deleteCandidatesCount: candidatesForDelete.length,
        skippedOlderOrSameCount: skippedAsOlderOrSame.length,
    })

    if (candidatesForCreate.length > 0) {
        console.log('GHL → PatientNow create candidates preview', candidatesForCreate.slice(0, 10))
    }

    if (candidatesForUpdate.length > 0) {
        console.log('GHL → PatientNow update candidates preview', candidatesForUpdate.slice(0, 10))
    }

    if (candidatesForDelete.length > 0) {
        console.log('GHL → PatientNow delete candidates preview', candidatesForDelete.slice(0, 10))
    }

    if (skippedAsOlderOrSame.length > 0) {
        console.log('GHL → PatientNow skipped (older/same) preview', skippedAsOlderOrSame.slice(0, 10))
    }

    let createdCount = 0
    let updatedCount = 0
    let deletedCount = 0

    if (!dryRun) {
        const syncHistory = loadSyncHistory()
        let historyUpdated = false

        for (const item of candidatesForCreate) {
            try {
                const createdAppointment = await createPatientNowAppointmentFromGhl(item)

                if (!createdAppointment) {
                    errors.push({
                        type: 'patientNowCreateFromGhlFailed',
                        ghlAppointmentId: item.ghlAppointmentId,
                        patientNowCustomerId: item.patientNowCustomerId,
                        startTime: item.startTime,
                        endTime: item.endTime,
                        title: item.title,
                        reason: 'No reference appointment or create returned null',
                    })
                    continue
                }

                syncHistory[createdAppointment.AppointmentId] = {
                    ghlAppointmentId: item.ghlAppointmentId,
                    patientNowCustomerId: item.patientNowCustomerId,
                    startTime: createdAppointment.StartDate,
                    endTime: createdAppointment.EndDate,
                    title: item.title,
                    lastSyncedAt: new Date().toISOString(),
                    lastSource: 'ghl',
                }

                historyUpdated = true
                createdCount += 1

                console.log('PatientNow appointment created from GHL', {
                    ghlAppointmentId: item.ghlAppointmentId,
                    patientNowAppointmentId: createdAppointment.AppointmentId,
                    patientNowCustomerId: item.patientNowCustomerId,
                    startDate: createdAppointment.StartDate,
                    endDate: createdAppointment.EndDate,
                    title: item.title,
                })
            } catch (err: any) {
                const message = err?.response?.data
                    ? JSON.stringify(err.response.data)
                    : err?.message ?? String(err)

                errors.push({
                    type: 'patientNowCreateFromGhlFailed',
                    ghlAppointmentId: item.ghlAppointmentId,
                    patientNowCustomerId: item.patientNowCustomerId,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    title: item.title,
                    message,
                })
            }
        }

        for (const item of candidatesForUpdate) {
            try {
                const base = await fetchPatientNowAppointmentById(item.patientNowAppointmentId)

                if (!base) {
                    errors.push({
                        type: 'patientNowAppointmentNotFound',
                        patientNowAppointmentId: item.patientNowAppointmentId,
                        ghlAppointmentId: item.ghlAppointmentId,
                    })
                    continue
                }

                const patch: {
                    StartDate?: string
                    EndDate?: string
                    Status?: string
                } = {}

                if (item.startTime) patch.StartDate = item.startTime
                if (item.endTime) patch.EndDate = item.endTime
                if (item.status) patch.Status = item.status

                let replacement: PatientNowAppointment | null = null

                try {
                    replacement = await createPatientNowAppointment(base, patch)
                } catch (err: any) {
                    const message = err?.response?.data
                        ? JSON.stringify(err.response.data)
                        : err?.message ?? String(err)

                    errors.push({
                        type: 'patientNowCreateReplacementFailed',
                        patientNowAppointmentId: item.patientNowAppointmentId,
                        ghlAppointmentId: item.ghlAppointmentId,
                        message,
                    })

                    continue
                }

                if (!replacement) {
                    errors.push({
                        type: 'patientNowReplacementCreateReturnedNull',
                        originalPatientNowAppointmentId: item.patientNowAppointmentId,
                        ghlAppointmentId: item.ghlAppointmentId,
                        requestedStartTime: item.startTime,
                        requestedEndTime: item.endTime,
                    })
                    continue
                }

                const didReplacementMatch =
                    isSameDateTime(replacement.StartDate, item.startTime) &&
                    (
                        !item.endTime ||
                        !replacement.EndDate ||
                        isSameDateTime(replacement.EndDate, item.endTime)
                    )

                if (!didReplacementMatch) {
                    errors.push({
                        type: 'patientNowReplacementHasWrongTime',
                        originalPatientNowAppointmentId: item.patientNowAppointmentId,
                        replacementAppointmentId: replacement.AppointmentId,
                        ghlAppointmentId: item.ghlAppointmentId,
                        requestedStartTime: item.startTime,
                        requestedEndTime: item.endTime,
                        actualStartDate: replacement.StartDate ?? null,
                        actualEndDate: replacement.EndDate ?? null,
                    })

                    continue
                }

                const replacementAppointment: PatientNowAppointment = replacement

                try {
                    await deletePatientNowAppointment(item.patientNowAppointmentId)
                } catch (err: any) {
                    const message = err?.response?.data
                        ? JSON.stringify(err.response.data)
                        : err?.message ?? String(err)

                    errors.push({
                        type: 'patientNowDeleteOriginalAfterMoveFailed',
                        originalPatientNowAppointmentId: item.patientNowAppointmentId,
                        replacementAppointmentId: replacementAppointment.AppointmentId,
                        ghlAppointmentId: item.ghlAppointmentId,
                        message,
                    })
                }

                updatedCount += 1

                const customerAppointments = await fetchPatientNowAppointmentsByCustomerId(
                    item.patientNowCustomerId,
                )

                const orphanAppointments = customerAppointments.filter((appt) => {
                    if (!appt?.AppointmentId) return false

                    if (appt.AppointmentId === replacementAppointment.AppointmentId) {
                        return false
                    }

                    if (String(appt.CustomerId ?? '') !== String(item.patientNowCustomerId ?? '')) {
                        return false
                    }

                    if (!isSameService(appt, item.title)) {
                        return false
                    }

                    if (!appt.StartDate) {
                        return false
                    }

                    if (String(appt.StartDate).trim() === String(item.startTime ?? '').trim()) {
                        return false
                    }

                    return true
                })

                for (const orphan of orphanAppointments) {
                    try {
                        await deletePatientNowAppointment(orphan.AppointmentId)

                        deletedCount += 1
                        delete syncHistory[orphan.AppointmentId]
                        historyUpdated = true

                        console.log('PatientNow orphan appointment deleted', {
                            deletedAppointmentId: orphan.AppointmentId,
                            keptAppointmentId: replacementAppointment.AppointmentId,
                            customerId: item.patientNowCustomerId,
                            service: orphan.Service || orphan.ServiceName || null,
                            startDate: orphan.StartDate,
                        })
                    } catch (err: any) {
                        const message = err?.response?.data
                            ? JSON.stringify(err.response.data)
                            : err?.message ?? String(err)

                        errors.push({
                            type: 'patientNowOrphanDeleteFailed',
                            patientNowAppointmentId: orphan.AppointmentId,
                            keptPatientNowAppointmentId: replacementAppointment.AppointmentId,
                            ghlAppointmentId: item.ghlAppointmentId,
                            message,
                        })
                    }
                }

                syncHistory[replacementAppointment.AppointmentId] = {
                    ghlAppointmentId: item.ghlAppointmentId,
                    patientNowCustomerId: item.patientNowCustomerId,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    title: item.title,
                    lastSyncedAt: new Date().toISOString(),
                    lastSource: 'ghl',
                }

                delete syncHistory[item.patientNowAppointmentId]

                historyUpdated = true
            } catch (err: any) {
                const message = err?.response?.data
                    ? JSON.stringify(err.response.data)
                    : err?.message ?? String(err)

                errors.push({
                    type: 'patientNowUpdateFailed',
                    patientNowAppointmentId: item.patientNowAppointmentId,
                    ghlAppointmentId: item.ghlAppointmentId,
                    message,
                })
            }
        }

        if (candidatesForDelete.length > 0) {
            for (const item of candidatesForDelete) {
                try {
                    await deletePatientNowAppointment(item.patientNowAppointmentId)

                    deletedCount += 1

                    delete syncHistory[item.patientNowAppointmentId]
                    historyUpdated = true
                } catch (err: any) {
                    const message = err?.response?.data
                        ? JSON.stringify(err.response.data)
                        : err?.message ?? String(err)

                    errors.push({
                        type: 'patientNowDeleteFailed',
                        patientNowAppointmentId: item.patientNowAppointmentId,
                        ghlAppointmentId: item.ghlAppointmentId,
                        message,
                    })
                }
            }
        }

        if (historyUpdated) {
            saveSyncHistory(syncHistory)
        }
    }

    return {
        createdCount,
        updatedCount,
        deletedCount,
        errors,
    }
}

export async function syncGhlAppointmentsReverse(dryRun = false) {
    const result = await pollGhlAppointments(dryRun)

    const changed: GhlAppointmentChange[] = (result.changedPreview as GhlAppointmentSnapshot[] | undefined) ?? []
    const removed: GhlAppointmentChange[] = (result.removedPreview as GhlAppointmentSnapshot[] | undefined) ?? []

    const applyResult = await applyGhlAppointmentChangesToPatientNow(
        changed,
        removed,
        dryRun,
    )

    return {
        ...result,
        patientNowCreatedCount: applyResult.createdCount,
        patientNowUpdatedCount: applyResult.updatedCount,
        patientNowDeletedCount: applyResult.deletedCount,
        patientNowErrors: applyResult.errors,
    }
}