import { useState } from 'react'
import type { JSX } from 'react'
import { DesignEntry } from './DesignEntry'
import { DesignWorkspace } from './DesignWorkspace'

export function DesignView(): JSX.Element {
  const [prompt, setPrompt] = useState<string | null>(null)

  if (prompt !== null) {
    return <DesignWorkspace initialPrompt={prompt} />
  }
  return <DesignEntry onSubmit={setPrompt} />
}
