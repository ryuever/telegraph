const parseCookie = (cookieStr: string): Record<string, string | boolean> => {
  if (typeof cookieStr !== 'string') return {}
  const kvArr = cookieStr.split(';')
  const result: Record<string, string | boolean> = {}
  kvArr.reduce((prev, cur) => {
    const [key, value] = cur.split('=')
    if (!prev.name) {
      prev.name = key.trim()
      prev.value = value.trim()
    } else if (value) {
      prev[key.trim()] = value.trim()
    } else {
      prev[key.trim()] = true
    }
    return prev
  }, result)
  return result
}

export const buildCookie = (value: any) => {
  // // 获取 set-cookie
  // const setCookie = res.headers.raw()['set-cookie']

  // 解析 set-cookie
  const cookieObjArr = value.map(c => parseCookie(c))
  // console.log(setCookie, cookieObjArr, 'cookieObj')

  // 先临时设置到全局变量中
  const cookies = cookieObjArr.map(c => `${c.name}=${c.value}`).join('; ')

  return cookies
}
