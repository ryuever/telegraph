import fetch from 'node-fetch'
import type { Response } from 'node-fetch'

type AnyJson = Record<string, any>

export async function post(url: string, body: AnyJson, init: AnyJson = {}): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: JSON.stringify(body),
    ...init,
  })
  return decorate(res)
}

export async function get(url: string, init: AnyJson = {}): Promise<any> {
  const res = await fetch(url, { method: 'GET', ...init })
  return decorate(res)
}

async function decorate(res: Response): Promise<any> {
  let data: any
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { text }
  }
  if (data === null || typeof data !== 'object') data = { value: data }
  data.raw = res
  return data
}
