import { createId } from '@x-oasis/di'

export const servicePath = '/services/account'
export const AccountClient = createId('account-client')

// sso域名地址
export const SSO_HOST =
  process.env.NODE_ENV === 'development'
    ? 'https://login2.sit.xiaohongshu.com'
    : 'https://login2.xiaohongshu.com'

// 一票通行域名
export const EDITH_HOST =
  process.env.NODE_ENV === 'development'
    ? 'https://edith.sit.xiaohongshu.com'
    : 'https://edith.xiaohongshu.com'

// IM域名地址，sso登录传的service参数需要和一票通行validate_service一致，否则会校验不通过
export const IM_HOST = 'https://redim.xiaohongshu.com'

// sso企微应用的agentId 1000502 for sit, 1000040 for prod
export const SSOAgentId = process.env.NODE_ENV === 'development' ? 1000502 : 1000040

// 企微应用的corpid
export const WxAppId = 'wx2a4a6c713327df27'
