/**
 * JSON+ Serializer — handles JavaScript-specific types beyond standard JSON.
 *
 * Supports: Set, Map, RegExp, Error, Uint8Array, undefined, Send objects.
 * Does NOT depend on any external libraries (no @langchain/core).
 */

import type { SerializerProtocol } from "./base.js";
import { stringify } from "./utils/fast-safe-stringify.js";

/**
 * Reviver for JSON+ deserialization. Recursively processes objects
 * to restore special JavaScript types from their serialized form.
 */
async function _reviver(value: unknown): Promise<unknown> {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => _reviver(item)));
    }

    const obj = value as Record<string, unknown>;
    const revivedObj: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      revivedObj[k] = await _reviver(v);
    }

    // Handle undefined marker
    if (revivedObj.lc === 2 && revivedObj.type === "undefined") {
      return undefined;
    }

    // Handle constructor-based types
    if (
      revivedObj.lc === 2 &&
      revivedObj.type === "constructor" &&
      Array.isArray(revivedObj.id)
    ) {
      try {
        const constructorName = (revivedObj.id as string[])[
          (revivedObj.id as string[]).length - 1
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let constructor: any;

        switch (constructorName) {
          case "Set":
            constructor = Set;
            break;
          case "Map":
            constructor = Map;
            break;
          case "RegExp":
            constructor = RegExp;
            break;
          case "Error":
            constructor = Error;
            break;
          case "Uint8Array":
            constructor = Uint8Array;
            break;
          default:
            return revivedObj;
        }

        if (revivedObj.method) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (constructor as any)[revivedObj.method as string](
            ...((revivedObj.args as unknown[]) || [])
          );
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return new (constructor as any)(
            ...((revivedObj.args as unknown[]) || [])
          );
        }
      } catch {
        return revivedObj;
      }
    }

    return revivedObj;
  }
  return value;
}

/**
 * Encode a constructor call for serialization.
 */
function _encodeConstructorArgs(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  constructor: Function,
  method?: string,
  args?: unknown[],
  kwargs?: Record<string, unknown>
): object {
  return {
    lc: 2,
    type: "constructor",
    id: [constructor.name],
    method: method ?? null,
    args: args ?? [],
    kwargs: kwargs ?? {},
  };
}

/**
 * Default replacer for special JavaScript types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _default(obj: any): any {
  if (obj === undefined) {
    return { lc: 2, type: "undefined" };
  } else if (obj instanceof Set || obj instanceof Map) {
    return _encodeConstructorArgs(obj.constructor, undefined, [
      Array.from(obj),
    ]);
  } else if (obj instanceof RegExp) {
    return _encodeConstructorArgs(RegExp, undefined, [obj.source, obj.flags]);
  } else if (obj instanceof Error) {
    return _encodeConstructorArgs(obj.constructor, undefined, [obj.message]);
  } else if (obj?.lg_name === "Send") {
    return { node: obj.node, args: obj.args };
  } else if (obj instanceof Uint8Array) {
    return _encodeConstructorArgs(Uint8Array, "from", [Array.from(obj)]);
  } else {
    return obj;
  }
}

/**
 * JSON+ Serializer implementation.
 * Handles JavaScript-specific types (Set, Map, RegExp, Error, Uint8Array, undefined).
 * Zero external dependencies.
 */
export class JsonPlusSerializer implements SerializerProtocol {
  protected _dumps(obj: unknown): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stringify(obj, (_: string, value: any) => {
        return _default(value);
      })
    );
  }

  async dumpsTyped(obj: unknown): Promise<[string, Uint8Array]> {
    if (obj instanceof Uint8Array) {
      return ["bytes", obj];
    } else {
      return ["json", this._dumps(obj)];
    }
  }

  protected async _loads(data: string): Promise<unknown> {
    const parsed = JSON.parse(data);
    return _reviver(parsed);
  }

  async loadsTyped(type: string, data: Uint8Array | string): Promise<unknown> {
    if (type === "bytes") {
      return typeof data === "string" ? new TextEncoder().encode(data) : data;
    } else if (type === "json") {
      return this._loads(
        typeof data === "string" ? data : new TextDecoder().decode(data)
      );
    } else {
      throw new Error(`Unknown serialization type: ${type}`);
    }
  }
}
