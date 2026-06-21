import { generateUUID } from "../../util.js";
import { ResourceManager, Resource, ResourceDefiner, ResourceRef, stringifyResourceRef } from "../../object.js";

import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";


export class ServerJSONFileResourceManager extends ResourceManager {
  constructor(public dataDir: string) {
    super();
    (async () => {
      try {
        for (const f of await readdir(join(dataDir, ".temp"))) {
          await unlink(join(dataDir, ".tmp", f))
        }
      } catch (e) {}
      mkdir(join(dataDir, ".temp"), {
        recursive: true
      })
    })()
  }

  async loadResource(id: string): Promise<Resource<any, any> | null> {
    const [definer, realId] = ResourceDefiner.fromId(id)
    const path = definer.loadPath(realId)
    const full = join(this.dataDir, path)

    try {
      await access(full)
    } catch (e) {
      return null
    }

    try {
      const data = (await readFile(full)).toString()
      const content = await (definer.customLoader ?? JSON.parse)(data)
      const res = definer.init(realId)
      void (async () => {
        await res.resLoad(content)
        res.ready()
      })()
      return res
    } catch (e) {
      console.error("Failed to load " + full)
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
      const path = join(this.dataDir, res.definer().savePath(res))
      const data = res.resSave(false)
      await mkdir(dirname(path), {
        recursive: true
      })
      const temp = this.mktemp()
      await writeFile(temp, (res.definer().customSaver ?? JSON.stringify)(data))
      await rename(temp, path)
    }catch(e){
      console.error("An error occurred when saving object for ", res, ": ", e)
    }
  }

  async removeResource(res: Resource<any, any>): Promise<void> {
    const path = join(this.dataDir, res.definer().savePath(res))
    try {
      try {await access(path)} catch {return}
      await unlink(path)
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

  mktemp() {
    return join(this.dataDir, ".temp", generateUUID())
  }

}
