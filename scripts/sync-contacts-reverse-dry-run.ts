import axios from 'axios'

async function main() {
    const res = await axios.post('http://localhost:3001/sync/contacts-reverse')
    console.log('SYNC RESPONSE:')
    console.dir(res.data, { depth: null })
}

main().catch((err) => {
    console.error('SYNC ERROR:')
    console.error(err?.response?.data || err)
    process.exit(1)
})