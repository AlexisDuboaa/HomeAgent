import type { HueClient } from './hueClient.js'
import type { Action } from './types.js'

export async function executeActions(client: HueClient, actions: Action[]): Promise<void> {
  for (const action of actions) {
    if (action.type === 'set_light_state') {
      if (action.targetKind === 'light') {
        await client.setLightState(action.targetId, action.update as Record<string, unknown>)
      } else {
        await client.setGroupState(action.targetId, action.update as Record<string, unknown>)
      }
    } else {
      await client.activateScene(action.groupId, action.sceneId)
    }
  }
}
