import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd(), '.telegraph/design-corpus')

let entries = []
try {
  entries = await readdir(root)
} catch {
  entries = []
}

let total = 0
let malformed = 0
for (const entry of entries.filter(name => name.endsWith('.json'))) {
  total += 1
  try {
    const parsed = JSON.parse(await readFile(join(root, entry), 'utf8'))
    if (!parsed?.id || !parsed?.artifact?.operations) malformed += 1
  } catch {
    malformed += 1
  }
}

console.log(JSON.stringify({
  corpusRoot: root,
  total,
  malformed,
  status: malformed === 0 ? 'pass' : 'failed',
}, null, 2))
