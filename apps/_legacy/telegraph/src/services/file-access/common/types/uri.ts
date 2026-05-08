export interface IURI {
  scheme: string
  authority?: string
  path?: string
  query?: string
  fragment?: string
}
