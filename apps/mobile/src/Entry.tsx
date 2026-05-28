import type React from 'react'
import Constants from 'expo-constants'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { TelegraphMobileApp } from './App'

declare const process: {
  env: {
    EXPO_PUBLIC_TELEGRAPH_REMOTE_ENDPOINT?: string
    EXPO_PUBLIC_TELEGRAPH_REMOTE_TOKEN?: string
  }
}

const relayEndpoint = process.env.EXPO_PUBLIC_TELEGRAPH_REMOTE_ENDPOINT
const relayToken = process.env.EXPO_PUBLIC_TELEGRAPH_REMOTE_TOKEN
const inferredRelayEndpoint = relayEndpoint ?? inferRelayEndpointFromExpoHost()

export function TelegraphMobileEntry(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <TelegraphMobileApp
        relayEndpoint={inferredRelayEndpoint}
        relayToken={relayToken}
      />
    </SafeAreaProvider>
  )
}

function inferRelayEndpointFromExpoHost(): string | undefined {
  const hostUri = Constants.expoConfig?.hostUri
  if (!hostUri) return undefined
  const host = hostUri.split(':')[0]
  if (!host || host === 'localhost' || host === '127.0.0.1') return undefined
  return `http://${host}:8799/rpc`
}
