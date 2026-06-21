import { ResourceManager, Resource, ResourceDefiner, ResourceRef, stringifyResourceRef } from "../../object.js";
import { ClientWebsocketRemoteManager } from "./remote-websocket.js";

export class ClientRemoteResourceManager extends ResourceManager {
  constructor(public remote: ClientWebsocketRemoteManager) {
    super()
    remote.resourceManager = this
  }

  removeResource(res: Resource<any, any>): void {
    throw new Error("Unreachable code.");
  }
  pendingResources: Map<string, (existed: boolean, data: any) => void> = new Map()

  loadResource(id: string): Promise<Resource<any, any> | null> {
    const [definer, realId] = ResourceDefiner.fromId(id)
    if (!definer) {
      throw new Error("Unknown resource type: " + id)
    }
    // FIXME: optimize - batch requests
    this.remote.sendMessage({
      command: "resource_request",
      resources: [[id]]
    })
    return new Promise((resolve) => {
      this.pendingResources.set(id, (existed, data) => {
        if (!existed) return resolve(null);
        const res = definer.init(realId)
        void (async () => {
          await res.resLoad(data)
          res.ready()
        })()
        return resolve(res)
      })
    })
  }
  unloadResource(res: Resource<any, any>): void {
    this.resourceMap.delete(res.path()[0])
    this.remote.sendMessage({
      command: "resource_unloaded",
      resources: [res.path().slice(0, 1)]
    })
  }

  handleResource(ref: ResourceRef, existed: boolean, data: any): void {
    const key = stringifyResourceRef(ref)
    if (!this.pendingResources.has(key)) {
      throw new Error("Got a resource without request, " + key)
    }
    this.pendingResources.get(key)!(existed, data)
    this.pendingResources.delete(key)
  }
    
}