import 'dotenv/config'

function required(key: string): string {
    const value = process.env[key]
    if (!value) throw new Error(`Missing required env var: ${key}`)
    return value
}

function optional(key: string, fallback = ''): string {
    return process.env[key] ?? fallback
}

export const env = {
    PORT: parseInt(process.env.PORT ?? '3001', 10),

    PATIENTNOW_BASE_URL: required('PATIENTNOW_BASE_URL'),
    PATIENTNOW_API_KEY: required('PATIENTNOW_API_KEY'),
    PATIENTNOW_API_USERNAME: optional('PATIENTNOW_API_USERNAME'),
    PATIENTNOW_API_PASSWORD: optional('PATIENTNOW_API_PASSWORD'),

    GHL_BASE_URL: optional('GHL_BASE_URL', 'https://services.leadconnectorhq.com'),
    GHL_API_TOKEN: required('GHL_API_TOKEN'),
    GHL_LOCATION_ID: required('GHL_LOCATION_ID'),
    GHL_CALENDAR_ID: required('GHL_CALENDAR_ID'),
    GHL_API_VERSION: optional('GHL_API_VERSION', '2021-07-28'),
}
