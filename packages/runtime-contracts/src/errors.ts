/** Structured failure surfaced on the runtime event stream (not necessarily thrown). */
export interface RuntimeError {
  code: string
  message: string
  details?: unknown
}
