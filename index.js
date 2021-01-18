const express = require('express')
const axios = require('axios')
const cors = require('cors')
const bodyParser = require('body-parser')
const gateway = express()
const morgan = require('morgan')
const parse = require('date-fns/parse')
const isAfter = require('date-fns/isAfter')
const isBefore = require('date-fns/isBefore')
require('dotenv').config()

const router = express.Router()
const api = axios.create()

api.interceptors.request.use((req) => {
  console.info('AXIOS', req.method, req.url)
  return req
})

api.interceptors.response.use((res) => {
  console.info('AXIOS', res.status, res.config.url)
  return res
})

morgan.token('body', (req, res) => JSON.stringify(req.body))

gateway.use(bodyParser.json())
gateway.use(
  morgan(
    ':method :url :status :body :user-agent :remote-addr - :response-time ms',
  ),
)
gateway.use(cors({ credentials: true, origin: true }))

const URL = process.env.URL

const getHeaders = (token) => ({
  Cookie: token,
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 6.0; HTC One X10 Build/MRA58K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/61.0.3163.98 Mobile Safari/537.36',
})

async function getConfig(token) {
  const headers = getHeaders(token)
  try {
    const resp = await api.get(`${URL}/reservationapi/reservations`, {
      headers,
    })
    if (!resp.data.length) return null
    const { id: reservationId, parkingPointId } = resp.data[0]
    return { reservationId, parkingPointId }
  } catch (e) {
    console.error(
      'WHOOPS',
      e.request.res.statusCode,
      e.request.res.data,
    )
    return [e.request.res.statusCode, e.request.res.data]
  }
}

async function post(data, headers, reservationId) {
  try {
    return await api.post(
      `${URL}/timerapi/reservations/${reservationId}/timers`,
      data,
      { headers },
    )
  } catch (e) {
    console.error(
      'WHOOPS',
      e.request.res.statusCode,
      e.request.res.data,
    )
    return [e.request.res.statusCode, e.request.res.data]
  }
}

async function get(token, reservationId) {
  try {
    const headers = getHeaders(token)
    const plate = await api.get(
      `${URL}/reservationapi/reservations/${reservationId}/plate`,
      { headers },
    )
    let reservations = await api.get(
      `${URL}/timerapi/reservations/${reservationId}/timers`,
      { headers },
    )
    const status = await api.get(
      `${URL}/timerapi/reservations/${reservationId}/timers/state`,
      { headers },
    )
    const temper = await api.get(
      `${URL}/timerapi/reservations/${reservationId}/timers/configuration`,
      { headers },
    )

    const { licensePlate } = plate.data
    const { state, consumption } = status.data
    const { temperature } = temper.data

    const [past, active] = getTimers(reservations)
    cleanTimers(past, token, reservationId)
    return {
      licensePlate,
      state,
      reservations: active,
      temperature,
      consumption,
    }
  } catch (e) {
    console.error(
      'WHAAT',
      e.request.res.statusCode,
      e.request.res.data,
    )
    return [e.request.res.statusCode, e.request.res.data]
  }
}

async function getAllTimers(token, reservationId) {
  try {
    const headers = getHeaders(token)
    return await api.get(
      `${URL}/timerapi/reservations/${reservationId}/timers`,
      { headers },
    )
  } catch (e) {
    console.error(
      'WHAAT',
      e.request.res.statusCode,
      e.request.res.data,
    )
    return [e.request.res.statusCode, e.request.res.data]
  }
}

/**
 * Get timers as [pastTimers, activeTimers]
 * @param {*} token
 */
function getTimers(timers) {
  try {
    const past = timers.data.filter(({ dateEnd, timeEnd }) => {
      const timerDate = parse(
        `${dateEnd} ${timeEnd}`,
        'dd.MM.yyyy HH:mm',
        new Date(),
      )
      return isAfter(new Date(), timerDate)
    })
    const active = timers.data.filter(({ dateEnd, timeEnd }) => {
      const timerDate = parse(
        `${dateEnd} ${timeEnd}`,
        'dd.MM.yyyy HH:mm',
        new Date(),
      )
      return isBefore(new Date(), timerDate)
    })
    return [past, active]
  } catch (e) {
    console.error('WHOOPS', e)
    return [[], []]
  }
}

async function cleanTimers(timersToDelete, token, reservationId) {
  if (!token) return false
  const headers = getHeaders(token)
  let success = true
  timersToDelete.forEach(async ({ timerId }) => {
    try {
      await api.delete(
        `${URL}/timerapi/reservations/${reservationId}/timers/${timerId}`,
        { headers },
      )
    } catch (e) {
      console.error('WHOOPS when deleting a timer', e)
      success = false
    }
  })
  return success
}

router
  .use(async (req, res, next) => {
    const { token } = req.body
    if (!token) return res.sendStatus(400)
    const apiConf = await getConfig(token)
    if (Array.isArray(apiConf))
      return res.status(apiConf[0]).send(apiConf[1])
    req.apiConf = apiConf
    next()
  })
  .post('/timer', async (req, res, next) => {
    const { endDate, endTime, duration, eco, token } = req.body
    const { parkingPointId, reservationId } = req.apiConf
    const data = {
      dateEnd: endDate,
      timeEnd: endTime,
      duration,
      eco,
      parkingPointId,
      charging: 0,
      weekdayMask: 124,
    }
    const headers = getHeaders(token)
    console.log('GOT', headers, data)
    const resp = await post(data, headers, reservationId)
    if (Array.isArray(resp)) res.status(resp[0]).send(resp[1])
    else res.status(200).send(resp.data)
  })
  .post('/details', async (req, res, next) => {
    const { reservationId } = req.apiConf
    const { token } = req.body

    const data = await get(token, reservationId)
    if (Array.isArray(data)) res.status(data[0]).send(data[1])
    else res.status(200).send(data)
  })
  .delete('/timer', async (req, res, next) => {
    const { reservationId } = req.apiConf
    const { token } = req.body
    const allTimers = await getAllTimers(token, reservationId)
    if (Array.isArray(allTimers))
      return res.status(allTimers[0]).send(allTimers[1])
    const success = await cleanTimers(
      allTimers.data,
      token,
      reservationId,
    )
    if (!success) res.sendStatus(400)
    else res.sendStatus(200)
  })
  .get('/', (req, res, next) =>
    res.status(200).send('This is not your tolppa'),
  )

gateway.use(router).listen(process.env.PORT || 1337, function () {
  console.log(`Server listening on ${process.env.PORT || 1337}`)
})
