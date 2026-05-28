import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TabView, { type AppleIcon } from 'react-native-bottom-tabs'
import type { RemoteControlRuntimeSettingsInput } from '@/apps/remote-control/application/common'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type RemoteActorSnapshot } from '@/packages/remote-protocol'
import type {
  MobileChatMessageItem,
  MobileChatSessionItem,
  MobileConnectionState,
  MobileDashboardModel,
  MobileRunItem,
} from './application/MobileDashboardViewModel'
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

type RootTab = 'chat' | 'cockpit'
type CockpitTab = 'runs' | 'approvals' | 'devices' | 'artifacts' | 'slack'

interface RootRoute {
  key: RootTab
  title: string
  focusedIcon: AppleIcon
  unfocusedIcon: AppleIcon
}

const ROOT_ROUTES: RootRoute[] = [
  {
    key: 'chat',
    title: 'Chat',
    focusedIcon: { sfSymbol: 'message.fill' },
    unfocusedIcon: { sfSymbol: 'message' },
  },
  {
    key: 'cockpit',
    title: 'Cockpit',
    focusedIcon: { sfSymbol: 'rectangle.grid.2x2.fill' },
    unfocusedIcon: { sfSymbol: 'rectangle.grid.2x2' },
  },
]

const COCKPIT_TABS: Array<{ id: CockpitTab; label: string; hint: string }> = [
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
const DEFAULT_MOBILE_CHAT_SETTINGS: RemoteControlRuntimeSettingsInput = {
  provider: 'telegraph',
  modelId: 'orchestrator',
  backend: 'telegraph-orchestrator',
  apiKey: '',
}

export function TelegraphMobileApp(props: TelegraphMobileAppProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const actor = props.actor ?? DEFAULT_ACTOR
  const [rootTabIndex, setRootTabIndex] = useState(0)
  const rootTab = ROOT_ROUTES[rootTabIndex]?.key ?? 'chat'
  const [cockpitTab, setCockpitTab] = useState<CockpitTab>('runs')
  const [prompt, setPrompt] = useState('')
  const [oauthCode, setOauthCode] = useState('')
  const [relayEndpoint, setRelayEndpoint] = useState(props.relayEndpoint ?? '')
  const [relayToken, setRelayToken] = useState(props.relayToken ?? '')
  const [deviceId, setDeviceId] = useState(actor.deviceId ?? DEFAULT_DEVICE_ID)
  const [relaySettingsOpen, setRelaySettingsOpen] = useState(false)
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false)
  const [chatSettings, setChatSettings] = useState<RemoteControlRuntimeSettingsInput>(DEFAULT_MOBILE_CHAT_SETTINGS)
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
    props.initialDashboard?.selectedRun?.runId,
  )
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string | undefined>(
    props.initialDashboard?.chat.selectedSessionId,
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
      intervalMs: 2000,
      selectedRunId: () => selectedRunId,
      selectedChatSessionId: () => selectedChatSessionId,
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
  }, [client, selectedRunId, selectedChatSessionId])

  useEffect(() => {
    if (!selectedChatSessionId && dashboard?.chat.selectedSessionId) {
      setSelectedChatSessionId(dashboard.chat.selectedSessionId)
    }
  }, [dashboard, selectedChatSessionId])

  const refresh = async (): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(undefined)
    setConnection('connecting')
    try {
      const [nextDashboard, nextSlack] = await Promise.all([
        client.loadDashboard({ selectedRunId, selectedChatSessionId }),
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
    const sessionId = selectedChatSessionId ?? dashboard?.chat.selectedSessionId ?? `mobile-session-${Date.now().toString(36)}`
    setSelectedChatSessionId(sessionId)
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
            threadId: sessionId,
          },
          text: prompt.trim(),
          receivedAt: Date.now(),
          schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
        },
        {
          requireDeviceBinding: true,
          targetPagelet: 'chat',
          sessionId,
          settings: compactChatSettings(chatSettings),
        },
      )
      setPrompt('')
      setDashboard(await client.loadDashboard({ selectedChatSessionId: sessionId, selectedRunId }))
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
      setDashboard(await client.loadDashboard({ selectedRunId, selectedChatSessionId }))
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : String(decisionError))
    } finally {
      setBusy(false)
    }
  }

  const selectChatSession = (sessionId: string): void => {
    setSelectedChatSessionId(sessionId)
    if (client) {
      void client.loadDashboard({ selectedRunId, selectedChatSessionId: sessionId })
        .then(setDashboard)
        .catch(() => undefined)
    }
  }

  return (
    <View style={[styles.shell, { paddingTop: insets.top + 16 }]}>
      <StatusBar barStyle="light-content" backgroundColor="#080d17" />
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <View>
            <Text style={styles.title}>Telegraph</Text>
            <Text style={styles.subtitle}>{rootTab === 'chat' ? 'Remote chat' : 'Mobile cockpit'}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <View style={[styles.connectionChip, connection === 'live' ? styles.connectionChipLive : styles.connectionChipIdle]}>
            <View style={[styles.statusDot, connection === 'live' ? styles.statusDotLive : styles.statusDotIdle]} />
            <Text style={styles.connectionChipText}>{connectionLabel(connection)}</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => { setRelaySettingsOpen(value => !value); }}>
            <Text style={styles.iconButtonText}>Relay</Text>
          </Pressable>
          <Pressable style={styles.iconButton} disabled={!client || busy} onPress={() => { void refresh(); }}>
            <Text style={styles.iconButtonText}>{busy ? '...' : 'Sync'}</Text>
          </Pressable>
        </View>
      </View>

      {(relaySettingsOpen || !client) && (
        <RelaySettingsPanel
          clientReady={Boolean(client)}
          relayEndpoint={relayEndpoint}
          relayToken={relayToken}
          deviceId={deviceId}
          onEndpointChange={setRelayEndpoint}
          onTokenChange={setRelayToken}
          onDeviceIdChange={setDeviceId}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TabView
        navigationState={{ index: rootTabIndex, routes: ROOT_ROUTES }}
        onIndexChange={setRootTabIndex}
        renderScene={({ route }) => renderRootScene(route.key, {
          dashboard,
          connection,
          prompt,
          busy,
          clientReady: Boolean(client),
          chatSettingsOpen,
          chatSettings,
          selectedChatSessionId,
          selectedRunId,
          cockpitTab,
          slack,
          oauthCode,
          relayEndpoint,
          relayToken,
          deviceId,
          setPrompt,
          submit,
          selectChatSession,
          setSelectedChatSessionId,
          setChatSettingsOpen,
          setChatSettings,
          setRelayEndpoint,
          setRelayToken,
          setDeviceId,
          setCockpitTab,
          setSelectedRunId,
          setOauthCode,
          submitSlackOAuth,
          decide,
        })}
        labeled
        hapticFeedbackEnabled
        tabBarActiveTintColor="#ff5436"
        tabBarInactiveTintColor="#8a95a6"
        tabBarStyle={{ backgroundColor: '#101720' }}
        activeIndicatorColor="#ff543633"
      />
    </View>
  )
}

