#!/usr/bin/env node
/**
 * Phase A repro for task #394 — reproduce the API suite's two failure
 * signatures ("Parse Error: Expected HTTP/, RTSP/ or ICE/" and a hung request)
 * outside vitest, with no database, no Prisma and no pino.
 *
 * Two independent modes:
 *
 *   --squat     Self-contained, deterministic demonstration of the bug's
 *               premise: a wildcard-bound `http.createServer().listen(P)`
 *               shares port P with a pre-existing loopback listener on
 *               127.0.0.1:P (a "port squatter"), so a client request to
 *               127.0.0.1:P can be routed to the squatter instead of the
 *               intended server. Exits non-zero if any expectation fails.
 *
 *   (default)   Churn loop: repeatedly bind an ephemeral server, make one
 *               request, close it — the same shape supertest@7.1.4 uses for
 *               every `request(app)` call, whose default is a WILDCARD bind
 *               (`http.createServer(handler).listen(0)`). Pass
 *               `--bind=loopback` to run the post-fix, loopback-scoped
 *               variant (`listen(0, '127.0.0.1')`) instead.
 *
 * Usage:
 *   node scripts/socket-churn-repro.mjs --squat
 *   node scripts/socket-churn-repro.mjs [iterations] [concurrency] [--bind=wildcard|loopback]
 */
import http from 'node:http'
import net from 'node:net'
import { execFileSync } from 'node:child_process'

const rawArgs = process.argv.slice(2)
const flags = rawArgs.filter((arg) => arg.startsWith('--'))
const positional = rawArgs.filter((arg) => !arg.startsWith('--'))

const squat = flags.includes('--squat')
const bindFlag = flags.find((arg) => arg.startsWith('--bind='))
const bindMode = bindFlag ? bindFlag.slice('--bind='.length) : 'wildcard'

if (!['wildcard', 'loopback'].includes(bindMode)) {
  console.error(`[churn] invalid --bind=${bindMode} (expected "wildcard" or "loopback")`)
  process.exit(2)
}

if (squat) {
  await runSquatDemo()
} else {
  await runChurnLoop()
}

async function runSquatDemo() {
  const banner = Buffer.from('SSH-2.0-OpenSSH_9.6p1\r\n', 'latin1')

  const squatter = net.createServer((socket) => {
    socket.write(banner)
  })
  await new Promise((resolve, reject) => {
    squatter.once('error', reject)
    squatter.listen(0, '127.0.0.1', resolve)
  })
  const port = squatter.address().port
  console.log(
    `[squat] squatter listening on 127.0.0.1:${port}, banner=${JSON.stringify(banner.toString('latin1'))}`
  )

  let ok = true

  // Expectation 1: a wildcard bind on the squatted port still succeeds.
  const server = http.createServer((_req, res) => res.end('ok'))
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, resolve)
    })
    console.log(
      `[squat] PASS wildcard listen(${port}) succeeded, address=${JSON.stringify(server.address())}`
    )
  } catch (err) {
    ok = false
    console.log(`[squat] FAIL wildcard listen(${port}) raised: ${err.code} ${err.message}`)
  }

  // Expectation 2: a client request to 127.0.0.1:<port> is routed to the
  // more-specific squatter, not the wildcard server, and fails to parse.
  await new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      ok = false
      res.resume()
      console.log(
        `[squat] FAIL client request unexpectedly got a valid HTTP response (status ${res.statusCode})`
      )
      resolve()
    })
    req.on('error', (err) => {
      const rawPacket = err.rawPacket ? err.rawPacket.toString('latin1') : undefined
      if (err.code === 'HPE_INVALID_CONSTANT' && rawPacket?.includes('SSH-2.0-OpenSSH')) {
        console.log(
          `[squat] PASS client request failed with ${err.code}, rawPacket=${JSON.stringify(rawPacket)}`
        )
      } else {
        ok = false
        console.log(
          `[squat] FAIL client request failed with unexpected error: code=${err.code} rawPacket=${JSON.stringify(rawPacket)}`
        )
      }
      resolve()
    })
  })

  await new Promise((resolve) => server.close(resolve))

  // Expectation 3: with the wildcard server gone, a loopback-scoped bind on
  // the same port is refused because the squatter still holds it.
  await new Promise((resolve) => {
    const loopbackServer = http.createServer()
    loopbackServer.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[squat] PASS loopback listen(${port}, '127.0.0.1') refused with EADDRINUSE`)
      } else {
        ok = false
        console.log(
          `[squat] FAIL loopback listen(${port}, '127.0.0.1') raised unexpected error: ${err.code}`
        )
      }
      resolve()
    })
    loopbackServer.once('listening', () => {
      ok = false
      console.log(`[squat] FAIL loopback listen(${port}, '127.0.0.1') unexpectedly succeeded`)
      loopbackServer.close(resolve)
    })
    loopbackServer.listen(port, '127.0.0.1')
  })

  squatter.close()

  console.log(`[squat] ${ok ? 'ALL EXPECTATIONS HELD' : 'FAILURE — see FAIL lines above'}`)
  process.exit(ok ? 0 : 1)
}

async function runChurnLoop() {
  const iterations = Number(positional[0] ?? 3000)
  const concurrency = Number(positional[1] ?? 1)

  const failures = []
  let completed = 0

  function once() {
    return new Promise((resolve) => {
      const server = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, at: Date.now() }))
      })

      server.on('error', (err) => {
        failures.push({
          iteration: completed,
          outcome: 'listen-error',
          code: err.code,
          message: err.message,
        })
        resolve()
      })

      const onListening = () => {
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
      }

      if (bindMode === 'loopback') server.listen(0, '127.0.0.1', onListening)
      else server.listen(0, onListening)
    })
  }

  function timeWaitCount() {
    try {
      return execFileSync('/bin/sh', ['-c', 'netstat -an -p tcp | grep -c TIME_WAIT'])
        .toString()
        .trim()
    } catch {
      return 'n/a'
    }
  }

  const startedAt = Date.now()
  console.log(
    `[churn] iterations=${iterations} concurrency=${concurrency} bind=${bindMode} node=${process.version} TIME_WAIT@start=${timeWaitCount()}`
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
    `[churn] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — bind=${bindMode} — ${failures.length} failure(s) out of ${completed}; TIME_WAIT@end=${timeWaitCount()}`
  )
  for (const failure of failures) console.log('[churn] FAILURE', JSON.stringify(failure))
  process.exit(failures.length > 0 ? 1 : 0)
}
