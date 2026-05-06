import React, { useState } from 'react'
import { DesignEntry } from './DesignEntry'
import { DesignWorkspace } from './DesignWorkspace'

export function DesignPanel() {
  const [prompt, setPrompt] = useState<string | null>(null)

  if (!prompt) {
    return <DesignEntry onSubmit={setPrompt} />
  }

  return <DesignWorkspace initialPrompt={prompt} />
}
