const express = require('express');
const axios = require("axios")
const cors = require('cors')
const bodyParser = require('body-parser')
const gateway = express()
const morgan = require('morgan')
const parse = require('date-fns/parse')
const isAfter = require('date-fns/isAfter')
const isBefore = require('date-fns/isBefore')
require('dotenv').config()

const api = axios.create()

api.interceptors.request.use(req => {
    console.info("AXIOS", req.method, req.url);
    return req;
})

api.interceptors.response.use(res => {
    console.info("AXIOS", res.status, res.config.url);
    return res;
})



morgan.token('body', (req, res) => JSON.stringify(req.body));

gateway.use(bodyParser.json())
gateway.use(morgan(':method :url :status :body :user-agent :remote-addr - :response-time ms'))
gateway.use(cors({credentials: true, origin: true}))

const URL = process.env.URL
const PARKING_POINT_ID = process.env.PARKING_POINT_ID
const RESERVATION_ID = process.env.RESERVATION_ID

const getHeaders = token => ({
    Cookie: token,
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; HTC One X10 Build/MRA58K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/61.0.3163.98 Mobile Safari/537.36'
})

async function post(data, headers) {
    try {
        const resp = await api.post(`${URL}/timerapi/reservations/${RESERVATION_ID}/timers`, data, {headers})
        console.log(resp.data)
    } catch(e) { console.log("WHOOPS", e)}
}

async function get(token) {
    try {
        const headers = getHeaders(token)
        const plate = await api.get(`${URL}/reservationapi/reservations/${RESERVATION_ID}/plate`, {headers})
        let reservations = await api.get(`${URL}/timerapi/reservations/${RESERVATION_ID}/timers`, {headers})
        const status = await api.get(`${URL}/timerapi/reservations/${RESERVATION_ID}/timers/state`, {headers})
        const temper = await api.get(`${URL}/timerapi/reservations/${RESERVATION_ID}/timers/configuration`, {headers})


        const { licensePlate } = plate.data
        const { state } = status.data
        const { temperature } = temper.data

        const [past, active] = getTimers(reservations)
        cleanTimers(past, token)
        return { licensePlate, state, reservations: active, temperature }
    } catch(e) { console.log("WHAAT", e)}
}

/**
 * Get timers as [pastTimers, activeTimers]
 * @param {*} token
 */
function getTimers(timers) {
    try {
        const past = timers.data.filter(({dateEnd, timeEnd}) => {
            const timerDate = parse(`${dateEnd} ${timeEnd}`, 'dd.MM.yyyy HH:mm', new Date())
            return isAfter(new Date(), timerDate)
        })
        const active = timers.data.filter(({dateEnd, timeEnd}) => {
            const timerDate = parse(`${dateEnd} ${timeEnd}`, 'dd.MM.yyyy HH:mm', new Date())
            return isBefore(new Date(), timerDate)
        })
        return [past, active]
    } catch(e) {
        console.log("WHOOPS", e)
        return [[], []]
    }
}

function cleanTimers(timersToDelete, token) {
    if (!timersToDelete || !token) return
    const headers = getHeaders(token)
    timersToDelete.forEach(({timerId}) => {
        try {
            api.delete(`${URL}/timerapi/reservations/${RESERVATION_ID}/timers/${timerId}`, {headers})
        } catch(e) { console.log("WHOOPS when deleting a timer", e)}
    })
}


gateway
    .post('/timer', (req, res, next) => {
        const { endDate, endTime, duration, eco, token } = req.body
        const data = {
            dateEnd: endDate, timeEnd: endTime, duration, eco, parkingPointId: PARKING_POINT_ID, charging: 0, weekdayMask: 124
        }
        const headers = getHeaders(token)
        console.log("GOT", headers, data)
        post(data, headers)
        res.sendStatus(200)
    })
    .post('/details', async (req, res, next) => {
        const { token } = req.body
        if (!token) return res.sendStatus(400)
        const data = await get(token)
        res.status(200).send(data)
    })
    .get('/', (req, res, next) => res.status(200).send("This is not your tolppa"))
    .listen(process.env.PORT || 1337, function() {console.log(`Server listening on ${process.env.PORT || 1337}`)});