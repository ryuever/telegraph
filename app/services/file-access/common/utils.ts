export function toUri(str: string) {
  // /usr/local -> file:///usr/local
  if (/^\//.test(str)) return `file://${str}`

  // todo ....

  return str
}

const _rEncodedAsHex = /(%[0-9A-Za-z][0-9A-Za-z])+/g

function decodeURIComponentGraceful(str: string): string {
  try {
    return decodeURIComponent(str)
  } catch {
    if (str.length > 3) {
      return str.substr(0, 3) + decodeURIComponentGraceful(str.substr(3))
    }
    return str
  }
}

export function percentDecode(str: string): string {
  if (!str.match(_rEncodedAsHex)) {
    return str
  }
  return str.replace(_rEncodedAsHex, match => decodeURIComponentGraceful(match))
}
