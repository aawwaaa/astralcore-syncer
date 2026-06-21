import { EventBus } from "./event.js"
import { typedValuePackData } from "./protocol.js"
import { resourceEnvironment as env } from "./environment.js"

const symbolInvokeMethods = Symbol.for("invokeMethods")
const symbolEmitEvents = Symbol.for("emitEvents")
const symbolDefiner = Symbol.for("definer")

export type BaseResourceEvent = {
  sync: [],
  remove: []
}


export const DebugRefTracker = {
  enabled: false,
  map: new Map<BaseResource<any, any>, string[]>(),

  async handleRefAdd(res: BaseResource<any, any>) {
    if (!this.enabled) return
    const error = new Error()
    const stack = (error.stack!).split("\n").slice(3).join("\n")
    if (!this.map.has(res))
      this.map.set(res, [])
  
    const ref = stringifyResourceRef(env().resource.ref(res))
    // if (!ref.startsWith("chunk@test-(-1,0)")) return
    // if (!ref.includes("chunk")) return
    
    if (!stack.includes("Tile"))
      this.map.get(res)?.push(stack)
    
    // const {Chunk, World} = await import("./world/world.js")
    // if (res instanceof World) return
    // if (res instanceof Chunk) return
    console.trace(`[RefTracker] +   Ref: [${res.refcount}] ${ref}`)
  },
  async handleRefRemove(res: BaseResource<any, any>) {
    if (!this.enabled) return
    const error = new Error()
    const stack = (error.stack!)
    const ref = stringifyResourceRef(env().resource.ref(res))
    // if (!ref.includes("entity")) return
    // if (!ref.startsWith("chunk@test-(-1,0)")) return
    // const {Chunk, World} = await import("./world/world.js")
    // if (res instanceof World) return
    // if (res instanceof Chunk) return
    console.trace(`[RefTracker] - Deref: [${res.refcount}] ${stringifyResourceRef(env().resource.ref(res))}`)
  },
  async handleResDrop(res: BaseResource<any, any>) {
    if (!this.enabled) return
    const ref = stringifyResourceRef(env().resource.ref(res))
    // if (!ref.startsWith("chunk@test-(-1,0)")) return
    console.log(`[RefTracker] *  Drop: [*] ${stringifyResourceRef(env().resource.ref(res))}`)
    this.map.delete(res)
  }
};
(globalThis as any).DebugRefTracker = DebugRefTracker

export abstract class BaseResource<Data, Events extends BaseResourceEvent> {
  event: EventBus<Events & BaseResourceEvent>
  refcount: number = 0
  refremovers: ((object: any) => void)[] = []
  resDropped: boolean = false
  subResources: Map<string, SubResource<any, any, this>> = new Map()
  resGoingToRemove: boolean = false

  constructor() {
    this.event = new EventBus()
    if (env().remote.isServer())
      this.event.rpcs.push(this.rpcEvent.bind(this))
  }

  [Symbol.dispose]() {
    this.refRemove()
  }

  returnMove() {
    this.refAdd()
    return this
  }

  refAdd(remover?: ((object: any) => void)) {
    this.refcount ++
    if (remover) this.refremovers.push(remover)
    DebugRefTracker.handleRefAdd(this)
  }
  refRemove() {
    this.refcount --
    if (this.isReady() && this.refcount <= 0 && !this.resDropped) {
      this.resDrop()
    }
    DebugRefTracker.handleRefRemove(this)
  }

  resDrop(): void {
    if (this.resDropped) return
    for (const sub of this.subResources.values()) {
      sub.resDrop()
    }
    this.resDropped = true
    this.refremovers.forEach(cb => cb(this))
    DebugRefTracker.handleResDrop(this)
  }

  abstract resCreate(...args: any[]): Promise<any>;
  abstract resSave(client: boolean): Data;
  abstract resLoad(data: Data): Promise<void>;
  async resRemove(): Promise<void> {
    if (this.resDropped) return
    if (!env().remote.isServer()) throw new Error("Only available on server side")
    this.resGoingToRemove = true
    for (const child of this.subResources.values()) {
      child.resRemove()
    }
    env().remote.rpcEmit(this, "$remove")
    this.resDrop()
  }

  resSync() {
    if (env().remote.isClient()) return;
    env().remote.rpcEmit(this, "$sync", typedValuePackData(this.resSave(true)))
  }

