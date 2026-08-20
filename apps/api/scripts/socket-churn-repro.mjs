#!/usr/bin/env node
/**
 * Phase A repro for task #394 — reproduce the API suite's two failure
 * signatures ("Parse Error: Expected HTTP/, RTSP/ or ICE/" and a hung request)
 * outside vitest, with no database, no Prisma and no pino.
 *
 * It replays exactly what supertest@7.1.4 does for every `request(app)` call:
 *   http.createServer(handler).listen(0)  ->  one client request to
 *   127.0.0.1:<port>  ->  server.close()
 *
 * Usage:
 *   node scripts/socket-churn-repro.mjs [iterations] [concurrency]
 */
import http from 'node:http'
import { execFileSync } from 'node:child_process'

const iterations = Number(process.argv[2] ?? 3000)
const concurrency = Number(process.argv[3] ?? 1)

const failures = []
let completed = 0

function once() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, at: Date.now() }))
    })

    server.on('error', (err) => {
      failures.push({ iteration: completed, outcome: 'listen-error', code: err.code, message: err.message })
      resolve()
    })

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const started = Date.now()
      let localPort

      const finish = (outcome, detail) => {
        if (outcome !== 'ok') {
          failures.push({ iteration: completed, port, localPort, outcome, ...detail })
        }
        // supertest closes the server from the response callback
        if (server.listening) server.close(() => resolve())
        else resolve()
      }

      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/health', method: 'GET' },
        (res) => {
          res.resume()
          res.on('end', () => finish('ok'))
        }
      )

      req.on('socket', (socket) => {
        socket.on('connect', () => {
          localPort = socket.localPort
        })
      })

      req.on('error', (err) => {
        finish('error', {
          message: err.message,
          code: err.code,
          bytesParsed: err.bytesParsed,
          rawPacket: err.rawPacket ? err.rawPacket.toString('latin1').slice(0, 300) : undefined,
        })
      })

      // The suite's failing signature is a 30s vitest timeout; 10s is plenty
      // to distinguish "stalled" from "slow" on loopback.
      const timer = setTimeout(() => {
        req.destroy()
        finish('timeout', { elapsedMs: Date.now() - started })
      }, 10_000)
      timer.unref()

      req.end()
    })
  })
}

function timeWaitCount() {
  try {
    return execFileSync('/bin/sh', [
      '-c',
      'netstat -an -p tcp | grep -c TIME_WAIT',
    ])
      .toString()
      .trim()
  } catch {
    return 'n/a'
  }
}

const startedAt = Date.now()
console.log(
  `[churn] iterations=${iterations} concurrency=${concurrency} node=${process.version} TIME_WAIT@start=${timeWaitCount()}`
)

async function worker(share) {
  for (let i = 0; i < share; i++) {
    await once()
    completed++
    if (completed % 500 === 0) {
      console.log(
        `[churn] ${completed}/${iterations} failures=${failures.length} TIME_WAIT=${timeWaitCount()} elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s`
      )
    }
  }
}

await Promise.all(
  Array.from({ length: concurrency }, () => worker(Math.ceil(iterations / concurrency)))
)

console.log(
  `[churn] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${failures.length} failure(s) out of ${completed}; TIME_WAIT@end=${timeWaitCount()}`
)
for (const failure of failures) console.log('[churn] FAILURE', JSON.stringify(failure))
process.exit(failures.length > 0 ? 1 : 0)
