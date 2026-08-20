// Flake diagnostics for task #394 — completely inert unless API_TEST_DIAG=1.
//
// When enabled it records, as NDJSON under apps/api/.flake-diag/, the raw bytes
// of every HTTP client parse error, a per-request socket identity timeline, the
// listen/close timeline of every ephemeral server supertest binds, and
// event-loop lag spikes. That is enough to tell a TIME_WAIT 4-tuple collision
// from a recycled server port, a self-connect, or a stalled event loop.
//
// This file is listed in vitest.config.ts `setupFiles`. Everything below the
// early return costs nothing on a normal run: no timers, no patches, no output.

import http from 'node:http'
import net from 'node:net'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// vitest re-runs setupFiles once per test-file module registry, but `node:http`
// and `node:net` are shared across all of them. Without this guard the patches
// below nest once per registry and every event is emitted N times.
const PATCHED = Symbol.for('api.test.diagnostics.patched')
const globals = globalThis as Record<symbol, boolean>

if (process.env.API_TEST_DIAG === '1' && !globals[PATCHED]) {
  globals[PATCHED] = true

  const outDir =
    process.env.API_TEST_DIAG_DIR ??
    resolve(dirname(fileURLToPath(import.meta.url)), '../../.flake-diag')
  mkdirSync(outDir, { recursive: true })
  const outFile = resolve(outDir, `diag-${process.env.API_TEST_DIAG_RUN ?? process.pid}.ndjson`)

  const started = Date.now()
  const emit = (event: Record<string, unknown>): void => {
    appendFileSync(outFile, `${JSON.stringify({ t: Date.now() - started, ...event })}\n`)
  }

  emit({ kind: 'run-start', pid: process.pid, node: process.version, at: new Date().toISOString() })

  // --- server timeline ---------------------------------------------------
  // Records every ephemeral port bound and released, so a failing request's
  // remote port can be matched against servers that existed earlier.
  type TrackedServer = net.Server & { _diagPort?: number }
  const originalListen = net.Server.prototype.listen
  net.Server.prototype.listen = function patchedListen(this: TrackedServer, ...args: unknown[]) {
    this.once('listening', () => {
      const address = this.address()
      if (address && typeof address === 'object') {
        this._diagPort = address.port
        emit({ kind: 'server-listen', port: address.port })
      }
    })
    this.once('close', () => emit({ kind: 'server-close', port: this._diagPort }))
    return originalListen.apply(this, args as Parameters<typeof originalListen>)
  } as typeof net.Server.prototype.listen

  // --- per-request socket identity ---------------------------------------
  const originalRequest = http.request
  let seq = 0
  http.request = function patchedRequest(...args: unknown[]) {
    const id = ++seq
    const req = originalRequest.apply(
      http,
      args as Parameters<typeof originalRequest>
    ) as http.ClientRequest

    req.on('socket', (socket: net.Socket) => {
      emit({ kind: 'req-socket', id, method: req.method, path: req.path })
      socket.on('connect', () => {
        emit({
          kind: 'req-connect',
          id,
          localPort: socket.localPort,
          remotePort: socket.remotePort,
          selfConnect: socket.localPort === socket.remotePort,
        })
      })
    })
    req.on('response', (res: http.IncomingMessage) => {
      emit({ kind: 'req-response', id, status: res.statusCode })
    })
    req.on('error', (err: NodeJS.ErrnoException & { bytesParsed?: number; rawPacket?: Buffer }) => {
      const socket = req.socket
      emit({
        kind: 'req-error',
        id,
        method: req.method,
        path: req.path,
        message: err.message,
        code: err.code,
        bytesParsed: err.bytesParsed,
        localPort: socket?.localPort,
        remotePort: socket?.remotePort,
        rawPacket: err.rawPacket ? err.rawPacket.toString('latin1').slice(0, 300) : undefined,
      })
    })
    return req
  } as typeof http.request

  // --- event-loop lag ------------------------------------------------------
  const interval = 100
  let last = Date.now()
  const sampler = setInterval(() => {
    const now = Date.now()
    const drift = now - last - interval
    if (drift > 250) emit({ kind: 'loop-lag', driftMs: drift })
    last = now
  }, interval)
  sampler.unref()

  process.on('exit', () => emit({ kind: 'run-end' }))
}
