declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react'

  export interface StyleProp {
    [key: string]: unknown
  }

  export interface BaseProps {
    children?: ReactNode
    style?: StyleProp | StyleProp[]
    testID?: string
  }

  export interface PressableProps extends BaseProps {
    disabled?: boolean
    onPress?: () => void
  }

  export interface TextInputProps extends BaseProps {
    value?: string
    placeholder?: string
    multiline?: boolean
    onChangeText?: (value: string) => void
  }

  export interface ImageProps extends BaseProps {
    source: { uri: string }
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center'
  }

  export const ActivityIndicator: ComponentType<BaseProps & { size?: 'small' | 'large'; color?: string }>
  export const Image: ComponentType<ImageProps>
  export const Pressable: ComponentType<PressableProps>
  export const SafeAreaView: ComponentType<BaseProps>
  export const ScrollView: ComponentType<BaseProps>
  export const Text: ComponentType<BaseProps>
  export const TextInput: ComponentType<TextInputProps>
  export const View: ComponentType<BaseProps>
  export const StyleSheet: {
    create<T extends Record<string, StyleProp>>(styles: T): T
  }
}
