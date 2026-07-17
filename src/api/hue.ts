import axios from 'axios'
import type { HueBridgeConfig, HueLight, HueGroup, HueScene, LightUpdate } from '../types/hue'

const createClient = (config: HueBridgeConfig) => {
  const base =
    import.meta.env.VITE_HUE_PROXY === 'true'
      ? `/hue-bridge/api/${config.username}`
      : `http://${config.ip}/api/${config.username}`
  return axios.create({ baseURL: base, timeout: 5000 })
}

// ─── Lights ────────────────────────────────────────────────────────────────

export async function getLights(config: HueBridgeConfig): Promise<HueLight[]> {
  const client = createClient(config)
  const { data } = await client.get<Record<string, Omit<HueLight, 'id'>>>('/lights')
  return Object.entries(data).map(([id, light]) => ({
    id,
    ...light,
  }))
}

export async function updateLight(
  config: HueBridgeConfig,
  lightId: string,
  update: LightUpdate
): Promise<void> {
  const client = createClient(config)
  await client.put(`/lights/${lightId}/state`, update)
}

export async function toggleLight(
  config: HueBridgeConfig,
  lightId: string,
  on: boolean
): Promise<void> {
  await updateLight(config, lightId, { on })
}

export async function setLightBrightness(
  config: HueBridgeConfig,
  lightId: string,
  bri: number
): Promise<void> {
  // bri is 0-100 (UI) → 1-254 (Hue API)
  const hueBri = Math.max(1, Math.round((bri / 100) * 254))
  await updateLight(config, lightId, { bri: hueBri, on: bri > 0 })
}

// ─── Groups / Rooms ────────────────────────────────────────────────────────

export async function getGroups(config: HueBridgeConfig): Promise<HueGroup[]> {
  const client = createClient(config)
  const { data } = await client.get<Record<string, Omit<HueGroup, 'id'>>>('/groups')
  return Object.entries(data)
    .filter(([, g]) => g.type === 'Room' || g.type === 'Zone')
    .map(([id, group]) => ({ id, ...group }))
}

export async function updateGroup(
  config: HueBridgeConfig,
  groupId: string,
  update: LightUpdate
): Promise<void> {
  const client = createClient(config)
  await client.put(`/groups/${groupId}/action`, update)
}

export async function toggleGroup(
  config: HueBridgeConfig,
  groupId: string,
  on: boolean
): Promise<void> {
  await updateGroup(config, groupId, { on })
}

// ─── Scenes ────────────────────────────────────────────────────────────────

export async function getScenes(config: HueBridgeConfig): Promise<HueScene[]> {
  const client = createClient(config)
  const { data } = await client.get<Record<string, Omit<HueScene, 'id'>>>('/scenes')
  return Object.entries(data).map(([id, scene]) => ({ id, ...scene }))
}

export async function activateScene(
  config: HueBridgeConfig,
  groupId: string,
  sceneId: string
): Promise<void> {
  const client = createClient(config)
  await client.put(`/groups/${groupId}/action`, { scene: sceneId })
}

// ─── Bridge discovery ──────────────────────────────────────────────────────

export async function discoverBridges(): Promise<{ id: string; internalipaddress: string }[]> {
  const { data } = await axios.get('https://discovery.meethue.com', { timeout: 5000 })
  return data
}

export async function createUser(bridgeIp: string): Promise<string> {
  const url =
    import.meta.env.VITE_HUE_PROXY === 'true' ? '/hue-bridge/api' : `http://${bridgeIp}/api`
  const { data } = await axios.post(url, { devicetype: 'hue_dashboard#browser' }, { timeout: 5000 })
  if (data[0]?.error) {
    throw new Error(data[0].error.description)
  }
  return data[0].success.username
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert Hue brightness (1-254) to percentage (0-100) */
export function briToPercent(bri: number | undefined): number {
  if (bri == null || isNaN(bri)) return 0
  return Math.round((bri / 254) * 100)
}

/** Convert percentage (0-100) to Hue brightness (1-254) */
export function percentToBri(pct: number): number {
  return Math.max(1, Math.round((pct / 100) * 254))
}

/** Convert Hue color temperature (mirek) to Kelvin */
export function mirekToKelvin(mirek: number): number {
  return Math.round(1000000 / mirek)
}

/**
 * Interpolate between two RGB colors. t in [0, 1].
 */
function lerpColor(
  [r1, g1, b1]: [number, number, number],
  [r2, g2, b2]: [number, number, number],
  t: number
): string {
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r},${g},${b})`
}

/**
 * Map a Hue color-temperature value (mirek) to a CSS color.
 * 153 mirek ≈ 6500 K (cool daylight blue-white) → 500 mirek ≈ 2000 K (warm candlelight amber).
 */
function ctToColor(ct: number): string {
  const COOL: [number, number, number] = [180, 220, 255] // ~6500 K
  const NEUTRAL: [number, number, number] = [255, 250, 230] // ~4000 K
  const WARM: [number, number, number] = [255, 160, 50] // ~2700 K
  const CANDLE: [number, number, number] = [255, 100, 20] // ~2000 K

  const t = Math.min(1, Math.max(0, (ct - 153) / (500 - 153)))

  if (t < 0.33) return lerpColor(COOL, NEUTRAL, t / 0.33)
  if (t < 0.66) return lerpColor(NEUTRAL, WARM, (t - 0.33) / 0.33)
  return lerpColor(WARM, CANDLE, (t - 0.66) / 0.34)
}

/** Return a CSS color that matches the physical bulb's current color. */
export function hueStateToColor(light: HueLight): string {
  if (!light.state.on) return '#555566'

  const bri = briToPercent(light.state.bri)
  // Lightness scales with brightness: dimmer = darker tint
  const lScale = 0.5 + (bri / 100) * 0.5

  if (
    light.state.colormode === 'hs' &&
    light.state.hue !== undefined &&
    light.state.sat !== undefined
  ) {
    const h = Math.round((light.state.hue / 65535) * 360)
    const s = Math.round((light.state.sat / 254) * 100)
    const l = Math.round(30 + (bri / 100) * 35)
    return `hsl(${h}, ${s}%, ${l}%)`
  }

  if (light.state.colormode === 'xy' && light.state.xy) {
    // CIE xy → approximate hue angle via atan2
    const [x, y] = light.state.xy
    const z = 1 - x - y
    // rough RGB from CIE xy
    const rLin = x * 3.1338561 - y * 1.6168667 - z * 0.4906146
    const gLin = -x * 0.9787684 + y * 1.9161415 + z * 0.033454
    const bLin = x * 0.0719453 - y * 0.2289914 + z * 1.4052427
    const toSrgb = (v: number) => {
      const c = Math.max(0, v)
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    }
    const r = Math.round(Math.min(255, toSrgb(rLin) * 255 * lScale))
    const g = Math.round(Math.min(255, toSrgb(gLin) * 255 * lScale))
    const b = Math.round(Math.min(255, toSrgb(bLin) * 255 * lScale))
    return `rgb(${r},${g},${b})`
  }

  if (light.state.ct) {
    // Apply brightness scaling to CT color
    const base = ctToColor(light.state.ct)
    if (lScale < 1) {
      // Darken by blending toward black
      const match = base.match(/rgb\((\d+),(\d+),(\d+)\)/)
      if (match) {
        const r = Math.round(Number(match[1]) * lScale)
        const g = Math.round(Number(match[2]) * lScale)
        const b = Math.round(Number(match[3]) * lScale)
        return `rgb(${r},${g},${b})`
      }
    }
    return base
  }

  // Fallback: warm white
  return ctToColor(370)
}