export default TelegraphMobileApp

interface RootSceneContext {
  dashboard: MobileDashboardModel | undefined
  connection: MobileConnectionState
  prompt: string
  busy: boolean
  clientReady: boolean
  chatSettingsOpen: boolean
  chatSettings: RemoteControlRuntimeSettingsInput
  selectedChatSessionId?: string
  selectedRunId?: string
  cockpitTab: CockpitTab
  slack: MobileSlackGovernanceModel | undefined
  oauthCode: string
  relayEndpoint: string
  relayToken: string
  deviceId: string
  setPrompt: (value: string) => void
  submit: () => Promise<void>
  selectChatSession: (sessionId: string) => void
  setSelectedChatSessionId: (sessionId: string) => void
  setChatSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setChatSettings: (settings: RemoteControlRuntimeSettingsInput) => void
  setRelayEndpoint: (value: string) => void
  setRelayToken: (value: string) => void
  setDeviceId: (value: string) => void
  setCockpitTab: (tab: CockpitTab) => void
  setSelectedRunId: (runId: string) => void
  setOauthCode: (value: string) => void
  submitSlackOAuth: () => Promise<void>
  decide: (approvalId: string, granted: boolean) => Promise<void>
}

function renderRootScene(routeKey: RootTab, context: RootSceneContext): React.JSX.Element {
  return (
    <View style={styles.mainContent}>
      {routeKey === 'chat' ? (
        <ChatTab
          model={context.dashboard ?? emptyDashboard(context.connection)}
          prompt={context.prompt}
          busy={context.busy}
          clientReady={context.clientReady}
          settingsOpen={context.chatSettingsOpen}
          settings={context.chatSettings}
          selectedSessionId={context.selectedChatSessionId}
          onPromptChange={context.setPrompt}
          onSubmit={() => { void context.submit(); }}
          onSelectSession={context.selectChatSession}
          onCreateSession={() => {
            const sessionId = `mobile-session-${Date.now().toString(36)}`
            context.setSelectedChatSessionId(sessionId)
          }}
          onToggleSettings={() => { context.setChatSettingsOpen(value => !value); }}
          onSettingsChange={context.setChatSettings}
        />
      ) : !context.dashboard ? (
        <EmptyState
          relayConfigured={context.clientReady}
          busy={context.busy}
          endpoint={context.relayEndpoint}
          token={context.relayToken}
          onEndpointChange={context.setRelayEndpoint}
          onTokenChange={context.setRelayToken}
          deviceId={context.deviceId}
          onDeviceIdChange={context.setDeviceId}
        />
      ) : (
        <CockpitTabView
          model={context.dashboard}
          tab={context.cockpitTab}
          slack={context.slack}
          oauthCode={context.oauthCode}
          selectedRunId={context.selectedRunId}
          onTabChange={context.setCockpitTab}
          onSelectRun={context.setSelectedRunId}
          onOAuthCodeChange={context.setOauthCode}
          onSubmitOAuth={() => { void context.submitSlackOAuth(); }}
          onDecide={(approvalId, granted) => { void context.decide(approvalId, granted); }}
        />
      )}
    </View>
  )
}

