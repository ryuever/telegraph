export const flatten = (params: { [key: string]: string }) => {
  if (!params) return ''
  const keys = Object.keys(params)
  return (keys || []).reduce((acc, cur, index) => {
    if (index) return `${acc}&${cur}=${String(params[cur])}`
    return `${cur}=${String(params[cur])}`
  }, '')
}

export const setSearchParams = (
  url: string,
  params: {
    [key: string]: string
  }
) => {
  if (/\?/.test(url)) {
    return `${url}&${flatten(params)}`
  }

  return `${url}?${flatten(params)}`
}
