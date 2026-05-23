import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type RemoteActorSnapshot } from '@/packages/remote-protocol'
import type { MobileDashboardModel, MobileRunItem } from './application/MobileDashboardViewModel'
import type { MobileSlackGovernanceModel } from './application/MobileSlackGovernanceViewModel'
import {
  HttpMobileRemoteControlTransport,
  MobileRemoteControlClient,
} from './application/MobileRemoteControlClient'

export interface TelegraphMobileAppProps {
  relayEndpoint?: string
  initialDashboard?: MobileDashboardModel
  actor?: RemoteActorSnapshot
}

type MobileTab = 'runs' | 'approvals' | 'devices' | 'artifacts' | 'slack'

const DEFAULT_ACTOR: RemoteActorSnapshot = {
  actorId: 'mobile:self',
  kind: 'system',
  displayName: 'Telegraph Mobile',
}

export function TelegraphMobileApp(props: TelegraphMobileAppProps): JSX.Element {
  const [tab, setTab] = useState<MobileTab>('runs')
  const [prompt, setPrompt] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
    props.initialDashboard?.selectedRun?.runId,
  )
  const [dashboard, setDashboard] = useState<MobileDashboardModel | undefined>(props.initialDashboard)
  const [slack, setSlack] = useState<MobileSlackGovernanceModel | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const client = useMemo(() => props.relayEndpoint
    ? new MobileRemoteControlClient(new HttpMobileRemoteControlTransport({ endpoint: props.relayEndpoint }))
    : null, [props.relayEndpoint])
  const actor = props.actor ?? DEFAULT_ACTOR

  useEffect(() => {
    if (!client) return undefined
    const subscription = client.watchDashboard({
      selectedRunId: () => selectedRunId,
      onUpdate: setDashboard,
      onError: watchError => setError(watchError.message),
    })
    return () => subscription.unsubscribe()
  }, [client, selectedRunId])

  const refresh = async (): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(undefined)
    try {
      const [nextDashboard, nextSlack] = await Promise.all([
        client.loadDashboard({ selectedRunId }),
        client.loadSlackGovernance(),
      ])
      setDashboard(nextDashboard)
      setSlack(nextSlack)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
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
      await client.submitMessage({
        messageId: `mobile-${Date.now().toString(36)}`,
        actor,
        channel: {
          kind: 'mobile',
          channelId: 'mobile',
        },
        text: prompt.trim(),
        receivedAt: Date.now(),
        schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
      })
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
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Telegraph</Text>
          <Text style={styles.subtitle}>{connectionLabel(dashboard?.connection ?? 'offline')}</Text>
        </View>
        <Pressable style={styles.iconButton} disabled={!client || busy} onPress={() => void refresh()}>
          <Text style={styles.iconButtonText}>{busy ? '...' : '↻'}</Text>
        </Pressable>
      </View>

      <View style={styles.composer}>
        <TextInput
          multiline
          value={prompt}
          placeholder="Ask Telegraph"
          style={styles.input}
          onChangeText={setPrompt}
        />
        <Pressable style={styles.primaryButton} disabled={!client || busy || !prompt.trim()} onPress={() => void submit()}>
          <Text style={styles.primaryButtonText}>Send</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!dashboard ? <EmptyState relayConfigured={Boolean(client)} busy={busy} /> : (
        <>
          <Summary model={dashboard} />
          <Tabs current={tab} onChange={setTab} />
          <ScrollView style={styles.content}>
            {tab === 'runs' ? (
              dashboard.runs.map(run => (
                <RunRow
                  key={run.runId}
                  run={run}
                  selected={run.runId === selectedRunId}
                  onSelect={() => setSelectedRunId(run.runId)}
                />
              ))
            ) : null}
            {tab === 'approvals' ? dashboard.approvals.map(approval => (
              <View key={approval.approvalId} style={styles.item}>
                <Text style={styles.itemTitle}>{approval.title}</Text>
                <Text style={styles.itemMeta}>{approval.runId} / {approval.status}</Text>
                {approval.body ? <Text style={styles.body}>{approval.body}</Text> : null}
                {approval.pending ? (
                  <View style={styles.rowActions}>
                    <Pressable style={styles.secondaryButton} onPress={() => void decide(approval.approvalId, false)}>
                      <Text style={styles.secondaryButtonText}>Deny</Text>
                    </Pressable>
                    <Pressable style={styles.primaryButton} onPress={() => void decide(approval.approvalId, true)}>
                      <Text style={styles.primaryButtonText}>Approve</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )) : null}
            {tab === 'devices' ? dashboard.devices.map(device => (
              <View key={device.id} style={styles.item}>
                <Text style={styles.itemTitle}>{device.title}</Text>
                <Text style={styles.itemMeta}>{device.subtitle}</Text>
                <Text style={device.active ? styles.good : styles.muted}>{device.status}</Text>
              </View>
            )) : null}
            {tab === 'artifacts' ? dashboard.artifacts.map(artifact => (
              <View key={`${artifact.artifactId}:${artifact.uri}`} style={styles.item}>
                <Text style={styles.itemTitle}>{artifact.title}</Text>
                <Text style={styles.itemMeta}>{artifact.mediaType ?? artifact.previewKind}</Text>
                {artifact.previewKind === 'image' && artifact.uri.startsWith('http') ? (
                  <Image source={{ uri: artifact.uri }} resizeMode="cover" style={styles.preview} />
                ) : (
                  <Text style={styles.body}>{artifact.uri}</Text>
                )}
              </View>
            )) : null}
            {tab === 'slack' ? (
              <SlackGovernancePanel
                model={slack}
                oauthCode={oauthCode}
                onOAuthCodeChange={setOauthCode}
                onSubmitOAuth={() => void submitSlackOAuth()}
              />
            ) : null}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  )
}

export default TelegraphMobileApp

function Summary({ model }: { model: MobileDashboardModel }): JSX.Element {
  return (
    <View style={styles.summary}>
      <Metric label="Runs" value={model.summary.runningRuns} />
      <Metric label="Approvals" value={model.summary.pendingApprovals} />
      <Metric label="Devices" value={model.summary.activeDevices} />
      <Metric label="Artifacts" value={model.summary.artifactPreviews} />
    </View>
  )
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{String(value)}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  )
}

function Tabs(props: { current: MobileTab; onChange: (tab: MobileTab) => void }): JSX.Element {
  const tabs: MobileTab[] = ['runs', 'approvals', 'devices', 'artifacts', 'slack']
  return (
    <View style={styles.tabs}>
      {tabs.map(tab => (
        <Pressable
          key={tab}
          style={[styles.tab, props.current === tab ? styles.tabActive : styles.tabIdle]}
          onPress={() => props.onChange(tab)}
        >
          <Text style={props.current === tab ? styles.tabTextActive : styles.tabText}>{tab}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function SlackGovernancePanel(props: {
  model: MobileSlackGovernanceModel | undefined
  oauthCode: string
  onOAuthCodeChange: (value: string) => void
  onSubmitOAuth: () => void
}): JSX.Element {
  const model = props.model
  return (
    <View>
      <View style={styles.item}>
        <Text style={styles.itemTitle}>Slack OAuth</Text>
        <TextInput
          value={props.oauthCode}
          placeholder="OAuth code"
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
}): JSX.Element {
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

function EmptyState({ relayConfigured, busy }: { relayConfigured: boolean; busy: boolean }): JSX.Element {
  return (
    <View style={styles.empty}>
      {busy ? <ActivityIndicator /> : null}
      <Text style={styles.emptyTitle}>{relayConfigured ? 'No mobile state loaded' : 'Relay endpoint required'}</Text>
      <Text style={styles.body}>
        {relayConfigured
          ? 'Refresh to load devices, runs, approvals, and artifact previews.'
          : 'Pass relayEndpoint to connect this mobile control surface.'}
      </Text>
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
  if (connection === 'live') return 'Remote control live'
  if (connection === 'connecting') return 'Connecting to relay'
  return 'Offline'
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#eef2f3', padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: '#172126', fontSize: 30, fontWeight: '800' },
  subtitle: { color: '#546065', fontSize: 13, marginTop: 2 },
  iconButton: { alignItems: 'center', backgroundColor: '#172126', borderRadius: 8, height: 40, justifyContent: 'center', width: 40 },
  iconButtonText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  composer: { backgroundColor: '#ffffff', borderColor: '#cbd5d8', borderRadius: 8, borderWidth: 1, gap: 10, padding: 10 },
  input: { color: '#172126', minHeight: 54, padding: 0 },
  primaryButton: { alignItems: 'center', backgroundColor: '#176b5b', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
  secondaryButton: { alignItems: 'center', borderColor: '#b9afa0', borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryButtonText: { color: '#172126', fontWeight: '700' },
  error: { color: '#9f2d20', marginTop: 10 },
  summary: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  metric: { backgroundColor: '#ffffff', borderColor: '#cbd5d8', borderRadius: 8, borderWidth: 1, flex: 1, padding: 10 },
  metricValue: { color: '#172126', fontSize: 22, fontWeight: '800' },
  metricLabel: { color: '#546065', fontSize: 11, marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  tab: { alignItems: 'center', borderRadius: 8, flex: 1, paddingVertical: 9 },
  tabActive: { backgroundColor: '#172126' },
  tabIdle: { backgroundColor: '#dbe4e7' },
  tabText: { color: '#394348', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  content: { flex: 1 },
  item: { backgroundColor: '#ffffff', borderColor: '#cbd5d8', borderRadius: 8, borderWidth: 1, marginBottom: 10, padding: 12 },
  selectedItem: { borderColor: '#176b5b', borderWidth: 2 },
  unselectedItem: {},
  itemHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  itemTitle: { color: '#172126', flex: 1, fontSize: 15, fontWeight: '800' },
  itemMeta: { color: '#546065', fontSize: 12, marginTop: 4 },
  body: { color: '#394348', fontSize: 13, marginTop: 8 },
  rowActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  active: { color: '#986700', fontSize: 12, fontWeight: '800' },
  good: { color: '#176b5b', fontSize: 12, fontWeight: '800' },
  bad: { color: '#9f2d20', fontSize: 12, fontWeight: '800' },
  muted: { color: '#758086', fontSize: 12, fontWeight: '700' },
  preview: { borderRadius: 8, height: 180, marginTop: 10 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  emptyTitle: { color: '#172126', fontSize: 18, fontWeight: '800', marginBottom: 8 },
})
