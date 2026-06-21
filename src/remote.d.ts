import { BaseResource } from "./object.js"

export interface RemoteCaller {}

export interface RemoteManager {
  isClient(): boolean
  isServer(): boolean

  rpcInvoke(resource: BaseResource<any, any>, method: string, ...args: any[]): Promise<any> // client -> server
  rpcEmit(resource: BaseResource<any, any>, event: string, ...args: any[]): void

  getCaller(): RemoteCaller | null
}
