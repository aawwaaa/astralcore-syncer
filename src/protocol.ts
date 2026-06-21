import { resourceEnvironment } from "./environment.js";
import { BaseResource, type ResourceRef } from "./object.js";

export interface WebSocketMessageBase {
  command: string;
}

export interface WebSocketMessageConnect extends WebSocketMessageBase {
  command: "connect";
  id: string; // should be unique to client
  loadedResources: ResourceRef[]
}
export interface WebSocketMessageEstablished extends WebSocketMessageBase {
  command: "established";
  id: string; // should be unique to client
}
export interface WebSocketMessageFatalError extends WebSocketMessageBase {
  command: "fatal_error";
  message: string;
}

const symbolTypedValueData = Symbol.for("typedValueData")

export type TypedValue = {
  type: "basic",
  value: number | string | boolean | null
} | {
  type: "void"
} | {
  type: "error",
  value: string
} | {
  type: "array",
  value: TypedValue[]
} | {
  type: "dict",
  value: Record<string, TypedValue>
} | {
  type: "resource",
  value: ResourceRef
} | {
  type: "special",
  key: string,
  value: any
} | {
  [symbolTypedValueData]: boolean,
  type: "data",
  value: any
}

export interface WebSocketMessageInvoke extends WebSocketMessageBase {
  command: "invoke";
  resource: ResourceRef;
  method: string;
  args: Extract<TypedValue, { type: "array" }>;
  id: string;
}
export interface WebSocketMessageInvokeResponse extends WebSocketMessageBase {
  command: "invoke_response";
  id: string;
  result: TypedValue;
  isError: boolean; // if isError, result = anything thrown
}

export interface WebSocketMessageEmit extends WebSocketMessageBase {
  command: "emit";
  resource: ResourceRef; // for those requested resource and not unloaded
  event: string;
  data: Extract<TypedValue, { type: "array" }>;
}

export interface WebSocketMessageResourceRequest extends WebSocketMessageBase {
  command: "resource_request";
  resources: ResourceRef[];
}
export interface WebSocketMessageResourceUnloaded extends WebSocketMessageBase {
  command: "resource_unloaded";
  resources: ResourceRef[];
}

export interface WebSocketMessageResource extends WebSocketMessageBase {
  command: "resource";
  ref: ResourceRef;
  exists: boolean;
  data: unknown; // saved data by resource, depends by the instance
}

export interface WebSocketMessagePing extends WebSocketMessageBase {
  command: "ping";
  id: string;
}
export interface WebSocketMessagePong extends WebSocketMessageBase {
  command: "pong";
  id: string;
}

export type WebSocketMessageClient2Server =
  | WebSocketMessageConnect
  | WebSocketMessageInvoke
  | WebSocketMessageResourceRequest
  | WebSocketMessageResourceUnloaded
  | WebSocketMessagePing 

export type WebSocketMessageServer2Client =
  | WebSocketMessageEstablished
  | WebSocketMessageInvokeResponse
  | WebSocketMessageEmit
  | WebSocketMessageResource
  | WebSocketMessagePong
  | WebSocketMessageFatalError

export function typedValuePack(value: any): TypedValue {
  if (typeof(value) == "undefined") {
    return {
      type: "void"
    }
  }
  if (["boolean", "string", "number"].includes(typeof(value))) {
    return {
      type: "basic",
      value: value satisfies boolean | string | number
    }
  }
  if (value === null) {
    return {
      type: "basic",
      value: null
    }
  }
  if (value instanceof Error) {
    console.log("An error is going to be packed, maybe something wrong: ", value)
    return {
      type: "error",
      value: `${value.name}: ${value.message}`
    }
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      value: value.map(a => typedValuePack(a))
    }
  }
  if (value instanceof BaseResource) {
    return {
      type: "resource",
      value: value.path()
    }
  }
  const def = resourceEnvironment().getSpecialDef(value)
  if (def) {
    return {
      type: "special",
      key: def.key(),
      value: def.pack(value)
    }
  }
  if (typeof(value) == "object") {
    if (value[symbolTypedValueData]) {
      return value
    }
    return {
      type: "dict",
      value: Object.fromEntries(Object.entries(value)
        .map(([k, v]) => [k, typedValuePack(v)]))
    }
  }
  throw new Error("Unable to pack value: " + value + " with type " + typeof(value))
}

export function typedValuePackData(value: any): Extract<TypedValue, {"type": "data"}> {
  const u = {
    [symbolTypedValueData]: true,
    type: "data",
    value
  }
  return u as any
}

export async function typedValueUnpack(tv: TypedValue): Promise<any> {
  switch (tv.type) {
    case "basic":
      return tv.value

    case "void":
      return void 0

    case "error":
      // 可以选择还原为 Error 对象（保留语义），也可直接返回字符串
      return new Error(tv.value)

    case "array":
      // 并行解包所有数组元素
      return Promise.all(tv.value.map(item => typedValueUnpack(item)))

    case "resource":
      return resourceEnvironment().resource.resolve(tv.value)

    case "dict": {
      const entries = Object.entries(tv.value)
      const unpackedEntries = await Promise.all(
        entries.map(async ([key, val]) => [key, await typedValueUnpack(val)] as const)
      )
      return Object.fromEntries(unpackedEntries)
    }
    case "special": {
      const def = resourceEnvironment().getSpecialDefFor(tv.key)
      if (!def) {
        throw new Error(`Unknown special type: ${tv.key}`)
      }
      return await def.unpack(tv.value)
    }
    case "data":
      return tv.value

    default:
      // 类型穷尽检查（如果 TypedValue 是完备的联合类型）
      const _exhaustive: never = tv
      throw new Error(`Unknown TypedValue type: ${(_exhaustive as any).type}`)
  }
}