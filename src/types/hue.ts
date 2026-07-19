export interface HueBridgeConfig {
  ip: string
  username: string
}

export interface HueLight {
  id: string
  name: string
  state: {
    on: boolean
    bri: number // 1-254
    hue?: number // 0-65535
    sat?: number // 0-254
    ct?: number // color temperature in mirek
    xy?: [number, number]
    colormode?: 'hs' | 'xy' | 'ct'
    reachable: boolean
  }
  type: string
  modelid: string
  manufacturername: string
  productname: string
  roomId?: string
  roomName?: string
}

export interface HueGroup {
  id: string
  name: string
  lights: string[]
  type: 'Room' | 'Zone' | 'Entertainment' | 'LightGroup'
  class?: string
  state: {
    all_on: boolean
    any_on: boolean
  }
  action: {
    on: boolean
    bri: number
    hue?: number
    sat?: number
    ct?: number
    colormode?: string
  }
}

export interface HueScene {
  id: string
  name: string
  group?: string
  lights: string[]
  type: 'GroupScene' | 'LightScene'
  appdata?: {
    version: number
    data: string
  }
}

export interface HueSensor {
  id: string
  name: string
  type: string // e.g. 'ZLLPresence', 'ZLLLightLevel', 'ZLLSwitch', 'ZGPSwitch'
  state: {
    presence?: boolean
    dark?: boolean
    lightlevel?: number
    buttonevent?: number
  }
}

export interface LightUpdate {
  on?: boolean
  bri?: number
  hue?: number
  sat?: number
  ct?: number
  xy?: [number, number]
}
