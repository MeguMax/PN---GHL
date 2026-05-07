import axios from 'axios'
import { env } from '../../config/env.js'

export const ghlClient = axios.create({
    baseURL: env.GHL_BASE_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${env.GHL_API_TOKEN}`,
        'Version': '2021-07-28',
    },
})