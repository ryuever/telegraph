export type UserInfo = {
  [key: string]: any
}
export type AccountInfo = {
  ticket: string
  userId: string
  thumbAvatar: string
  authToken: string
  email?: string
}

// {
//   ssoType: 'internal',
//   name: '刘友超',
//   email: 'youchaoliu@xiaohongshu.com',
//   emailAlias: 'zefa@xiaohongshu.com',
//   accountNo: '7912354481',
//   accountType: 'SECONDARY',
//   permissions: [],
//   accessToken: 'AT-30eb7036cb524236bdd1c7200d679117-859e33dc43234d6a8f0fb69bd543640f',
//   userId: '5b0bbfcb6ae2d82d1d65c225',
//   primaryAccountNo: '3523023549',
//   avatar: 'https://wework.qpic.cn/wwpic3az/299161_MvRe_WSQSUW9y3t_1703138627/0',
//   thumbAvatar: 'https://wework.qpic.cn/wwpic3az/299161_MvRe_WSQSUW9y3t_1703138627/100',
//   mobile: '',
//   subsystem: 'redim',
//   userNameAlias: '泽法',
//   deactivated: false,
//   cookie: 'acw_tc=7fab17d917e8df17279d33612d6398b5da5284c2c36189a726ae5669dd622484; access-token-edith.sit.xiaohongshu.com=internal.redim.AT-30eb7036cb524236bdd1c7200d679117-859e33dc43234d6a8f0fb69bd543640f; x-user-id=5b0bbfcb6ae2d82d1d65c225; x-user-id-edith.sit.xiaohongshu.com=5b0bbfcb6ae2d82d1d65c225; common-internal-access-token-sit=AT-30eb7036cb524236bdd1c7200d679117-859e33dc43234d6a8f0fb69bd543640f'
// }
export type LoginInfo = {
  ticket: string
  name: string
  email: string
  emailAlias: string
  accountNo: string
  accessToken: string
  userId: string
  avatar: string
  thumbAvatar: string
  userNameAlias: string
  cookie: string
}
