import { describe, expect, it } from 'vitest'
import { SlackTeamGovernance } from '../SlackTeamGovernance'
import {
  SlackOAuthCallbackHandler,
  type SlackOAuthExchangeClient,
  type SlackOAuthTokenSecretInput,
  type SlackOAuthTokenSecretStore,
} from '../SlackOAuthCallbackHandler'

describe('SlackOAuthCallbackHandler', () => {
  it('exchanges an OAuth code into installation metadata without persisting raw tokens', async () => {
    const governance = SlackTeamGovernance.empty()
    const secrets: SlackOAuthTokenSecretInput[] = []
    const handler = new SlackOAuthCallbackHandler(
      governance,
      new FakeOAuthClient(),
      {
        storeToken(input) {
          secrets.push(input)
          return Promise.resolve(`secret://stored/${input.workspaceId}/${input.kind}`)
        },
      } satisfies SlackOAuthTokenSecretStore,
    )

    await expect(handler.handle({
      code: 'oauth-code',
      redirectUri: 'https://telegraph.local/slack/callback',
      policyProfileId: 'remote-agent-os/team-operator',
      now: 20,
    })).resolves.toMatchObject({
      installation: {
        installationId: 'slack-install-T123',
        workspaceId: 'T123',
        teamDomain: 'example',
        appId: 'A123',
        botUserId: 'Ubot',
        botTokenRef: 'secret://stored/T123/bot',
        userTokenRef: 'secret://stored/T123/user',
        scopes: ['commands', 'chat:write', 'users:read'],
        installedByUserId: 'Uadmin',
        status: 'active',
      },
      tokenRefs: {
        botTokenRef: 'secret://stored/T123/bot',
        userTokenRef: 'secret://stored/T123/user',
      },
    })
    expect(secrets).toEqual([
      expect.objectContaining({ kind: 'bot', token: 'xoxb-raw-token' }),
      expect.objectContaining({ kind: 'user', token: 'xoxp-raw-token' }),
    ])
    expect(JSON.stringify(governance.snapshot())).not.toContain('xox')
    expect(governance.listAuditEvents()).toEqual([
      expect.objectContaining({
        action: 'app_installed',
        status: 'accepted',
        actorId: 'slack:Uadmin',
      }),
    ])
  })
})

class FakeOAuthClient implements SlackOAuthExchangeClient {
  exchangeCode() {
    return Promise.resolve({
      ok: true,
      access_token: 'xoxb-raw-token',
      scope: 'commands,chat:write',
      app_id: 'A123',
      bot_user_id: 'Ubot',
      team: {
        id: 'T123',
        domain: 'example',
      },
      authed_user: {
        id: 'Uadmin',
        access_token: 'xoxp-raw-token',
        scope: 'users:read',
      },
    })
  }
}
