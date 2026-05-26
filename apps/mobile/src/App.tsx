import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type RemoteActorSnapshot } from '@/packages/remote-protocol'
import type { MobileConnectionState, MobileDashboardModel, MobileRunItem } from './application/MobileDashboardViewModel'
import type { MobileSlackGovernanceModel } from './application/MobileSlackGovernanceViewModel'
import {
  HttpMobileRemoteControlTransport,
  MobileRemoteControlClient,
} from './application/MobileRemoteControlClient'

export interface TelegraphMobileAppProps {
  relayEndpoint?: string
  relayToken?: string
  initialDashboard?: MobileDashboardModel
  actor?: RemoteActorSnapshot
}

type MobileTab = 'runs' | 'approvals' | 'devices' | 'artifacts' | 'slack'

const TABS: Array<{ id: MobileTab; label: string; hint: string }> = [
  { id: 'runs', label: 'Runs', hint: 'live work' },
  { id: 'approvals', label: 'Approvals', hint: 'human gate' },
  { id: 'devices', label: 'Devices', hint: 'bindings' },
  { id: 'artifacts', label: 'Artifacts', hint: 'previews' },
  { id: 'slack', label: 'Slack', hint: 'governance' },
]

const QUICK_PROMPTS = [
  'Summarize active runs',
  'Check pending approvals',
  'Open the latest artifact',
] as const

const DEFAULT_ACTOR: RemoteActorSnapshot = {
  actorId: 'mobile:self',
  kind: 'mobile',
  displayName: 'Telegraph Mobile',
}

const DEFAULT_DEVICE_ID = 'telegraph-mobile-dev'
const MOBILE_CHAT_SETTINGS = {
  backend: 'telegraph-orchestrator',
}

