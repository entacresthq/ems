/** Deep snake_case ↔ camelCase key conversion for API payloads. */

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

export function camelToSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function convertKeys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => convertKeys(v, convert))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[convert(k)] = convertKeys(v, convert)
    return out
  }
  return value
}

export function keysToCamel(value: unknown): unknown {
  return convertKeys(value, snakeToCamel)
}

export function keysToSnake(value: unknown): unknown {
  return convertKeys(value, camelToSnake)
}
