type SidebarActionType = 'action-btn'

export type SidebarInfo = {
  label: string
  default: boolean
  order: number
  showOnMenu: boolean
  projectName: string
  type?: SidebarActionType

  normalIcon?: any
  activeIcon?: any
}