  // method -> RpcManager
  async rpcInvoke(method: string, ...args: any[]): Promise<any> {
    if (Object.getPrototypeOf(this)[symbolInvokeMethods][method]) {
      try {
        return Promise.resolve(await (this as any)[method].apply(this, args))
      } catch (error) {
        return Promise.reject(error)
      }
    }
    return Promise.reject(new Error('Method not found: ' + method))
  }
  // event -> RpcManager
  rpcEmit(event: string, ...args: any[]): void {
    if (event == "$sync") {
      this.resLoad(args[0]).catch(e => {
        console.error("Error during syncing for ", this.path(), " with data ", args[0], ": ", e)
      }).then(() => {
        this.event.emit("sync")
      })
      return
    }
    if (event == "$remove") {
      this.event.emit("remove")
    }
    if (Object.getPrototypeOf(this)[symbolEmitEvents][event]) {
      this.event.emit(event as any, ...(args as any))
    }
  }
  private rpcEvent(event: string, ...args: any[]) {
    if (Object.getPrototypeOf(this)[symbolEmitEvents][event]) {
      env().remote.rpcEmit(this, event, ...args)
    }
  }

  resChild(path: string[]): [BaseResource<any, any> | null, string[]] {
    if (path.length == 0) return [this, []]
    const child = this.subResources.get(path[0])
    if (!child) return [null, path]
    return child.resChild(path.slice(1))
  }

  // RpcManager -> resInvoke -> resChild -> resInvoke -> ... -> rpcInvoke
  // resInvoke(path: string[], method: string, ...args: any[]): Promise<any> {
  //   const [child, remainingPath] = this.resChild(path)
  //   if (child) {
  //     if (child === this)
  //       return this.rpcInvoke(method, ...args)
  //     return child.resInvoke(remainingPath, method, ...args)
  //   }
  //   return Promise.reject(new Error('Child not found'))
  // }
  // resEmit(path: string[], event: string, ...args: any[]): void {
  //   const [child, remainingPath] = this.resChild(path)
  //   if (child) {
  //     if (child === this)
  //       return this.rpcEmit(event, ...args)
  //     return child.resEmit(remainingPath, event, ...args)
  //   }
  // }

  abstract path(): string[];
  abstract isReady(): boolean;

  definer(): BaseResourceDefiner<any> {
    return Object.getPrototypeOf(this)[symbolDefiner]
  }
}

export abstract class Resource<Data, Events extends BaseResourceEvent> extends BaseResource<Data, Events> {
  static readonly definers: Map<string, ResourceDefiner<Resource<any, any>>> = new Map()

  id: string
  _isReady: boolean = false

  constructor(id: string) {
    super()
    this.id = id
  }
  async resRemove() {
    await super.resRemove()
    env().resource.removeResource(this)
  }

  static define<T extends Resource<any, any>>(clazz: new (id: string) => T, key: string): ResourceDefiner<T> {
    if (this.definers.has(key)) {
      throw new Error(`Resource definer with key ${key} already exists`)
    }
    return new ResourceDefiner(clazz, key)
  }

  path(): string[] {
    return [this.definer().id(this.id)]
  }

  definer(): ResourceDefiner<any> {
    return Object.getPrototypeOf(this)[symbolDefiner]
  }

  ready(): void {
    this._isReady = true
    env().resource.ready(this)
    this.event.emit("sync")
  }
  isReady(): boolean {
    return this._isReady
  }
}

export abstract class SubResource<Data, Events extends BaseResourceEvent, Parent extends BaseResource<any, any>> extends BaseResource<Data, Events> {
  parent: Parent
  id: string

  constructor(parent: Parent, id: string) {
    super()
    this.parent = parent
    parent.subResources.set(id, this as any)
    this.id = id
  }
  refAdd(remover?: ((object: any) => void)): void {
    this.parent.refAdd(remover? () => remover(this): void 0)
  }
  refRemove(): void {
    this.parent.refRemove()
  }

  resDrop(): void {
    if (this.resDropped) return
    super.resDrop()
    this.parent.subResources.delete(this.id)
  }

  static define<T extends SubResource<any, any, any>>(clazz: new (...args: any[]) => T, key: string): SubResourceDefiner<T> {
    return new SubResourceDefiner(clazz, key)
  }

  path(): string[] {
    return [...this.parent.path(), this.id]
  }
  isReady(): boolean {
    return this.parent.isReady()
  }
}

