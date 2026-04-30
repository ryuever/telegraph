import { injectable, createId } from '@x-oasis/di'
import { resolve } from 'path'
import type { LoadFileOptions, LoadURLOptions } from 'electron'
import { flatten } from '@app/core/common/utilities/url'
import { Uri, toUri } from '../common'
import type { FileAccessProps, IAlias } from './types/fileAccess'

const aliasReg = /^(@[^/]+)/

export const FileAccessId = createId('file-access')

@injectable()
export class FileAccess {
  private _alias = new Map<string, string>()

  constructor(props: FileAccessProps) {
    const { alias = {} } = props
    this.initAlias(alias)
  }

  initAlias(alias: IAlias = {}) {
    Object.keys(alias).forEach(key => {
      const value = alias[key]
      this._alias.set(key, value)
    })
  }

  startWithAlias(path: string) {
    const matched = path.match(aliasReg)
    if (matched && !matched.index)
      return {
        matched: true,
        key: matched[1],
      }

    return { matched: false }
  }

  asLoadUri(path?: string) {
    const aliasValue = this._alias.get('@dev')
    if (!path) return aliasValue || ''
    const nextPath = /^\//i.test(path) ? path : `/${path}`
    return aliasValue ? `${aliasValue}${nextPath}` : path
  }

  asLoadURL(
    path: string,
    options: {
      query?: {
        [key: string]: string
      }
      search?: string
    } = {}
  ): [string, LoadURLOptions] {
    const [_path, _search = ''] = (path || '').split('?')
    const userQuery = options.query
    const userSearch = options.search

    const trimedPath = _path.replace(/^\//, '')

    const searchGroup: string[] = []

    if (_search) searchGroup.unshift(_search)

    const flattenUserSearch = flatten(userQuery)
    if (flattenUserSearch) searchGroup.unshift(flattenUserSearch)
    if (userSearch) searchGroup.unshift(userSearch)

    const search = searchGroup.length ? `${searchGroup.join('&')}` : ''

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return [`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/#/${trimedPath}${search ? '?' : ''}${search}`, {}]
    }

    return [
      resolve(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      {
        hash: trimedPath,
        search,
      } as LoadFileOptions as any as LoadURLOptions,
    ]
  }

  toUri(path: string) {
    const matchedAlias = this.startWithAlias(path)
    if (matchedAlias.matched) {
      const aliasKey = matchedAlias.key
      const aliasValue = this._alias.get(aliasKey)
      if (aliasValue) {
        return path.replace(aliasKey, aliasValue)
      }
    }
    return path
    // todo-----
  }

  asFileUri(path: string | Uri): Uri {
    if (path instanceof Uri) return path
    const uri = this.toUri(path)
    return Uri.parse(toUri(uri))
  }
}
