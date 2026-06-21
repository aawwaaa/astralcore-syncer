import { ResourceManager, Resource, ResourceDefiner } from "../../object.js";


export class ServerMemoryResourceManager extends ResourceManager {
  memory: Map<string, any> = new Map()

  constructor() {
    super();
  }

  async loadResource(id: string): Promise<Resource<any, any> | null> {
    const [definer, realId] = ResourceDefiner.fromId(id)
    const path = definer.loadPath(realId)
    if (!this.memory.has(path)) return null

    try {
      const data = this.memory.get(path)
      const content = await (definer.customLoader ?? JSON.parse)(data)
      const res = definer.init(realId)
      void (async () => {
        await res.resLoad(content)
        res.ready()
      })()
      return res
    } catch (e) {
      console.error("Failed to load " + path)
      // return null
      throw e
    }
  }
  unloadResource(res: Resource<any, any>): void {
    void this.saveResource(res)
    res.resDrop()
  }

  async saveResource(res: Resource<any, any>): Promise<void> {
    try {
      const path = res.definer().savePath(res)
      const data = res.resSave(false)
      this.memory.set(path, data)
    }catch(e){
      console.error("An error occurred when saving object for ", res, ": ", e)
    }
  }

  async removeResource(res: Resource<any, any>): Promise<void> {
    const path = res.definer().savePath(res)
    try {
      this.memory.delete(path)
      res.resDrop()
    } catch (e) {
      console.error("Failed to remove resource: ", path, res.path(), e)
    }
  }

  async saveAll(): Promise<void> {
    const p = []
    for (const resource of this.resourceMap.values()) {
      p.push(this.saveResource(resource))
    }
    await Promise.allSettled(p);
  }

  async shutdown() {
    const p = []
    for (const resource of this.resourceMap.values()) {
      p.push((async () => {
        await this.saveResource(resource)
        resource.resDrop()
      })())
    }
    await Promise.allSettled(p);
  }
}