export class BaseResourceDefiner<T extends BaseResource<any, any>> {
  constructor(public clazz: new (...args: any) => T, public key: string) {
    const parent = Object.getPrototypeOf(clazz.prototype)
    const parentMap = parent[symbolInvokeMethods] || {};
    clazz.prototype[symbolInvokeMethods] = Object.create(parentMap);
    const parentEvent = parent[symbolEmitEvents] || {};
    clazz.prototype[symbolEmitEvents] = Object.create(parentEvent);
    clazz.prototype[symbolDefiner] = this

    const _invoke = clazz.prototype.rpcInvoke
    clazz.prototype.rpcInvoke = function __filter__ (...args: any[]) {
      if (env().remote.isClient()) throw new Error("Clientside!")
      return _invoke.apply(this, args)
    }
    // const _emit = clazz.prototype.resEmit
    // clazz.prototype.rpcInvoke = function __filter__ (...args: any[]) {
    //   if (env().remote.isServer()) throw new Error("Serverside!")
    //   return _emit.apply(this, args)
    // }
  }

  invoke(key: keyof T): this {
    this.clazz.prototype[symbolInvokeMethods][key] = true
    const _method = this.clazz.prototype[key]
    // replace method
    this.clazz.prototype[key] = function __invoke__ (...args: any[]) {
      if (env().remote.isClient()) {
        return env().remote.rpcInvoke(this, key as string, ...args)
      }
      return _method.apply(this, args)
    }
    return this
  }

  emit(key: keyof (T extends BaseResource<any, infer Events>? Events: never)): this {
    this.clazz.prototype[symbolEmitEvents][key] = true
    return this
  }

  static of<T extends Resource<any, any>>(clazz: new (id: string) => T): ResourceDefiner<T> {
    return clazz.prototype[symbolDefiner]
  }
}

type Loader<T extends Resource<any, any>> = (data: string) => any /*(T extends Resource<infer D, any>? D: never)*/
type Saver<T extends Resource<any, any>> = (data: any /*(T extends Resource<infer D, any>? D: never)*/) => string

export class ResourceDefiner<T extends Resource<any, any>> extends BaseResourceDefiner<T> {
  savePath: (object: /*T*/Resource<any, any>) => string = (o) => `/obj/${o.id}.json`
  loadPath: (id: string) => string = (id) => `/obj/${id}.json`

  customLoader?: Loader<T>
  customSaver?: Saver<T>

  implementation: new (id: string) => T

  constructor(public clazz: new (id: string) => T, public key: string) {
    super(clazz, key)
    this.implementation = clazz
    Resource.definers.set(key, this as any)

    this.extendFrom(Object.getPrototypeOf(clazz.prototype))
  }

  private extendFrom(parent: any) {
    if (!parent) return
    const definer = parent[symbolDefiner]
    if (definer && definer instanceof ResourceDefiner) {
      this.savePath = definer.savePath
      this.loadPath = definer.loadPath
    } else {
      this.extendFrom(Object.getPrototypeOf(parent))
    }
  }

  static fromId(id: string): [ResourceDefiner<Resource<any, any>>, string] {
    const [type, ...rest] = id.split("@")
    return [Resource.definers.get(type)!, rest.join("@")]
  }

  init(id: string): T {
    return new this.implementation(id)
  }

  id(id: string): string {
    return this.key + "@" + id
  }

  /**
   * DO NOT FORGET release!
   * @param args 
   * @returns 
   */
  async create(...args: Parameters<T["resCreate"]>): Promise<T> 
  async create(...args: any[]): Promise<T> 
  async create(...args: Parameters<T["resCreate"]>): Promise<T> {
    if (!env().remote.isServer()) throw new Error("Only available on server side")
    return this.createWithId(Math.random().toString(), ...args)
  }

  private async createWithId(id: string, ...args: Parameters<T["resCreate"]>): Promise<T> {
    const obj = this.init(id)
    await obj.resCreate(...args)
    obj.ready()
    obj.refAdd()
    return obj
  }

  async resolve(id: string): Promise<T> {
    const o = await env().resource.resolve([this.id(id)])
    if (o != null){
      return o as T
    }
    throw new Error("Failed to request");
  }

  async loadOrCreate(id: string, ...args: Parameters<T["resCreate"]>): Promise<T> {
    if (!env().remote.isServer()) throw new Error("Only available on server side")
    const o = await env().resource.resolve([this.id(id)])
    if (o != null){
      return o as T
    }
    return await this.createWithId(id, ...args)
  }

  path(savePath: (object: T) => string, loadPath: (id: string) => string) {
    this.savePath = savePath as (object: Resource<any, any>) => string
    this.loadPath = loadPath
    return this
  }

  serializer(loader: Loader<T>, saver: Saver<T>) {
    this.customLoader = loader
    this.customSaver = saver
    return this
  }

