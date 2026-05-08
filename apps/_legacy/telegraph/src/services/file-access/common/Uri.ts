// http://tools.ietf.org/html/rfc3986#section-3

import { URL } from 'url'
import type { IURI } from './types'

export default class Uri implements IURI {
  scheme: string

  authority: string

  path: string

  query: string

  fragment?: string

  static parse(value: string, _strict: boolean = false): Uri {
    const parsed = new URL(value)
    const { protocol = '', host = '', pathname = '', search = '', hash = '' } = parsed

    return new Uri(
      protocol.replace(/:$/, ''),
      host,
      pathname,
      search.replace(/^\?/, ''),
      hash.replace(/^#/, '')
    )
  }

  constructor(
    scheme: string,
    authority?: string,
    path?: string,
    query?: string,
    fragment?: string,
    _strict?: boolean
  ) {
    this.scheme = scheme
    this.authority = authority
    this.path = path
    this.query = query
    this.fragment = fragment
  }

  get fsPath() {
    if (this.scheme === 'file') {
      return `${this.authority}${this.path}`
    }

    let url = `${this.scheme}://${this.authority}${this.path}`

    if (this.query) url += `?${this.query}`
    if (this.fragment) url += `#${this.fragment}`
    return url
  }
}
