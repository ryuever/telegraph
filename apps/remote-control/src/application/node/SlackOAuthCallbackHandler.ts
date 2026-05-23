import type {
  SlackOAuthCallbackInput,
  SlackOAuthCallbackResult,
  SlackTeamRole,
} from '@/apps/remote-control/application/common'
import type { SlackTeamGovernance } from './SlackTeamGovernance'

export interface SlackOAuthExchangeInput {
  code: string
  redirectUri?: string
  state?: string
}

export interface SlackOAuthTeam {
  id?: string
  name?: string
  domain?: string
}

export interface SlackOAuthAuthedUser {
  id?: string
  access_token?: string
  scope?: string
}

export interface SlackOAuthAccessResponse {
  ok: boolean
  error?: string
  access_token?: string
  scope?: string
  app_id?: string
  bot_user_id?: string
  team?: SlackOAuthTeam
  enterprise?: { id?: string }
  authed_user?: SlackOAuthAuthedUser
}

export interface SlackOAuthExchangeClient {
  exchangeCode(input: SlackOAuthExchangeInput): Promise<SlackOAuthAccessResponse>
}

export interface SlackOAuthTokenSecretInput {
  workspaceId: string
  kind: 'bot' | 'user'
  token: string
  ownerId?: string
  scopes: string[]
}

export interface SlackOAuthTokenSecretStore {
  storeToken(input: SlackOAuthTokenSecretInput): Promise<string>
}

export class SlackOAuthCallbackHandler {
  constructor(
    private readonly governance: SlackTeamGovernance,
    private readonly exchangeClient: SlackOAuthExchangeClient,
    private readonly secretStore: SlackOAuthTokenSecretStore = new RefOnlySlackOAuthTokenSecretStore(),
  ) {}

  async handle(input: SlackOAuthCallbackInput): Promise<SlackOAuthCallbackResult> {
    const response = await this.exchangeClient.exchangeCode({
      code: input.code,
      redirectUri: input.redirectUri,
      state: input.state,
    })
    if (!response.ok) {
      throw new Error(`Slack OAuth callback failed: ${response.error ?? 'unknown_error'}`)
    }
    const workspaceId = response.team?.id
    if (!workspaceId) throw new Error('Slack OAuth callback did not include team.id')

    const scopes = uniqueScopes(response.scope, response.authed_user?.scope)
    const botTokenRef = response.access_token
      ? await this.secretStore.storeToken({
        workspaceId,
        kind: 'bot',
        token: response.access_token,
        ownerId: response.bot_user_id,
        scopes,
      })
      : undefined
    const userTokenRef = response.authed_user?.access_token
      ? await this.secretStore.storeToken({
        workspaceId,
        kind: 'user',
        token: response.authed_user.access_token,
        ownerId: response.authed_user.id,
        scopes,
      })
      : undefined

    const installation = this.governance.createAppInstallation({
      workspaceId,
      teamDomain: response.team?.domain ?? response.team?.name,
      enterpriseId: response.enterprise?.id,
      appId: response.app_id,
      botUserId: response.bot_user_id,
      botTokenRef,
      userTokenRef,
      scopes,
      installedByUserId: response.authed_user?.id,
      installerRole: input.installerRole ?? defaultInstallerRole(response.authed_user?.id),
      policyProfileId: input.policyProfileId,
      now: input.now,
    })

    return {
      installation,
      tokenRefs: {
        botTokenRef,
        userTokenRef,
      },
    }
  }
}

export interface SlackWebOAuthExchangeClientOptions {
  clientId: string
  clientSecret: string
  apiBaseUrl?: string
  fetch?: typeof fetch
}

export class SlackWebOAuthExchangeClient implements SlackOAuthExchangeClient {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: SlackWebOAuthExchangeClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
  }

  async exchangeCode(input: SlackOAuthExchangeInput): Promise<SlackOAuthAccessResponse> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code: input.code,
    })
    if (input.redirectUri) body.set('redirect_uri', input.redirectUri)
    const response = await this.fetchImpl(`${this.options.apiBaseUrl ?? 'https://slack.com/api'}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    return await response.json() as SlackOAuthAccessResponse
  }
}

export class RefOnlySlackOAuthTokenSecretStore implements SlackOAuthTokenSecretStore {
  storeToken(input: SlackOAuthTokenSecretInput): Promise<string> {
    const owner = input.ownerId ? `/${encodeURIComponent(input.ownerId)}` : ''
    return Promise.resolve(`secret://slack/${encodeURIComponent(input.workspaceId)}/${input.kind}${owner}`)
  }
}

export function createSlackOAuthCallbackHandlerFromEnv(
  governance: SlackTeamGovernance,
  env: NodeJS.ProcessEnv = process.env,
): SlackOAuthCallbackHandler | null {
  const clientId = env.TELEGRAPH_SLACK_CLIENT_ID
  const clientSecret = env.TELEGRAPH_SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return new SlackOAuthCallbackHandler(
    governance,
    new SlackWebOAuthExchangeClient({
      clientId,
      clientSecret,
      apiBaseUrl: env.TELEGRAPH_SLACK_API_BASE_URL,
    }),
  )
}

function uniqueScopes(...values: Array<string | undefined>): string[] {
  return Array.from(new Set(
    values
      .flatMap(value => value?.split(',') ?? [])
      .map(value => value.trim())
      .filter(Boolean),
  ))
}

function defaultInstallerRole(userId: string | undefined): SlackTeamRole | undefined {
  return userId ? 'admin' : undefined
}
