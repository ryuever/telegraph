/**
 * UUID generation utilities — zero-dependency implementation.
 *
 * Provides UUID v6-like (time-ordered) identifiers for checkpoint ordering.
 * Uses a monotonic counter to ensure strict ordering even within the same
 * millisecond.
 */

/** Monotonic counter to ensure ordering within the same millisecond. */
let _lastTime = 0;
let _counter = 0;

/**
 * Generate a time-ordered UUID suitable for checkpoint identification.
 *
 * This is a simplified UUID v6 alternative that:
 * - Uses timestamp + monotonic counter for strict ordering
 * - Includes random bits for uniqueness
 * - Does not require the `uuid` npm package
 *
 * Format: `TTTTTTTT-TTTT-6CCC-RRRR-RRRRRRRRRRRR`
 * where T = timestamp hex, C = counter hex, R = random hex
 *
 * @param clockseq - Clock sequence (negative values for initial checkpoints)
 */
export function uuid6(clockseq: number): string {
  // Use current timestamp in milliseconds, adjusted by clockseq
  const now = Date.now();
  const adjusted = now + clockseq;

  // Monotonic counter to guarantee ordering
  if (adjusted <= _lastTime) {
    _counter++;
  } else {
    _counter = 0;
    _lastTime = adjusted;
  }

  // Convert timestamp to hex (12 hex chars = 48 bits)
  const timeHex = Math.abs(adjusted).toString(16).padStart(12, "0");

  // Counter as 4 hex chars (ensures ordering within same ms)
  const counterHex = _counter.toString(16).padStart(4, "0");

  // Generate random portion (12 hex chars = 48 bits)
  const randomHex = _randomHex(12);

  // Format as UUID-like string
  // TTTTTTTT-TTTT-6CCC-RRRR-RRRRRRRRRRRR
  const sign = adjusted < 0 ? "0" : "1";
  return [
    timeHex.slice(0, 8),
    timeHex.slice(8, 12),
    `6${sign}${counterHex.slice(0, 2)}`,
    counterHex.slice(2, 4) + randomHex.slice(0, 2),
    randomHex.slice(2, 14),
  ].join("-");
}

/**
 * Generate a deterministic UUID v5-like identifier from a name and namespace.
 * Uses a simple hash-based approach without the `uuid` npm package.
 */
export function uuid5(name: string, namespace: string): string {
  // Simple FNV-1a-like hash for deterministic UUIDs
  const input = namespace.replace(/-/g, "") + name;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }

  const hex =
    h1.toString(16).padStart(8, "0") +
    h2.toString(16).padStart(8, "0") +
    (h1 ^ h2).toString(16).padStart(8, "0") +
    (h1 + h2).toString(16).padStart(8, "0");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Generate random hexadecimal string of given length.
 */
function _randomHex(length: number): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    // Use crypto.randomUUID and extract hex digits
    const uuid = crypto.randomUUID().replace(/-/g, "");
    if (uuid.length >= length) {
      return uuid.slice(0, length);
    }
  }

  // Fallback: Math.random-based
  let result = "";
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}
