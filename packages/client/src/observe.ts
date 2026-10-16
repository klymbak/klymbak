/**
 * Wraps a plain object graph so that every write, at any depth, calls `onChange`.
 *
 * The transcript reducer mutates messages in place, which Vue tracks on its own. This gives
 * frameworks without deep reactivity (React, Svelte stores, plain DOM code) the same signal.
 * Arrays and plain objects are proxied lazily as they are read; anything else is returned as is.
 */
export function observe<T extends object>(target: T, onChange: () => void): T {
  const proxies = new WeakMap<object, object>();
  const targets = new WeakMap<object, object>();

  const wrap = (value: unknown): unknown => {
    if (!isPlain(value) || targets.has(value)) return value;
    let proxy = proxies.get(value);
    if (!proxy) {
      proxy = new Proxy(value, handler);
      proxies.set(value, proxy);
      targets.set(proxy, value);
    }
    return proxy;
  };

  // Store raw objects, so a value read from the state and written back isn't proxied twice.
  const unwrap = (value: unknown): unknown => (typeof value === "object" && value !== null ? (targets.get(value) ?? value) : value);

  const handler: ProxyHandler<object> = {
    get: (object, key) => wrap(Reflect.get(object, key)),
    set(object, key, value) {
      const next = unwrap(value);
      const existed = Object.hasOwn(object, key);
      const previous = Reflect.get(object, key);
      if (!Reflect.set(object, key, next)) return false;
      if (!existed || !Object.is(previous, next)) onChange();
      return true;
    },
    deleteProperty(object, key) {
      const existed = Object.hasOwn(object, key);
      if (!Reflect.deleteProperty(object, key)) return false;
      if (existed) onChange();
      return true;
    },
  };

  return wrap(target) as T;
}

function isPlain(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}
