import { post } from '@x-oasis/node-fetch-json'
// import { session } from 'electron'
import { buildCookie } from './util'
import type { AccountInfo } from '../electron-main/types'
import { EDITH_HOST, IM_HOST, SSO_HOST } from './config'

export async function queryTicket(payload: Record<string, string>): Promise<{ ticket: string }> {
  // data ===  {
  //   ticket: 'ST-a519554a02de371b58d4065ea6635a0c',
  //   userId: '5b0bbfcb6ae2d82d1d65c225',
  //   thumbAvatar: 'https://wework.qpic.cn/wwpic3az/299161_MvRe_WSQSUW9y3t_1703138627/100',
  //   authToken: '2367bf048f8847e19dd836c0baa72796-22ea6f8d682b46d69f3227e050264447'
  // }
  return post(`${SSO_HOST}/api/cas/login`, {
    email: payload.username,
    password: payload.password,
    service: IM_HOST,
  })
}

// 二次验证
export async function queryTicketByOPT(
  payload: Record<string, string>
): Promise<{ ticket: string }> {
  // data ===  {
  //   ticket: 'ST-a519554a02de371b58d4065ea6635a0c',
  // }
  return post(`${SSO_HOST}/api/cas/loginTotp`, {
    code: payload.code,
    email: payload.username,
    login_service: IM_HOST,
    remember_device: false,
    renew: false,
  })
}

export async function queryUserInfo(ticket: string): Promise<AccountInfo> {
  if (ticket) {
    try {
      const res = await post(`${EDITH_HOST}/sso/internal_login`, {
        ticket,
        validate_service: IM_HOST,
        subsystem_alias: 'redim',
        set_global_domain: true,
        token_used_as_universally: true,
      })

      // [
      //   'acw_tc=46a3374359663c2b4e3f8ca829588c8f1a632b1df4d6d9b4a5d0bb627b38aa39;path=/;HttpOnly;Max-Age=1800',
      //   'access-token-edith.sit.xiaohongshu.com=internal.redim.AT-adc9b87c58e2436992255fbb107bc6f0-8db9fa31733d4f49ba58012476dd3473; Path=/; Domain=xiaohongshu.com; Max-Age=31536000; HttpOnly',
      //   'x-user-id=5b0bbfcb6ae2d82d1d65c225; Path=/; Domain=xiaohongshu.com; Max-Age=604800; HttpOnly',
      //   'x-user-id-edith.sit.xiaohongshu.com=5b0bbfcb6ae2d82d1d65c225; Path=/; Domain=xiaohongshu.com; Max-Age=604800; HttpOnly',
      //   'common-internal-access-token-sit=AT-adc9b87c58e2436992255fbb107bc6f0-8db9fa31733d4f49ba58012476dd3473; Path=/; Domain=xiaohongshu.com; Max-Age=31536000; HttpOnly'
      // ]
      const cookie = buildCookie(res.raw?.headers.raw()['set-cookie'])
      // @ts-ignore
      res.cookie = cookie
      res.ticket = ticket
      res.isCurrent = true

      return res
    } catch (err) {
      console.error('[query user info error] ', err)
    }
  }

  return {}
}

export async function login(payload: Record<string, string>): Promise<any> {
  const data: { ticket: string } = await queryTicket(payload)
  return queryUserInfo(data?.ticket)
}

export async function loginTotp(payload: Record<string, any>): Promise<any> {
  const data: { ticket: string } = await queryTicketByOPT(payload)
  console.log(data, 'data888')
  return queryUserInfo(data?.ticket)
}
