import { Resource, ResourceRef, stringifyResourceRef, BaseResource, freeResourcesInObject } from "../../object.js";
import WebSocket from "ws";
import { AsyncLocalStorage } from "node:async_hooks";
import { RemoteCaller, RemoteManager } from "../../remote.js";
import { WebSocketMessageConnect, WebSocketMessageClient2Server, WebSocketMessageServer2Client, TypedValue, typedValueUnpack, typedValuePack } from "../../protocol.js";
import { resourceEnvironment } from "../../environment.js";

const callerStorage = new AsyncLocalStorage<ExtRemoteCaller | null>();

export type ExtRemoteCaller = RemoteCaller & {
  connection: Connection
}

export class ServerWebsocketRemoteManager implements RemoteManager {
  connections: Connection[] = [];

  isClient(): boolean { return false; }
  isServer(): boolean { return true; }
  async rpcInvoke(resource: BaseResource<any, any>, method: string, ...args: any[]): Promise<any> {
    throw new Error("Unreachable code.")
  }
  rpcEmit(resource: BaseResource<any, any>, event: string, ...args: any[]): void {
    for (const connection of this.connections) {
      connection.emit(resource, event, ...args)
    }
  }
  getCaller(): ExtRemoteCaller | null {
    const caller = callerStorage.getStore();
    return caller ? (caller as ExtRemoteCaller) : null;
  }

  runInContext(caller: ExtRemoteCaller | null, callback: () => Promise<any>): Promise<any> {
    return callerStorage.run(caller, callback);
  }

  _createOrGetConnection(id: string, msg: WebSocketMessageConnect, callerExt: any) {
    const connection = this.connections.find((connection) => connection.id === id);
    if (connection) {
      return connection;
    }
    const newConnection = new Connection(this, id);
    newConnection.connect(msg, callerExt);
    this.connections.push(newConnection);
    return newConnection;
  }
  _removeConnection(id: string) {
    const index = this.connections.findIndex((connection) => connection.id === id);
    if (index !== -1) {
      this.connections.splice(index, 1);
    }
  }

  handleWebSocket(websocket: WebSocket, callerExt: object = {}) {
    const timeout = setTimeout(() => {
      websocket.close();
    }, 3000);
    websocket.once("message", (message) => {
      clearTimeout(timeout);
      try {
        const obj = JSON.parse(message.toString()) as WebSocketMessageClient2Server;
        if (obj.command !== "connect") {
          throw new Error("Invalid command");
        }
        const connection = this._createOrGetConnection(obj.id, obj, callerExt);
        connection.setWebSocket(websocket);
        connection.sendMessage({
          command: "established",
          id: obj.id
        })
        // if (login) {
        //   connection.handleInvoke(Vars.res.ref(Vars.user), "verify", {
        //     type: "array",
        //     value: [
        //       {
        //         type: "basic",
        //         value: login.username
        //       },
        //       {
        //         type: "basic",
        //         value: login.token
        //       }
        //     ]
        //   }, "$serverside")
        // }
      } catch (error) {
        websocket.send(JSON.stringify({ command: "error", message: "Invalid message" }));
        console.error("Failed to handle WebSocket message:", error);
        websocket.close();
      }
    });
  }
}

export class Connection {
  id: string;
  messageQueue: WebSocketMessageServer2Client[] = []
  websocket?: WebSocket;
  _reconnectTimeout?: NodeJS.Timeout;
  callerExt: object = {};

  loadedResource: Record<string, Resource<any, any>> = {}
  // user: User | null = null

  constructor(protected remote: ServerWebsocketRemoteManager, id: string) {
    this.id = id;
  }

  status() {
    return `
Connection ${this.id}
  object_refs: ${Object.keys(this.loadedResource).length}
`
  }

  setWebSocket(websocket: WebSocket) {
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = undefined;
    }
    this.websocket = websocket;
    if (this.messageQueue.length > 0) {
      for (const message of this.messageQueue) {
        this.sendMessage(message);
      }
      this.messageQueue = [];
    }

