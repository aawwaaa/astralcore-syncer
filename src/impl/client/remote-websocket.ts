import { resourceEnvironment } from "../../environment.js";
import { EventBus } from "../../event.js";
import { ResourceRef, freeResourcesInObject, BaseResource } from "../../object.js";
import { WebSocketMessageClient2Server, WebSocketMessageConnect, WebSocketMessageEstablished, WebSocketMessageServer2Client, typedValueUnpack, TypedValue, typedValuePack } from "../../protocol.js";
import { RemoteManager, RemoteCaller } from "../../remote.js";
import type { ClientRemoteResourceManager } from "./resource-remote.js";

const PING_INTERVAL = 5000

export class ClientWebsocketRemoteManager implements RemoteManager {
  event: EventBus<{
    connected: [],
    disconnected: [],
    pong: [number]
  }> = new EventBus();
  clientid!: string

  websocket!: WebSocket
  private messageQueue: WebSocketMessageClient2Server[] = []
  connected: boolean = false
  private retryTimer?: number

  private pingTimer?: number
  private _resolveEstablished: () => void = () => void 0
  private _resolvedEstablished = false
  connectEstablished!: Promise<void>

  private invokes: Record<string, (ret: any, isError: any) => void> = {}

  private pingId: number = 0
  private pingBegin: Map<number, number> = new Map()
  lastPingId: number = -1
  lastPingDelay: number = 0

  private _preparePromise() {
    if (this._resolvedEstablished) {
      this._resolvedEstablished = false
      this.connectEstablished = new Promise(r => this._resolveEstablished = () => {
        r()
        this._resolvedEstablished = true
      })
    }
  }

  resourceManager!: ClientRemoteResourceManager

  constructor(public websocketPath: string) {
    this._preparePromise()
  }

  init() {
    this.clientid = Math.random().toString()

    this.connect()
    return this
  }

  connectData(): WebSocketMessageConnect {
    return {
      command: "connect", id: this.clientid,
      loadedResources: [...resourceEnvironment().resource.resourceMap.keys()].map(a => [a])
    }
  }

  connect() {
    console.log('[ClientRemoteManager] Connecting to server...')
    clearTimeout(this.retryTimer)
    this.websocket = new WebSocket(this.websocketPath)
    this.connected = false

    this.websocket.onopen = () => {
      this.websocket.send(JSON.stringify(this.connectData()))
    }
    this.websocket.onmessage = (e) => {
      try {
        const json = JSON.parse(e.data) as WebSocketMessageEstablished
        if (json.command != "established") {
          throw new Error("Invalid message: " + e.data)
        }
        this.connected = true
        this.handleConnected()
      } catch (e) {
        console.error("Error during connecting ", e)
        this.scheduleReconnect()
      }
    }
    this.websocket.onerror = (e) => {
      console.error("Error during connecting ", e)
      this.scheduleReconnect()
    }
    this.websocket.onclose = () => {
      this.scheduleReconnect()
    }
  }

  handleConnected() {
    console.log('[ClientRemoteManager] Connection established')
    this.connected = true
    clearTimeout(this.retryTimer)

    this.websocket.onmessage = (e) => {
      try {
        const json = JSON.parse(e.data) as WebSocketMessageServer2Client
        this.handleMessage(json)
      } catch (e) {
        console.error("Error during handling message ", e)
      }
    }

    for (const msg of this.messageQueue) {
      this.sendMessage(msg)
    }
    this.messageQueue = []

    this.pingTimer = setInterval(() => {
      const id = this.pingId ++
      this.pingBegin.set(id, Date.now())
      this.sendMessage({
        command: "ping", id: id.toString()
      })
    }, PING_INTERVAL) as any

    this._resolveEstablished()
    this.event.emit("connected")
  }

  scheduleReconnect() {
    console.log('[ClientRemoteManager] Connection lost, scheduling reconnect...')
    this.websocket?.close()
    this.websocket = null as any

    clearInterval(this.pingTimer)
    this.lastPingId = -1
    this.lastPingDelay = 0

    this.connected = false
    this._preparePromise()

    this.retryTimer = setTimeout(() => {
      this.connect()
    }) as any
    this.event.emit("disconnected")
  }

  close() {
    console.log('[ClientRemoteManager] Connection closed')
    this.scheduleReconnect = () => void 0
    this.connect = () => void 0
    if (this.connected) this.websocket.close()
    this.event.emit("disconnected")
  }

  sendMessage(message: WebSocketMessageClient2Server) {
    if (!this.connected) {
      this.messageQueue.push(message);
      return;
    }
    this.websocket.send(JSON.stringify(message));
  }

  handleMessage(message: WebSocketMessageServer2Client) {
    switch (message.command) {
      case 'established':
        throw new Error("Unreachable code.")
      case 'invoke_response': void (async () => {
        if (message.id == "$serverside") return
        const handler = this.invokes[message.id]
        if (!handler) {
          throw new Error("Invaild response id, not found! " + message.id)
        }
        const res = await typedValueUnpack(message.result)
        handler(res, message.isError)
        return
      })(); break
      case 'emit':
        void this.handleEmit(message.resource, message.event, message.data)
        break
      case 'resource':
        this.resourceManager.handleResource(message.ref, message.exists, message.data)
        break
      case 'pong':
        const id = +message.id
        if (!this.pingBegin.has(id)) {
          throw new Error("Got a pong without ping, " + message.id)
        }
        const begin = this.pingBegin.get(id)!
        const delta = Date.now() - begin
        this.lastPingId = id
        this.lastPingDelay = delta
        this.event.emit("pong", delta)
        break
      case 'fatal_error':
        this.close()
        console.error("Server issued a fatal error, disconnecting: " + message.message)
        break
    }
  }

  async handleEmit(ref: ResourceRef, event: string, argsTv: TypedValue) {
    using res = await resourceEnvironment().resource.resolve(ref) ?? undefined
    if (!res) {
      if (event == "$remove") return // no difference
      throw new Error("Resource not found: " + ref)
    }
    const args = (await typedValueUnpack(argsTv) as any[])
    res.rpcEmit(event, ...args)
    freeResourcesInObject(args)
  }

  isClient(): boolean { return true }
  isServer(): boolean { return false }
  rpcInvoke(resource: BaseResource<any, any>, method: string, ...args: any[]): Promise<any> {
    const id = Math.random().toString()
    this.sendMessage({
      command: "invoke", id,
      resource: resource.path(),
      method, args: typedValuePack(args) as Extract<TypedValue, { type: "array" }>,
    })
    freeResourcesInObject(args)
    return new Promise((res, rej) => {
      this.invokes[id] = (ret, isError) => {
        if (isError) rej(ret);
        else res(ret)
      }
    })
  }
  rpcEmit(resource: BaseResource<any, any>, event: string, ...args: any[]): void {
    throw new Error('Unreachable code.');
  }
  getCaller(): RemoteCaller {
    throw new Error('Unreachable code.');
  }
}