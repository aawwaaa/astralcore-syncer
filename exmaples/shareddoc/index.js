import { Resource, ResourceEnvironment, resourceEnvironmentSetImpl } from "@aawwaaa/astralcore-syncer";

class SharedDoc extends Resource {
  async resCreate(text) { this.content = text }
  resSave(client) { return { content: this.content } }
  async resLoad({ content }) { this.content = content }
  async modify(text) { this.content = text; this.resSync() }
}

const SharedDocDef = Resource.define(SharedDoc, "shared-doc").invoke("modify");
// even you can .emit("custom"), then obj.event.emit("custom") to spread across clients
if (typeof window !== "undefined") {
  const { ClientWebsocketRemoteManager } = await import("@aawwaaa/astralcore-syncer/impl/client/remote-websocket")
  const { ClientRemoteResourceManager } = await import("@aawwaaa/astralcore-syncer/impl/client/resource-remote")
  const remote = new ClientWebsocketRemoteManager("/ws").init()
  const impl = new ResourceEnvironment(remote, new ClientRemoteResourceManager(remote))
  resourceEnvironmentSetImpl(() => impl)
  const doc = await SharedDocDef.resolve("main")
  const textarea = document.getElementById("edit")
  textarea.addEventListener("input", () => doc.modify(textarea.value))
  doc.event.updater("sync", () => textarea.value = doc.content)
} else {
  const { ServerMemoryResourceManager } = await import("@aawwaaa/astralcore-syncer/impl/server/resource-memory")
  const { ServerWebsocketRemoteManager } = await import("@aawwaaa/astralcore-syncer/impl/server/remote-websocket")
  const remote = new ServerWebsocketRemoteManager()
  const impl = new ResourceEnvironment(remote, new ServerMemoryResourceManager())
  resourceEnvironmentSetImpl(() => impl)
  const doc = await SharedDocDef.loadOrCreate("main", "Hello, world!");
  doc.event.updater("sync", () => console.log(doc.content))
  const { app } = (await import("express-ws")).default((await import("express")).default());
  app.ws("/ws", (ws) => remote.handleWebSocket(ws))
  app.use((await (await import("vite")).createServer({ server: { middlewareMode: true }, appType: "spa" })).middlewares)
  app.listen(8000, console.error)
}