  implement<I extends T>(impl: new (id: string) => I) {
    this.implementation = impl
    impl.prototype[symbolDefiner] = this
    return this
  }
}

class SubResourceDefiner<T extends SubResource<any, any, any>> extends BaseResourceDefiner<T> {
  constructor(public clazz: new (...args: any[]) => T, public key: string) {
    super(clazz, key)
  }
}

export type ResourceRef<T = any> = string[] | null

export function stringifyResourceRef(ref: ResourceRef) {
  return ref? ref.join("::"): "::null"
}

export abstract class ResourceManager {
  abstract loadResource(id: string): Promise<Resource<any, any> | null> // returns a owned ref, `ready` removes it
  abstract unloadResource(res: Resource<any, any>): void
  abstract removeResource(res: Resource<any, any>): void

  readonly resourceMap: Map<string, Resource<any, any>> = new Map()
  protected readonly awaitings: Map<string, ((res: Resource<any, any> | null) => void)[]> = new Map()
  protected readonly listenings: Map<string, ((res: Resource<any, any> | null) => void)[]> = new Map()

  ready(res: Resource<any, any>) {
    const id = res.path()[0]
    this.resourceMap.set(id, res)
    res.refremovers.push(() => {
      this.resourceMap.delete(id)
      if (!res.resGoingToRemove)
        this.unloadResource(res)
    })
    const awaitings = this.awaitings.get(id)
    if (awaitings) {
      awaitings.forEach((resolve) => resolve(res))
      this.awaitings.delete(id)
    }
    const listenings = this.listenings.get(id)
    if (listenings) {
      listenings.forEach(cb => cb(res))
    }
  }

  listen<R extends Resource<any, any>>(ref: ResourceRef<R>, callback: (resource: R) => void) {
    if (!ref) return
    const id = ref[0]
    if (!this.listenings.has(id))
      this.listenings.set(id, [])
    this.listenings.get(id)!.push(callback as any)
    if (this.resourceMap.has(id))
      callback(this.resourceMap.get(id) as any)
  }

  getOrNull<T>(ref: ResourceRef<T> | null): T | null {
    if (!ref || ref.length != 1) return null
    return this.resourceMap.get(ref[0]) as T ?? null
  }

  private async getResource(id: string): Promise<Resource<any, any> | null> {
    if (this.resourceMap.has(id)) return this.resourceMap.get(id)!
    if (this.awaitings.has(id)) {
      // console.log("A-> ", id)
      return new Promise((resolve) => {
        this.awaitings.get(id)!.push(resolve)
      })
    }
    // console.log("L-> ", id)
    this.awaitings.set(id, [])
    void this.loadResource(id)
      .then(r => {
        if (r?.resDropped) throw new Error("Returning something already dropped!");
        // console.log("D-> ", id, r? "Some": "None")
        if (r == null){
          this.awaitings.get(id)!.forEach(res => res(null))
          this.awaitings.delete(id)
        }
      }) // resource calls ready
    return new Promise((resolve) => {
      this.awaitings.get(id)!.push(resolve)
    })
  }

  /**
   * DO NOT FORGET release!
   */
  async resolve<T extends BaseResource<any, any>>(path: ResourceRef<T>,
      refadd: boolean | ((obj: any) => void) = true): Promise<T | null> {
    // console.log("--> ", stringifyResourceRef(path))
    if (path == null) return null
    const [first, ...rest] = path
    const res = await this.getResource(first)
    // console.log("--> ", stringifyResourceRef(path), res? "Some": "None")
    if (!res) return null
    if (refadd) res.refAdd(typeof(refadd) == "function"? refadd: void 0)
    const [ret, left] = res.resChild(rest)
    if (left.length != 0) debugger;
    // console.log("--> ", stringifyResourceRef(path), " -> ", ret? "Some": "None", left)
    return ret as T
  }
  ref<T extends BaseResource<any, any>>(resource: T | null): ResourceRef<T> {
    if (resource == null) return null
    return resource.path()
  }
}

export function freeResourcesInObject(o: any) {
  if (o instanceof BaseResource) {
    o.refRemove()
    return
  }
  const def = env().getSpecialDef(o)
  if (def) {
    def.freeInside(o)
    return
  }
  if (Array.isArray(o)) {
    o.forEach(i => freeResourcesInObject(i))
    return
  }
  for (const k in o) {
    if (typeof(o[k]) == "object") {
      freeResourcesInObject(o[k])
    }
  }
}
