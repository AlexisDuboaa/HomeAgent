import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type {
  HueBridgeConfig,
  HueLight,
  HueGroup,
  HueScene,
  HueSensor,
  LightUpdate,
} from '../types/hue'
import * as api from '../api/hue'

interface HueContextValue {
  config: HueBridgeConfig | null
  setConfig: (config: HueBridgeConfig) => void
  lights: HueLight[]
  groups: HueGroup[]
  scenes: HueScene[]
  sensors: HueSensor[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  updateLight: (lightId: string, update: LightUpdate) => Promise<void>
  toggleLight: (lightId: string, on: boolean) => Promise<void>
  setLightBrightness: (lightId: string, bri: number) => Promise<void>
  toggleGroup: (groupId: string, on: boolean) => Promise<void>
  updateGroup: (groupId: string, update: LightUpdate) => Promise<void>
  activateScene: (groupId: string, sceneId: string) => Promise<void>
}

const HueContext = createContext<HueContextValue | null>(null)

const CONFIG_KEY = 'hue_bridge_config'

export function HueProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<HueBridgeConfig | null>(() => {
    const stored = localStorage.getItem(CONFIG_KEY)
    if (stored) return JSON.parse(stored)
    // Auto-configure depuis la variable d'environnement injectée au build
    const username = import.meta.env.VITE_HUE_USERNAME
    if (username) {
      const cfg: HueBridgeConfig = { ip: 'proxy', username }
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
      return cfg
    }
    return null
  })
  const [lights, setLights] = useState<HueLight[]>([])
  const [groups, setGroups] = useState<HueGroup[]>([])
  const [scenes, setScenes] = useState<HueScene[]>([])
  const [sensors, setSensors] = useState<HueSensor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setConfig = useCallback((cfg: HueBridgeConfig) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
    setConfigState(cfg)
  }, [])

  const refresh = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      const [lightsData, groupsData, scenesData, sensorsData] = await Promise.all([
        api.getLights(config),
        api.getGroups(config),
        api.getScenes(config),
        api.getSensors(config),
      ])

      // Attach room info to lights
      const lightWithRoom = lightsData.map((light) => {
        const room = groupsData.find((g) => g.lights.includes(light.id))
        return { ...light, roomId: room?.id, roomName: room?.name }
      })

      setLights(lightWithRoom)
      setGroups(groupsData)
      setScenes(scenesData)
      setSensors(sensorsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au bridge Hue')
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount + poll
      refresh()
      const interval = setInterval(refresh, 10000) // poll every 10s
      return () => clearInterval(interval)
    }
  }, [config, refresh])

  const updateLight = useCallback(
    async (lightId: string, update: LightUpdate) => {
      if (!config) return
      // Optimistic update
      setLights((prev) =>
        prev.map((l) => (l.id === lightId ? { ...l, state: { ...l.state, ...update } } : l))
      )
      await api.updateLight(config, lightId, update)
    },
    [config]
  )

  const toggleLight = useCallback(
    async (lightId: string, on: boolean) => {
      if (!config) return
      setLights((prev) =>
        prev.map((l) => (l.id === lightId ? { ...l, state: { ...l.state, on } } : l))
      )
      await api.toggleLight(config, lightId, on)
    },
    [config]
  )

  const setLightBrightness = useCallback(
    async (lightId: string, pct: number) => {
      if (!config) return
      const bri = api.percentToBri(pct)
      setLights((prev) =>
        prev.map((l) => (l.id === lightId ? { ...l, state: { ...l.state, bri, on: pct > 0 } } : l))
      )
      await api.setLightBrightness(config, lightId, pct)
    },
    [config]
  )

  const toggleGroup = useCallback(
    async (groupId: string, on: boolean) => {
      if (!config) return
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, state: { all_on: on, any_on: on } } : g))
      )
      await api.toggleGroup(config, groupId, on)
      await refresh()
    },
    [config, refresh]
  )

  const updateGroup = useCallback(
    async (groupId: string, update: LightUpdate) => {
      if (!config) return
      await api.updateGroup(config, groupId, update)
      await refresh()
    },
    [config, refresh]
  )

  const activateScene = useCallback(
    async (groupId: string, sceneId: string) => {
      if (!config) return
      await api.activateScene(config, groupId, sceneId)
      await refresh()
    },
    [config, refresh]
  )

  return (
    <HueContext.Provider
      value={{
        config,
        setConfig,
        lights,
        groups,
        scenes,
        sensors,
        loading,
        error,
        refresh,
        updateLight,
        toggleLight,
        setLightBrightness,
        toggleGroup,
        updateGroup,
        activateScene,
      }}
    >
      {children}
    </HueContext.Provider>
  )
}

export function useHue() {
  const ctx = useContext(HueContext)
  if (!ctx) throw new Error('useHue must be used inside HueProvider')
  return ctx
}