function ChatTab(props: {
  model: MobileDashboardModel
  prompt: string
  busy: boolean
  clientReady: boolean
  settingsOpen: boolean
  settings: RemoteControlRuntimeSettingsInput
  selectedSessionId?: string
  onPromptChange: (value: string) => void
  onSubmit: () => void
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
  onToggleSettings: () => void
  onSettingsChange: (settings: RemoteControlRuntimeSettingsInput) => void
}): React.JSX.Element {
  const chat = props.model.chat
  const selectedSessionId = props.selectedSessionId ?? chat.selectedSessionId
  const canSend = props.clientReady && !props.busy && props.prompt.trim().length > 0

  return (
    <View style={styles.chatPane}>
      <View style={styles.chatHeader}>
        <View style={styles.chatTitleBlock}>
          <Text style={styles.panelTitle}>{chat.selectedSession?.title ?? 'New chat'}</Text>
          <Text style={styles.panelMeta}>{messageCountLabel(chat.messages.length)} / desktop-run only</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.secondaryButtonCompact} onPress={props.onCreateSession}>
            <Text style={styles.secondaryButtonText}>New</Text>
          </Pressable>
          <Pressable style={styles.secondaryButtonCompact} onPress={props.onToggleSettings}>
            <Text style={styles.secondaryButtonText}>Model</Text>
          </Pressable>
        </View>
      </View>

      <ModelSummary settings={props.settings} />

      {props.settingsOpen ? (
        <ChatSettingsPanel settings={props.settings} onChange={props.onSettingsChange} />
      ) : null}

      <SessionStrip
        sessions={chat.sessions}
        selectedSessionId={selectedSessionId}
        onSelect={props.onSelectSession}
      />

      <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {chat.messages.length > 0 ? (
          chat.messages.map(message => <ChatMessageBubble key={message.id} message={message} />)
        ) : (
          <ListEmpty title="No chat yet" body="Send a message to the desktop agent host, or select a synced desktop session." />
        )}
      </ScrollView>

      <View style={styles.chatComposer}>
        <TextInput
          multiline
          value={props.prompt}
          placeholder="Message Telegraph on desktop"
          placeholderTextColor="#6f7b8b"
          style={styles.chatInput}
          onChangeText={props.onPromptChange}
        />
        <View style={styles.quickPromptRow}>
          {QUICK_PROMPTS.map(item => (
            <Pressable key={item} style={styles.quickPrompt} onPress={() => { props.onPromptChange(item); }}>
              <Text style={styles.quickPromptText}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.composerFooter}>
          <Text style={styles.composerHint}>{props.clientReady ? 'Runs execute on desktop' : 'Connect relay to send'}</Text>
          <Pressable style={[styles.primaryButton, !canSend ? styles.disabledButton : {}]} disabled={!canSend} onPress={props.onSubmit}>
            <Text style={styles.primaryButtonText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

function ModelSummary({ settings }: { settings: RemoteControlRuntimeSettingsInput }): React.JSX.Element {
  return (
    <View style={styles.modelBar}>
      <Text style={styles.modelLabel}>{settings.backend ?? 'desktop runtime'}</Text>
      <Text style={styles.modelValue}>{settings.provider ?? 'provider'} / {settings.modelId ?? 'model'}</Text>
    </View>
  )
}

function ChatSettingsPanel(props: {
  settings: RemoteControlRuntimeSettingsInput
  onChange: (settings: RemoteControlRuntimeSettingsInput) => void
}): React.JSX.Element {
  const setField = (key: keyof RemoteControlRuntimeSettingsInput, value: string): void => {
    props.onChange({
      ...props.settings,
      [key]: value,
    })
  }

  return (
    <View style={styles.connectionPanel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Model settings</Text>
        <Text style={styles.panelMeta}>sent with next run</Text>
      </View>
      <TextInput
        value={props.settings.backend ?? ''}
        placeholder="Backend"
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={value => { setField('backend', value); }}
      />
      <TextInput
        value={props.settings.provider ?? ''}
        placeholder="Provider"
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={value => { setField('provider', value); }}
      />
      <TextInput
        value={props.settings.modelId ?? ''}
        placeholder="Model"
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={value => { setField('modelId', value); }}
      />
      <TextInput
        value={props.settings.apiKey ?? ''}
        placeholder="API key on desktop"
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={value => { setField('apiKey', value); }}
      />
    </View>
  )
}

function SessionStrip(props: {
  sessions: MobileChatSessionItem[]
  selectedSessionId?: string
  onSelect: (sessionId: string) => void
}): React.JSX.Element {
  if (props.sessions.length === 0) {
    return (
      <View style={styles.sessionEmpty}>
        <Text style={styles.sessionEmptyText}>Desktop sessions will sync here.</Text>
      </View>
    )
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sessionStrip} contentContainerStyle={styles.sessionStripContent}>
      {props.sessions.map(session => (
        <Pressable
          key={session.sessionId}
          style={[styles.sessionPill, session.sessionId === props.selectedSessionId ? styles.sessionPillActive : styles.sessionPillIdle]}
          onPress={() => { props.onSelect(session.sessionId); }}
        >
          <Text style={session.sessionId === props.selectedSessionId ? styles.sessionTitleActive : styles.sessionTitle}>{session.title}</Text>
          <Text style={styles.sessionMeta}>{session.subtitle}</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

function ChatMessageBubble({ message }: { message: MobileChatMessageItem }): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <View style={styles.messageTopLine}>
          <Text style={styles.messageRole}>{isUser ? 'You' : 'Telegraph'}</Text>
          <Text style={statusTextStyle(message.status)}>{message.status}</Text>
        </View>
        <Text style={styles.messageText}>{message.content}</Text>
      </View>
    </View>
  )
}

function CockpitTabView(props: {
  model: MobileDashboardModel
  tab: CockpitTab
  slack: MobileSlackGovernanceModel | undefined
  oauthCode: string
  selectedRunId: string | undefined
  onTabChange: (tab: CockpitTab) => void
  onSelectRun: (runId: string) => void
  onOAuthCodeChange: (value: string) => void
  onSubmitOAuth: () => void
  onDecide: (approvalId: string, granted: boolean) => void
}): React.JSX.Element {
  return (
    <>
      <Summary model={props.model} />
      <CockpitTabs current={props.tab} model={props.model} slack={props.slack} onChange={props.onTabChange} />
      <ScrollView style={styles.content}>
        {props.tab === 'runs' ? (
          props.model.runs.length > 0
            ? props.model.runs.map(run => (
              <RunRow
                key={run.runId}
                run={run}
                selected={run.runId === props.selectedRunId}
                onSelect={() => { props.onSelectRun(run.runId); }}
              />
            ))
            : <ListEmpty title="No runs yet" body="Runs will appear here when the desktop agent starts work." />
        ) : null}
        {props.tab === 'approvals' ? (
          props.model.approvals.length > 0
            ? props.model.approvals.map(approval => (
              <View key={approval.approvalId} style={styles.item}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemTitle}>{approval.title}</Text>
                  <Text style={approval.pending ? styles.active : styles.muted}>{approval.status}</Text>
                </View>
                <Text style={styles.itemMeta}>{approval.runId}</Text>
                {approval.body ? <Text style={styles.body}>{approval.body}</Text> : null}
                {approval.pending ? (
                  <View style={styles.rowActions}>
                    <Pressable style={styles.secondaryButton} onPress={() => { props.onDecide(approval.approvalId, false); }}>
                      <Text style={styles.secondaryButtonText}>Deny</Text>
                    </Pressable>
                    <Pressable style={styles.primaryButton} onPress={() => { props.onDecide(approval.approvalId, true); }}>
                      <Text style={styles.primaryButtonText}>Approve</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
            : <ListEmpty title="No pending approvals" body="Human-in-the-loop decisions will collect here." />
        ) : null}
        {props.tab === 'devices' ? (
          props.model.devices.length > 0
            ? props.model.devices.map(device => (
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
        {props.tab === 'artifacts' ? (
          props.model.artifacts.length > 0
            ? props.model.artifacts.map(artifact => (
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
        {props.tab === 'slack' ? (
          <SlackGovernancePanel
            model={props.slack}
            oauthCode={props.oauthCode}
            onOAuthCodeChange={props.onOAuthCodeChange}
            onSubmitOAuth={props.onSubmitOAuth}
          />
        ) : null}
      </ScrollView>
    </>
  )
}

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

function CockpitTabs(props: {
  current: CockpitTab
  model: MobileDashboardModel
  slack: MobileSlackGovernanceModel | undefined
  onChange: (tab: CockpitTab) => void
}): React.JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
      {COCKPIT_TABS.map(tab => (
        <Pressable
          key={tab.id}
          style={[styles.tab, props.current === tab.id ? styles.tabActive : styles.tabIdle]}
          onPress={() => { props.onChange(tab.id); }}
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
  tab: CockpitTab,
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

function RelaySettingsPanel(props: {
  clientReady: boolean
  relayEndpoint: string
  relayToken: string
  deviceId: string
  onEndpointChange: (value: string) => void
  onTokenChange: (value: string) => void
  onDeviceIdChange: (value: string) => void
}): React.JSX.Element {
  return (
    <View style={styles.connectionPanel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Relay link</Text>
        <Text style={styles.panelMeta}>{props.clientReady ? 'configured' : 'required'}</Text>
      </View>
      <TextInput
        value={props.relayEndpoint}
        placeholder="Remote endpoint"
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={props.onEndpointChange}
      />
      <TextInput
        value={props.relayToken}
        placeholder="Token"
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={props.onTokenChange}
      />
      <TextInput
        value={props.deviceId}
        placeholder={DEFAULT_DEVICE_ID}
        placeholderTextColor="#6f7b8b"
        style={styles.compactInput}
        onChangeText={props.onDeviceIdChange}
      />
    </View>
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

function compactChatSettings(settings: RemoteControlRuntimeSettingsInput): RemoteControlRuntimeSettingsInput {
  return {
    provider: blankToUndefined(settings.provider),
    modelId: blankToUndefined(settings.modelId),
    apiKey: settings.apiKey ?? '',
    baseUrl: blankToUndefined(settings.baseUrl),
    backend: blankToUndefined(settings.backend),
    orchestration: blankToUndefined(settings.orchestration),
    orchestrationPattern: blankToUndefined(settings.orchestrationPattern),
    worktreeIsolation: settings.worktreeIsolation,
    extensionBlocklist: settings.extensionBlocklist,
    taskCapabilityProfile: settings.taskCapabilityProfile,
  }
}

function emptyDashboard(connection: MobileConnectionState): MobileDashboardModel {
  return {
    connection,
    summary: {
      activeDevices: 0,
      runningRuns: 0,
      pendingApprovals: 0,
      artifactPreviews: 0,
    },
    devices: [],
    runs: [],
    approvals: [],
    artifacts: [],
    chat: {
      sessions: [],
      messages: [],
    },
  }
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function toneStyle(tone: MobileRunItem['statusTone']): Record<string, unknown> {
  if (tone === 'active') return styles.active
  if (tone === 'success') return styles.good
  if (tone === 'danger') return styles.bad
  return styles.muted
}

function statusTextStyle(status: MobileChatMessageItem['status']): Record<string, unknown> {
  if (status === 'streaming' || status === 'queued') return styles.active
  if (status === 'error') return styles.bad
  return styles.good
}

function connectionLabel(connection: string): string {
  if (connection === 'live') return 'Live'
  if (connection === 'connecting') return 'Connecting'
  return 'Offline'
}

function messageCountLabel(count: number): string {
  return count === 1 ? '1 message' : `${String(count)} messages`
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#080d17', padding: 16 },
  mainContent: { flex: 1, minHeight: 0 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
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
  compactInput: { backgroundColor: '#080d17', borderColor: '#ffffff17', borderRadius: 8, borderWidth: 1, color: '#f0f4f8', minHeight: 38, paddingHorizontal: 10 },
  input: { color: '#f0f4f8', minHeight: 58, padding: 0 },
  error: { backgroundColor: '#3a1414', borderColor: '#ff54364d', borderRadius: 8, borderWidth: 1, color: '#ff9a83', marginBottom: 10, padding: 10 },
  chatPane: { flex: 1, minHeight: 0 },
  chatHeader: { alignItems: 'center', backgroundColor: '#121926cc', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, padding: 12 },
  chatTitleBlock: { flex: 1, minWidth: 0 },
  modelBar: { alignItems: 'center', backgroundColor: '#101720', borderColor: '#ffffff17', borderRadius: 8, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 10, paddingVertical: 8 },
  modelLabel: { color: '#ff9a83', fontSize: 11, fontWeight: '900' },
  modelValue: { color: '#aab5c5', flexShrink: 1, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  secondaryButtonCompact: { alignItems: 'center', backgroundColor: '#121926', borderColor: '#ffffff24', borderRadius: 8, borderWidth: 1, minHeight: 32, paddingHorizontal: 11, paddingVertical: 8 },
  sessionStrip: { flexGrow: 0, marginBottom: 8 },
  sessionStripContent: { gap: 8, paddingRight: 2 },
  sessionPill: { borderRadius: 8, borderWidth: 1, maxWidth: 190, minWidth: 138, paddingHorizontal: 11, paddingVertical: 9 },
  sessionPillActive: { backgroundColor: '#2a1518', borderColor: '#ff54365c' },
  sessionPillIdle: { backgroundColor: '#121926', borderColor: '#ffffff17' },
  sessionTitle: { color: '#aab5c5', fontSize: 12, fontWeight: '900' },
  sessionTitleActive: { color: '#ff8d76', fontSize: 12, fontWeight: '900' },
  sessionMeta: { color: '#6f7b8b', fontSize: 10, fontWeight: '700', marginTop: 4 },
  sessionEmpty: { backgroundColor: '#12192680', borderColor: '#ffffff17', borderRadius: 8, borderWidth: 1, marginBottom: 8, padding: 12 },
  sessionEmptyText: { color: '#8a95a6', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  messages: { flex: 1 },
  messagesContent: { gap: 10, paddingBottom: 10 },
  messageRow: { flexDirection: 'row' },
  messageRowUser: { justifyContent: 'flex-end' },
  messageRowAssistant: { justifyContent: 'flex-start' },
  messageBubble: { borderRadius: 8, borderWidth: 1, maxWidth: '86%', padding: 11 },
  userBubble: { backgroundColor: '#2a1518', borderColor: '#ff54365c' },
  assistantBubble: { backgroundColor: '#121926cc', borderColor: '#ffffff1f' },
  messageTopLine: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 6 },
  messageRole: { color: '#f0f4f8', fontSize: 11, fontWeight: '900' },
  messageText: { color: '#dbe5ef', fontSize: 14, lineHeight: 20 },
  chatComposer: { backgroundColor: '#121926cc', borderColor: '#ffffff1f', borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  chatInput: { color: '#f0f4f8', maxHeight: 120, minHeight: 44, padding: 0 },
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
  summary: { flexDirection: 'row', gap: 8, marginBottom: 14 },
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