    websocket.on("message", (message) => {
      try {
        const obj = JSON.parse(message.toString()) as WebSocketMessageClient2Server;
        this.handleMessage(obj);
      } catch (e) {
        console.error("Failed to handle WebSocket message ", message, ":", e);
        this.sendMessage({
          command: "fatal_error",
          message: e instanceof Error ? e.toString() : "Unknown error",
        });
      }
    });
    websocket.on("close", () => {
      this.websocket = undefined;
      this._reconnectTimeout = setTimeout(() => {
        this.close()
      }, 5000);
    });
  }

  close() {
    for (const obj of Object.values(this.loadedResource)) {
      obj.refRemove()
    }
    // if (this.user) {
    //   this.user.refRemove()
    // }
    this.remote._removeConnection(this.id);
  }

  connect(msg: WebSocketMessageConnect, callerExt: object) {
    this.callerExt = callerExt;
    for (const ref of msg.loadedResources) {
      if (!ref) continue
      if (!this.loadedResource[ref[0]]) {
        this.handleResourceRequest(ref, false)
      }
    }
  }

  sendMessage(message: WebSocketMessageServer2Client) {
    if (!this.websocket) {
      this.messageQueue.push(message);
      return;
    }
    this.websocket.send(JSON.stringify(message));
  }

  async handleResourceRequest(ref: ResourceRef, send: boolean = true) {
    if (ref && ref.length != 1) {
      console.error("Got an unexpected resource request: ", ref)
      return
    }
    const res = await resourceEnvironment().resource.resolve(ref)
    if (res) {
      const existed = this.loadedResource[stringifyResourceRef(ref)] 
      if (existed) {
        existed.refRemove() // resolve added a ref
      }
      this.loadedResource[stringifyResourceRef(ref)] = res as any
    }
    if (send) this.sendMessage({
      command: "resource",
      ref, exists: res != null,
      data: res?.resSave(true)
    })
  }

  handleResourceUnload(ref: ResourceRef) {
    const existed = this.loadedResource[stringifyResourceRef(ref)] 
    if (existed) {
      existed.refRemove() // resolve added a ref
    }
    delete this.loadedResource[stringifyResourceRef(ref)]
  }

  async handleInvoke(ref: ResourceRef, method: string, argsTv: TypedValue, id: string) {
    const args = await typedValueUnpack(argsTv)
    if (!Array.isArray(args)) {
      this.sendMessage({
        command: "invoke_response",
        id, result: typedValuePack(new Error("Not a valid args list.")),
        isError: true
      })
      return
    }
    const res = await resourceEnvironment().resource.resolve(ref)
    if (!res) {
      this.sendMessage({
        command: "invoke_response",
        id, result: typedValuePack(new Error("Resource not found: " + ref)),
        isError: true
      })
      return
    }
    let ret, isError;
    try {
      ret = await this.remote.runInContext(this.caller(), async () => {
        return await res.rpcInvoke(method, ...args)
      });
      isError = false
    } catch (e) {
      ret = e
      isError = true
    } finally {
      freeResourcesInObject(args)
    }
    this.sendMessage({
      command: "invoke_response",
      id, result: typedValuePack(ret), isError
    })
    freeResourcesInObject(ret)
    res.refRemove()
  }

  handleMessage(message: WebSocketMessageClient2Server){
    switch (message.command) {
      case "connect":
        throw new Error("Unreachable code! Check the frontend!");
      case "invoke":
        void this.handleInvoke(message.resource, message.method, message.args, message.id)
          .catch(e => console.error("Error while handling invoke: ", message, "\n", e))
        break
      case "resource_request":
        for (const ref of message.resources) {
          void this.handleResourceRequest(ref)
            .catch(e => console.error("Error while handling request: ", message, "\n", e))
        }
        break
      case "resource_unloaded":
        for (const ref of message.resources) {
          void this.handleResourceUnload(ref)
        }
        break
      case "ping":
        this.sendMessage({
          command: "pong",
          id: message.id
        })
        break
    }
  }

  /**
   * borrow ref
   */
  emit(resource: BaseResource<any, any>, event: string, ...args: any[]): void {
    const first = resource.path()[0]
    if (!this.loadedResource[first]) return; // not for me
    this.sendMessage({
      command: "emit",
      resource: resource.path(),
      event: event,
      data: typedValuePack(args) as Extract<TypedValue, {type: "array"}>
    })
  }

  caller(): ExtRemoteCaller {
    return Object.assign({
      connection: this
    }, this.callerExt)
  }
}
