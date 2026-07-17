import https from 'node:https'
import type { TLSSocket } from 'node:tls'
import suncalc from 'suncalc'
import { runTick } from './runner.js'
import { buildSnapshot } from './snapshot.js'
import type { AutomationStore } from './store.js'
import type { HueClient } from './hueClient.js'
import type { TargetKind } from './types.js'

export interface EventListenerConfig {
  bridgeIp: string
  username: string
}

interface HueV2Event {
  type: string
  id_v1?: string
}

interface HueV2Message {
  type: string
  data: HueV2Event[]
}

export function startEventListener(
  store: AutomationStore,
  client: HueClient,
  config: EventListenerConfig
): () => void {
  let stopped = false
  let request: ReturnType<typeof https.request> | undefined
  let pinnedFingerprint: string | null = null

  const connect = () => {
    if (stopped) return
    request = https.request(
      {
        hostname: config.bridgeIp,
        path: '/eventstream/clip/v2',
        headers: { 'hue-application-key': config.username, Accept: 'text/event-stream' },
        // Le bridge Hue a un certificat auto-signé sans CA publique — la validation
        // standard est désactivée, mais remplacée par un pinning du fingerprint
        // ci-dessous (trust-on-first-use), pas par une confiance aveugle.
        rejectUnauthorized: false,
      },
      (res) => {
        const socket = res.socket as TLSSocket
        const fingerprint = socket.getPeerCertificate().fingerprint256
        if (!pinnedFingerprint) {
          pinnedFingerprint = fingerprint
          console.log('Certificat du bridge Hue épinglé (première connexion) :', fingerprint)
        } else if (fingerprint !== pinnedFingerprint) {
          console.error('Certificat du bridge Hue changé de façon inattendue — connexion refusée')
          request?.destroy()
          return
        }

        let buffer = ''
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8')
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) handleRawMessage(part)
        })
        res.on('end', scheduleReconnect)
        res.on('error', scheduleReconnect)
      }
    )
    request.on('error', scheduleReconnect)
    request.end()
  }

  const handleRawMessage = (rawEvent: string) => {
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'))
    if (!dataLine) return
    let messages: HueV2Message[]
    try {
      messages = JSON.parse(dataLine.slice('data:'.length).trim())
    } catch {
      return
    }
    for (const message of messages) {
      for (const event of message.data) {
        void handleEvent(event)
      }
    }
  }

  const handleEvent = async (event: HueV2Event) => {
    const targetId = extractV1Id(event.id_v1)
    if (!targetId) return

    const now = new Date()
    const locationConfig = store.getConfig()
    const sunTimes = locationConfig
      ? suncalc.getTimes(now, locationConfig.latitude, locationConfig.longitude)
      : { sunrise: new Date(0), sunset: new Date(0) }
    const ctxBase = { now, sunTimes: { sunrise: sunTimes.sunrise, sunset: sunTimes.sunset } }

    if (event.type === 'motion' || event.type === 'light_level') {
      const snapshot = await buildSnapshot(client)
      const sensorState = snapshot.sensors[targetId]?.state
      if (!sensorState) return
      await runTick(
        store,
        client,
        { ...ctxBase, event: { kind: 'sensor', sensorId: targetId, event: sensorState } },
        snapshot
      )
    } else if (event.type === 'button') {
      await runTick(store, client, {
        ...ctxBase,
        event: { kind: 'sensor', sensorId: targetId, event: 'button_press' },
      })
    } else if (event.type === 'light' || event.type === 'grouped_light') {
      const targetKind: TargetKind = event.type === 'grouped_light' ? 'group' : 'light'
      const snapshot = await buildSnapshot(client)
      const on = (targetKind === 'light' ? snapshot.lights : snapshot.groups)[targetId]?.on
      if (on === undefined) return
      await runTick(
        store,
        client,
        { ...ctxBase, event: { kind: 'light_state', targetId, targetKind, state: on ? 'on' : 'off' } },
        snapshot
      )
    }
  }

  const scheduleReconnect = () => {
    if (stopped) return
    setTimeout(connect, 5000)
  }

  connect()

  return () => {
    stopped = true
    request?.destroy()
  }
}

function extractV1Id(idV1: string | undefined): string | undefined {
  if (!idV1) return undefined
  const segments = idV1.split('/')
  return segments[segments.length - 1]
}
