import { ResourceManager } from "./object.js";
import { RemoteManager } from "./remote.js";

export class ResourceEnvironment {
  constructor(
    public remote: RemoteManager,
    public resource: ResourceManager
  ) {}
  
  specialObjects: SpecialObjectDefinition<any, any>[] = []
  registerSpecial(def: SpecialObjectDefinition<any, any>) {
    this.specialObjects.push(def)
  }

  getSpecialDef<T>(obj: T): SpecialObjectDefinition<T, any> | null {
    return this.specialObjects.find(a => a.matches(obj)) as SpecialObjectDefinition<T, any> ?? null
  }
  getSpecialDefFor(key: string): SpecialObjectDefinition<any, any> | null {
    return this.specialObjects.find(a => a.key() === key) ?? null
  }
}

export interface SpecialObjectDefinition<T, D> {
  key(): string
  matches(o: any): o is T

  pack(obj: T): D
  unpack(data: D): T | Promise<T>

  freeInside(obj: T): void
}

let _impl: () => ResourceEnvironment = () => { throw new Error("No resource environment implementation") }

export function resourceEnvironment(): ResourceEnvironment {
  return _impl()
}

export function resourceEnvironmentSetImpl(f: () => ResourceEnvironment): void {
  _impl = f
}