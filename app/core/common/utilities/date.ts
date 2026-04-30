const numberPadding = (num: number, padding = 2) => `${'0'.repeat(padding)}${num}`.slice(-padding)

export function format(str: string, date: Date) {
  if (date instanceof Date) {
    const year = `${date.getFullYear()}`
    const month = numberPadding(date.getMonth() + 1)
    const day = numberPadding(date.getDate())

    const hour = numberPadding(date.getHours())
    const minute = numberPadding(date.getMinutes())
    const second = numberPadding(date.getSeconds())

    const millSecond = numberPadding(date.getMilliseconds(), 3)

    return str
      .replace(/yyyy/i, year)
      .replace('MM', month)
      .replace('dd', day)
      .replace(/HH/i, hour)
      .replace('mm', minute)
      .replace('ss', second)
      .replace(/sss/i, millSecond)
  }
}
