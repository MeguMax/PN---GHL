import axios from 'axios'
import { env } from '../../config/env.js'

export const patientNowClient = axios.create({
    baseURL: env.PATIENTNOW_BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
    auth: {
        username: env.PATIENTNOW_API_USERNAME,
        password: env.PATIENTNOW_API_PASSWORD,
    },
})

export function withApiKeyParams(params: Record<string, any> = {}) {
    return {
        params: {
            apikey: env.PATIENTNOW_API_KEY,
            ...params,
        },
    }
}