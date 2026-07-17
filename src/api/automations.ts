import axios from 'axios'
import type { Automation, AutomationRunLogEntry, LocationConfig } from '../types/automation'

const client = axios.create({ baseURL: '/automations-api', timeout: 5000 })

export async function getAutomations(): Promise<Automation[]> {
  const { data } = await client.get<Automation[]>('/automations')
  return data
}

export async function createAutomation(input: Omit<Automation, 'id' | 'createdAt'>): Promise<Automation> {
  const { data } = await client.post<Automation>('/automations', input)
  return data
}

export async function updateAutomation(
  id: string,
  input: Omit<Automation, 'id' | 'createdAt'>
): Promise<Automation> {
  const { data } = await client.put<Automation>(`/automations/${id}`, input)
  return data
}

export async function deleteAutomation(id: string): Promise<void> {
  await client.delete(`/automations/${id}`)
}

export async function toggleAutomation(id: string): Promise<Automation> {
  const { data } = await client.post<Automation>(`/automations/${id}/toggle`)
  return data
}

export async function getAutomationHistory(id: string): Promise<AutomationRunLogEntry[]> {
  const { data } = await client.get<AutomationRunLogEntry[]>(`/automations/${id}/history`)
  return data
}

export async function getLocationConfig(): Promise<LocationConfig | null> {
  const { data } = await client.get<LocationConfig | null>('/config')
  return data
}

export async function setLocationConfig(config: LocationConfig): Promise<LocationConfig> {
  const { data } = await client.put<LocationConfig>('/config', config)
  return data
}