export function TelegraphMobileApp(props: TelegraphMobileAppProps): React.JSX.Element {
  const actor = props.actor ?? DEFAULT_ACTOR
  const [tab, setTab] = useState<MobileTab>('runs')
  const [prompt, setPrompt] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [relayEndpoint, setRelayEndpoint] = useState(props.relayEndpoint ?? '')
  const [relayToken, setRelayToken] = useState(props.relayToken ?? '')
  const [deviceId, setDeviceId] = useState(actor.deviceId ?? DEFAULT_DEVICE_ID)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
    props.initialDashboard?.selectedRun?.runId,
  )
  const [dashboard, setDashboard] = useState<MobileDashboardModel | undefined>(props.initialDashboard)
  const [connection, setConnection] = useState<MobileConnectionState>(
    props.initialDashboard?.connection ?? (relayEndpoint ? 'connecting' : 'offline'),
  )
  const [slack, setSlack] = useState<MobileSlackGovernanceModel | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const client = useMemo(() => relayEndpoint.trim()
    ? new MobileRemoteControlClient(new HttpMobileRemoteControlTransport({
      endpoint: relayEndpoint.trim(),
      headers: relayToken.trim() ? { authorization: `Bearer ${relayToken.trim()}` } : undefined,
    }))
    : null, [relayEndpoint, relayToken])
  useEffect(() => {
    if (!client) {
      setConnection('offline')
      return undefined
    }
    setConnection('connecting')
    const subscription = client.watchDashboard({
      selectedRunId: () => selectedRunId,
      onUpdate: model => {
        setDashboard(model)
        setConnection('live')
      },
      onError: watchError => {
        setError(watchError.message)
        setConnection('offline')
      },
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [client, selectedRunId])

  const refresh = async (): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(undefined)
    setConnection('connecting')
    try {
      const [nextDashboard, nextSlack] = await Promise.all([
        client.loadDashboard({ selectedRunId }),
        client.loadSlackGovernance(),
      ])
      setDashboard(nextDashboard)
      setSlack(nextSlack)
      setConnection('live')
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
      setConnection('offline')
    } finally {
      setBusy(false)
    }
  }

  const submitSlackOAuth = async (): Promise<void> => {
    if (!client || !oauthCode.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      await client.handleSlackOAuthCallback({ code: oauthCode.trim() })
      setOauthCode('')
      setSlack(await client.loadSlackGovernance())
    } catch (oauthError) {
      setError(oauthError instanceof Error ? oauthError.message : String(oauthError))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!client || !prompt.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const boundDeviceId = deviceId.trim() || DEFAULT_DEVICE_ID
      const boundActor: RemoteActorSnapshot = {
        ...actor,
        deviceId: boundDeviceId,
      }
      await client.ensureDeviceBinding({
        deviceId: boundDeviceId,
        actor: boundActor,
        label: 'Telegraph Mobile',
      })
      await client.submitMessage(
        {
          messageId: `mobile-${Date.now().toString(36)}`,
          actor: boundActor,
          channel: {
            kind: 'mobile',
            channelId: 'mobile',
          },
          text: prompt.trim(),
          receivedAt: Date.now(),
          schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
        },
        { requireDeviceBinding: true, targetPagelet: 'chat', settings: MOBILE_CHAT_SETTINGS },
      )
      setPrompt('')
      setDashboard(await client.loadDashboard())
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setBusy(false)
    }
  }

  const decide = async (approvalId: string, granted: boolean): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(undefined)
    try {
      await client.decideApproval(approvalId, granted, actor, granted ? 'Approved from mobile' : 'Denied from mobile')
      setDashboard(await client.loadDashboard({ selectedRunId }))
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : String(decisionError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="light-content" backgroundColor="#080d17" />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <View>
            <Text style={styles.title}>Telegraph</Text>
            <Text style={styles.subtitle}>Mobile cockpit</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <View style={[styles.connectionChip, connection === 'live' ? styles.connectionChipLive : styles.connectionChipIdle]}>
            <View style={[styles.statusDot, connection === 'live' ? styles.statusDotLive : styles.statusDotIdle]} />
            <Text style={styles.connectionChipText}>{connectionLabel(connection)}</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => { setSettingsOpen(value => !value); }}>
            <Text style={styles.iconButtonText}>Set</Text>
          </Pressable>
          <Pressable style={styles.iconButton} disabled={!client || busy} onPress={() => { void refresh(); }}>
            <Text style={styles.iconButtonText}>{busy ? '...' : 'Sync'}</Text>
          </Pressable>
        </View>
      </View>

      {(settingsOpen || !client) && (
        <View style={styles.connectionPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Relay link</Text>
            <Text style={styles.panelMeta}>{client ? 'configured' : 'required'}</Text>
          </View>
          <TextInput
            value={relayEndpoint}
            placeholder="Remote endpoint"
            placeholderTextColor="#6f7b8b"
            style={styles.compactInput}
            onChangeText={setRelayEndpoint}
          />
          <TextInput
            value={relayToken}
            placeholder="Token"
            placeholderTextColor="#6f7b8b"
            style={styles.compactInput}
            onChangeText={setRelayToken}
          />
        </View>
      )}

      <View style={styles.composer}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.panelTitle}>Command relay</Text>
            <Text style={styles.panelMeta}>{deviceId.trim() || DEFAULT_DEVICE_ID}</Text>
          </View>
          <Text style={styles.schemaBadge}>v{String(REMOTE_PROTOCOL_SCHEMA_VERSION)}</Text>
        </View>
        <TextInput
          multiline
          value={prompt}
          placeholder="Ask Telegraph"
          placeholderTextColor="#6f7b8b"
          style={styles.input}
          onChangeText={setPrompt}
        />
        <View style={styles.quickPromptRow}>
          {QUICK_PROMPTS.map(item => (
            <Pressable key={item} style={styles.quickPrompt} onPress={() => { setPrompt(item); }}>
              <Text style={styles.quickPromptText}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.composerFooter}>
          <Text style={styles.composerHint}>{client ? 'Ready for remote intake' : 'Connect relay to send'}</Text>
          <Pressable style={[styles.primaryButton, !client || busy || !prompt.trim() ? styles.disabledButton : {}]} disabled={!client || busy || !prompt.trim()} onPress={() => { void submit(); }}>
            <Text style={styles.primaryButtonText}>Send</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!dashboard ? (
        <EmptyState
          relayConfigured={Boolean(client)}
          busy={busy}
          endpoint={relayEndpoint}
          token={relayToken}
          onEndpointChange={setRelayEndpoint}
          onTokenChange={setRelayToken}
          deviceId={deviceId}
          onDeviceIdChange={setDeviceId}
        />
      ) : (
        <>
          <Summary model={dashboard} />
          <Tabs current={tab} model={dashboard} slack={slack} onChange={setTab} />
          <ScrollView style={styles.content}>
            {tab === 'runs' ? (
              dashboard.runs.length > 0
                ? dashboard.runs.map(run => (
                  <RunRow
                    key={run.runId}
                    run={run}
                    selected={run.runId === selectedRunId}
                    onSelect={() => {
                      setSelectedRunId(run.runId)
                    }}
                  />
                ))
                : <ListEmpty title="No runs yet" body="Runs will appear here when the desktop agent starts work." />
            ) : null}
            {tab === 'approvals' ? (
              dashboard.approvals.length > 0
                ? dashboard.approvals.map(approval => (
                  <View key={approval.approvalId} style={styles.item}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemTitle}>{approval.title}</Text>
                      <Text style={approval.pending ? styles.active : styles.muted}>{approval.status}</Text>
                    </View>
                    <Text style={styles.itemMeta}>{approval.runId}</Text>
                    {approval.body ? <Text style={styles.body}>{approval.body}</Text> : null}
                    {approval.pending ? (
                      <View style={styles.rowActions}>
                        <Pressable style={styles.secondaryButton} onPress={() => { void decide(approval.approvalId, false); }}>
                          <Text style={styles.secondaryButtonText}>Deny</Text>
                        </Pressable>
                        <Pressable style={styles.primaryButton} onPress={() => { void decide(approval.approvalId, true); }}>
                          <Text style={styles.primaryButtonText}>Approve</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))
                : <ListEmpty title="No pending approvals" body="Human-in-the-loop decisions will collect here." />
            ) : null}
            {tab === 'devices' ? (
              dashboard.devices.length > 0
                ? dashboard.devices.map(device => (
                  <View key={device.id} style={styles.item}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemTitle}>{device.title}</Text>
                      <Text style={device.active ? styles.good : styles.muted}>{device.status}</Text>
                    </View>
                    <Text style={styles.itemMeta}>{device.subtitle}</Text>
                  </View>
                ))
                : <ListEmpty title="No devices" body="Device bindings appear after a mobile actor is trusted." />
            ) : null}
            {tab === 'artifacts' ? (
              dashboard.artifacts.length > 0
                ? dashboard.artifacts.map(artifact => (
                  <View key={`${artifact.artifactId}:${artifact.uri}`} style={styles.item}>
                    <Text style={styles.itemTitle}>{artifact.title}</Text>
                    <Text style={styles.itemMeta}>{artifact.mediaType ?? artifact.previewKind}</Text>
                    {artifact.previewKind === 'image' && artifact.uri.startsWith('http') ? (
                      <Image source={{ uri: artifact.uri }} resizeMode="cover" style={styles.preview} />
                    ) : (
                      <Text style={styles.body}>{artifact.uri}</Text>
                    )}
                  </View>
                ))
                : <ListEmpty title="No artifacts" body="Generated previews and exports will land in this tab." />
            ) : null}
            {tab === 'slack' ? (
              <SlackGovernancePanel
                model={slack}
                oauthCode={oauthCode}
                onOAuthCodeChange={setOauthCode}
                onSubmitOAuth={() => { void submitSlackOAuth(); }}
              />
            ) : null}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  )
}

export default TelegraphMobileApp

function Summary({ model }: { model: MobileDashboardModel }): React.JSX.Element {
  return (
    <View style={styles.summary}>
      <Metric label="Runs" value={model.summary.runningRuns} />
      <Metric label="Approvals" value={model.summary.pendingApprovals} />
      <Metric label="Devices" value={model.summary.activeDevices} />
      <Metric label="Artifacts" value={model.summary.artifactPreviews} />
    </View>
  )
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{String(value)}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  )
}

function Tabs(props: {
  current: MobileTab
  model: MobileDashboardModel
  slack: MobileSlackGovernanceModel | undefined
  onChange: (tab: MobileTab) => void
}): React.JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
      {TABS.map(tab => (
        <Pressable
          key={tab.id}
          style={[styles.tab, props.current === tab.id ? styles.tabActive : styles.tabIdle]}
          onPress={() => {
            props.onChange(tab.id)
          }}
        >
          <View style={styles.tabTopLine}>
            <Text style={props.current === tab.id ? styles.tabTextActive : styles.tabText}>{tab.label}</Text>
            <Text style={props.current === tab.id ? styles.tabCountActive : styles.tabCount}>{String(tabCount(tab.id, props.model, props.slack))}</Text>
          </View>
          <Text style={props.current === tab.id ? styles.tabHintActive : styles.tabHint}>{tab.hint}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

function tabCount(
  tab: MobileTab,
  model: MobileDashboardModel,
  slack: MobileSlackGovernanceModel | undefined,
): number {
  if (tab === 'runs') return model.runs.length
  if (tab === 'approvals') return model.approvals.filter(item => item.pending).length
  if (tab === 'devices') return model.devices.length
  if (tab === 'artifacts') return model.artifacts.length
  return slack?.summary.activeWorkspaces ?? 0
}

function SlackGovernancePanel(props: {
  model: MobileSlackGovernanceModel | undefined
  oauthCode: string
  onOAuthCodeChange: (value: string) => void
  onSubmitOAuth: () => void
}): React.JSX.Element {
  const model = props.model
  return (
    <View style={styles.slackPanel}>
      <View style={styles.item}>
        <Text style={styles.itemTitle}>Slack OAuth</Text>
        <TextInput
          value={props.oauthCode}
          placeholder="OAuth code"
          placeholderTextColor="#6f7b8b"
          style={styles.input}
          onChangeText={props.onOAuthCodeChange}
        />
        <Pressable style={styles.primaryButton} disabled={!props.oauthCode.trim()} onPress={props.onSubmitOAuth}>
          <Text style={styles.primaryButtonText}>Connect</Text>
        </Pressable>
      </View>
      {model ? (
        <>
          <View style={styles.summary}>
            <Metric label="Workspaces" value={model.summary.activeWorkspaces} />
            <Metric label="Users" value={model.summary.activeUsers} />
            <Metric label="Devices" value={model.summary.activeDevices} />
            <Metric label="Audit" value={model.summary.auditEvents} />
          </View>
          {model.workspaces.map(workspace => (
            <View key={workspace.workspaceId} style={styles.item}>
              <Text style={styles.itemTitle}>{workspace.teamDomain ?? workspace.workspaceId}</Text>
              <Text style={styles.itemMeta}>{workspace.workspaceId} / {workspace.status}</Text>
              {workspace.policyProfileId ? <Text style={styles.body}>{workspace.policyProfileId}</Text> : null}
            </View>
          ))}
          {model.users.map(user => (
            <View key={`${user.workspaceId}:${user.userId}`} style={styles.item}>
              <Text style={styles.itemTitle}>{user.userId}</Text>
              <Text style={styles.itemMeta}>{user.workspaceId} / {user.role} / {user.status}</Text>
            </View>
          ))}
          {model.devices.map(device => (
            <View key={device.bindingId} style={styles.item}>
              <Text style={styles.itemTitle}>{device.label ?? device.deviceId}</Text>
              <Text style={styles.itemMeta}>{device.workspaceId} / {device.userId} / {device.status}</Text>
            </View>
          ))}
          {model.auditEvents.slice(0, 20).map(event => (
            <View key={event.auditId} style={styles.item}>
              <Text style={styles.itemTitle}>{event.action}</Text>
              <Text style={styles.itemMeta}>{event.actorId} / {event.status}</Text>
              {event.reason ? <Text style={styles.body}>{event.reason}</Text> : null}
            </View>
          ))}
        </>
      ) : (
        <View style={styles.item}>
          <Text style={styles.itemTitle}>Slack governance</Text>
          <Text style={styles.body}>No Slack governance state loaded.</Text>
        </View>
      )}
    </View>
  )
}

function RunRow(props: {
  run: MobileRunItem
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <Pressable style={[styles.item, props.selected ? styles.selectedItem : styles.unselectedItem]} onPress={props.onSelect}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{props.run.title}</Text>
        <Text style={toneStyle(props.run.statusTone)}>{props.run.status}</Text>
      </View>
      <Text style={styles.itemMeta}>{props.run.subtitle}</Text>
      <Text style={styles.body}>{String(props.run.artifactCount)} artifacts</Text>
    </Pressable>
  )
}

function EmptyState({
  relayConfigured,
  busy,
  endpoint,
  token,
  onEndpointChange,
  onTokenChange,
  deviceId,
  onDeviceIdChange,
}: {
  relayConfigured: boolean
  busy: boolean
  endpoint: string
  token: string
  onEndpointChange: (value: string) => void
  onTokenChange: (value: string) => void
  deviceId: string
  onDeviceIdChange: (value: string) => void
}): React.JSX.Element {
  return (
    <View style={styles.empty}>
      {busy ? <ActivityIndicator /> : null}
      <View style={styles.emptyMark}>
        <Text style={styles.emptyMarkText}>T</Text>
      </View>
      <Text style={styles.emptyTitle}>{relayConfigured ? 'No mobile state loaded' : 'Relay endpoint required'}</Text>
      <Text style={styles.body}>
        {relayConfigured
          ? `Trying ${endpoint.trim()}`
          : 'Pass relayEndpoint to connect this mobile control surface.'}
      </Text>
      <View style={styles.emptyConnectionForm}>
        <Text style={styles.formLabel}>Remote endpoint</Text>
        <TextInput
          value={endpoint}
          placeholder="http://192.168.2.57:8799/rpc"
          placeholderTextColor="#6f7b8b"
          style={styles.formInput}
          onChangeText={onEndpointChange}
        />
        <Text style={styles.formLabel}>Token</Text>
        <TextInput
          value={token}
          placeholder="dev"
          placeholderTextColor="#6f7b8b"
          style={styles.formInput}
          onChangeText={onTokenChange}
        />
        <Text style={styles.formLabel}>Device ID</Text>
        <TextInput
          value={deviceId}
          placeholder={DEFAULT_DEVICE_ID}
          placeholderTextColor="#6f7b8b"
          style={styles.formInput}
          onChangeText={onDeviceIdChange}
        />
      </View>
    </View>
  )
}

function ListEmpty({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <View style={styles.listEmpty}>
      <Text style={styles.listEmptyTitle}>{title}</Text>
      <Text style={styles.listEmptyBody}>{body}</Text>
    </View>
  )
}

function toneStyle(tone: MobileRunItem['statusTone']): Record<string, unknown> {
  if (tone === 'active') return styles.active
  if (tone === 'success') return styles.good
  if (tone === 'danger') return styles.bad
  return styles.muted
}

function connectionLabel(connection: string): string {
  if (connection === 'live') return 'Live'
  if (connection === 'connecting') return 'Connecting'
  return 'Offline'
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#080d17', padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  logoMark: {
    alignItems: 'center',
    backgroundColor: '#2b1113',
    borderColor: '#ff54364d',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    shadowColor: '#ff5436',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    width: 38,
  },
  logoText: { color: '#ff7a5f', fontSize: 20, fontWeight: '900' },
  title: { color: '#f0f4f8', fontSize: 25, fontWeight: '900' },
  subtitle: { color: '#8a95a6', fontSize: 12, marginTop: 2 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  connectionChip: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 6, height: 32, paddingHorizontal: 9 },
  connectionChipLive: { backgroundColor: '#112420', borderColor: '#38dca84d' },
  connectionChipIdle: { backgroundColor: '#121926', borderColor: '#ffffff1f' },
  statusDot: { borderRadius: 999, height: 6, width: 6 },
  statusDotLive: { backgroundColor: '#38dca8' },
  statusDotIdle: { backgroundColor: '#ffb154' },
  connectionChipText: { color: '#dbe5ef', fontSize: 11, fontWeight: '800' },
  iconButton: { alignItems: 'center', backgroundColor: '#121926', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, height: 32, justifyContent: 'center', paddingHorizontal: 9 },
  iconButtonText: { color: '#dbe5ef', fontSize: 11, fontWeight: '800' },
  connectionPanel: { backgroundColor: '#121926cc', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, gap: 8, marginBottom: 10, padding: 12 },
  panelHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  panelTitle: { color: '#f0f4f8', fontSize: 13, fontWeight: '900' },
  panelMeta: { color: '#8a95a6', fontSize: 11, fontWeight: '700', marginTop: 2 },
  schemaBadge: { backgroundColor: '#ff54361a', borderColor: '#ff543640', borderRadius: 7, borderWidth: 1, color: '#ff9a83', fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  composer: { backgroundColor: '#121926cc', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  input: { color: '#f0f4f8', minHeight: 58, padding: 0 },
  compactInput: { backgroundColor: '#080d17', borderColor: '#ffffff17', borderRadius: 8, borderWidth: 1, color: '#f0f4f8', minHeight: 38, paddingHorizontal: 10 },
  quickPromptRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickPrompt: { backgroundColor: '#1a2433', borderColor: '#ffffff17', borderRadius: 7, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6 },
  quickPromptText: { color: '#aab5c5', fontSize: 11, fontWeight: '700' },
  composerFooter: { alignItems: 'center', borderTopColor: '#ffffff14', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 },
  composerHint: { color: '#8a95a6', flex: 1, fontSize: 11, fontWeight: '700' },
  primaryButton: { alignItems: 'center', backgroundColor: '#ff5436', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: '#160d0a', fontWeight: '900' },
  secondaryButton: { alignItems: 'center', backgroundColor: '#121926', borderColor: '#ffffff24', borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButtonText: { color: '#dbe5ef', fontWeight: '800' },
  error: { backgroundColor: '#3a1414', borderColor: '#ff54364d', borderRadius: 8, borderWidth: 1, color: '#ff9a83', marginTop: 10, padding: 10 },
  summary: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  metric: { backgroundColor: '#121926cc', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, flex: 1, padding: 10 },
  metricValue: { color: '#f0f4f8', fontSize: 22, fontWeight: '900' },
  metricLabel: { color: '#8a95a6', fontSize: 10, fontWeight: '800', marginTop: 2, textTransform: 'uppercase' },
  tabs: { flexGrow: 0, marginBottom: 10 },
  tabsContent: { gap: 8, paddingRight: 2 },
  tab: { borderRadius: 8, borderWidth: 1, minWidth: 112, paddingHorizontal: 11, paddingVertical: 10 },
  tabActive: { backgroundColor: '#2a1518', borderColor: '#ff54365c' },
  tabIdle: { backgroundColor: '#121926', borderColor: '#ffffff17' },
  tabTopLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  tabText: { color: '#aab5c5', fontSize: 12, fontWeight: '900' },
  tabTextActive: { color: '#ff8d76', fontSize: 12, fontWeight: '900' },
  tabCount: { color: '#6f7b8b', fontSize: 12, fontWeight: '900' },
  tabCountActive: { color: '#f0f4f8', fontSize: 12, fontWeight: '900' },
  tabHint: { color: '#6f7b8b', fontSize: 10, fontWeight: '700', marginTop: 4 },
  tabHintActive: { color: '#c98b7d', fontSize: 10, fontWeight: '700', marginTop: 4 },
  content: { flex: 1 },
  item: { backgroundColor: '#121926cc', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, marginBottom: 10, padding: 12 },
  selectedItem: { borderColor: '#ff54365c', borderWidth: 1 },
  unselectedItem: {},
  itemHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  itemTitle: { color: '#f0f4f8', flex: 1, fontSize: 15, fontWeight: '900' },
  itemMeta: { color: '#8a95a6', fontSize: 12, marginTop: 4 },
  body: { color: '#aab5c5', fontSize: 13, lineHeight: 18, marginTop: 8 },
  rowActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  active: { color: '#ffb154', fontSize: 12, fontWeight: '900' },
  good: { color: '#38dca8', fontSize: 12, fontWeight: '900' },
  bad: { color: '#ff6b55', fontSize: 12, fontWeight: '900' },
  muted: { color: '#8a95a6', fontSize: 12, fontWeight: '800' },
  preview: { borderRadius: 8, height: 180, marginTop: 10 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  emptyMark: { alignItems: 'center', backgroundColor: '#2b1113', borderColor: '#ff54364d', borderRadius: 8, borderWidth: 1, height: 52, justifyContent: 'center', marginBottom: 16, width: 52 },
  emptyMarkText: { color: '#ff7a5f', fontSize: 26, fontWeight: '900' },
  emptyConnectionForm: { alignSelf: 'stretch', gap: 8, marginTop: 18 },
  emptyTitle: { color: '#f0f4f8', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  formInput: { backgroundColor: '#121926', borderColor: '#ffffff24', borderRadius: 8, borderWidth: 1, color: '#f0f4f8', minHeight: 42, paddingHorizontal: 10 },
  formLabel: { alignSelf: 'stretch', color: '#aab5c5', fontSize: 12, fontWeight: '900', marginTop: 4 },
  listEmpty: { alignItems: 'center', backgroundColor: '#12192680', borderColor: '#ffffff17', borderRadius: 8, borderWidth: 1, padding: 22 },
  listEmptyTitle: { color: '#f0f4f8', fontSize: 15, fontWeight: '900' },
  listEmptyBody: { color: '#8a95a6', fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  slackPanel: { paddingBottom: 24 },
})
