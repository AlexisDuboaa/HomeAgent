import axios, { type AxiosInstance } from 'axios'

export interface HueClientConfig {
  bridgeIp: string
  username: string
}

export interface HueLightState {
  on: boolean
  bri: number
  reachable: boolean
}

export interface HueGroupState {
  any_on: boolean
  all_on: boolean
}

export interface HueSensor {
  id: string
  name: string
  type: string
  state: Record<string, unknown>
}

export class HueClient {
  private http: AxiosInstance

  constructor(config: HueClientConfig) {
    this.http = axios.create({
      baseURL: `http://${config.bridgeIp}/api/${config.username}`,
      timeout: 5000,
    })
  }

  async getLights(): Promise<Record<string, HueLightState>> {
    const { data } = await this.http.get<Record<string, { state: HueLightState }>>('/lights')
    return Object.fromEntries(Object.entries(data).map(([id, l]) => [id, l.state]))
  }

  async getGroups(): Promise<Record<string, HueGroupState>> {
    const { data } = await this.http.get<Record<string, { state: HueGroupState }>>('/groups')
    return Object.fromEntries(Object.entries(data).map(([id, g]) => [id, g.state]))
  }

  async getSensors(): Promise<Record<string, HueSensor>> {
    const { data } = await this.http.get<Record<string, Omit<HueSensor, 'id'>>>('/sensors')
    return Object.fromEntries(Object.entries(data).map(([id, s]) => [id, { id, ...s }]))
  }

  async setLightState(lightId: string, update: Record<string, unknown>): Promise<void> {
    await this.http.put(`/lights/${lightId}/state`, update)
  }

  async setGroupState(groupId: string, update: Record<string, unknown>): Promise<void> {
    await this.http.put(`/groups/${groupId}/action`, update)
  }

  async activateScene(groupId: string, sceneId: string): Promise<void> {
    await this.http.put(`/groups/${groupId}/action`, { scene: sceneId })
  }
}
