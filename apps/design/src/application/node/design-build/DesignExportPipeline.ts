import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  inferSandboxProjectRoot,
  sandboxVirtualPathForOperation,
} from '@/apps/design/application/common/design-project-contract'
import type {
  DesignExportArtifact,
  DesignExportEntry,
  DesignExportFormat,
  DesignExportablePatchArtifact,
} from '@/apps/design/application/common/design-export-contract'

export interface DesignExportPipelineOptions {
  outputRoot?: string
  now?: () => number
}

export interface DesignExportPipelineRequest {
  runId: string
  artifact: DesignExportablePatchArtifact
  formats: DesignExportFormat[]
}

export class DesignExportPipeline {
  private readonly outputRoot: string
  private readonly now: () => number

  constructor(options: DesignExportPipelineOptions = {}) {
    this.outputRoot = options.outputRoot ?? join(process.cwd(), '.telegraph', 'design-exports')
    this.now = options.now ?? Date.now
  }

  async exportArtifact(request: DesignExportPipelineRequest): Promise<DesignExportArtifact> {
    const createdAt = this.now()
    const exportId = `${request.runId}-${safeSegment(request.artifact.id)}-export`
    const outputDir = join(this.outputRoot, safeSegment(request.artifact.id), exportId)
    const projectRoot = inferSandboxProjectRoot(request.artifact.operations)
    const sourceFiles = sourceFilesFromArtifact(request.artifact)
    const manifest = {
      id: exportId,
      kind: 'design-export',
      sourceArtifactId: request.artifact.id,
      sourceProjectRoot: projectRoot,
      sourceRevision: request.artifact.revision,
      formats: request.formats,
      createdAt,
      files: sourceFiles.map(file => ({ path: file.path, size: Buffer.byteLength(file.content) })),
      metadata: request.artifact.metadata ?? {},
    }
    const manifestPath = join(outputDir, 'export-manifest.json')
    await writeJson(manifestPath, manifest)

    const exports: DesignExportEntry[] = []
    for (const format of request.formats) {
      exports.push(await this.writeFormat({
        format,
        outputDir,
        title: request.artifact.title ?? request.artifact.id,
        sourceArtifactId: request.artifact.id,
        sourceFiles,
        manifest,
      }))
    }

    return {
      id: exportId,
      kind: 'design-export',
      title: `${request.artifact.title ?? request.artifact.id} export`,
      sourceArtifactId: request.artifact.id,
      sourceProjectRoot: projectRoot,
      formats: request.formats,
      themePackId: themePackIdFromArtifact(request.artifact),
      exports,
      manifestPath,
      createdAt,
      metadata: {
        sourceRevision: request.artifact.revision,
        sourceMetadata: request.artifact.metadata ?? {},
      },
    }
  }

  private async writeFormat(input: {
    format: DesignExportFormat
    outputDir: string
    title: string
    sourceArtifactId: string
    sourceFiles: Array<{ path: string; content: string }>
    manifest: unknown
  }): Promise<DesignExportEntry> {
    try {
      if (input.format === 'html-zip') {
        const path = join(input.outputDir, 'html-project.zip')
        const entries = [
          ...input.sourceFiles,
          { path: 'export-manifest.json', content: JSON.stringify(input.manifest, null, 2) },
        ]
        await writeFileEnsured(path, createZip(entries))
        return { format: input.format, path, mediaType: 'application/zip', status: 'generated' }
      }
      if (input.format === 'pdf') {
        const path = join(input.outputDir, 'preview.pdf')
        await writeFileEnsured(path, renderMinimalPdf(input.title, input.sourceArtifactId))
        return { format: input.format, path, mediaType: 'application/pdf', status: 'generated' }
      }
      if (input.format === 'pptx') {
        const path = join(input.outputDir, 'preview-deck.pptx')
        await writeFileEnsured(path, createMinimalPptx({
          title: input.title,
          sourceArtifactId: input.sourceArtifactId,
        }))
        return {
          format: input.format,
          path,
          mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          status: 'generated',
        }
      }
      const path = join(input.outputDir, 'screenshots.json')
      await writeJson(path, {
        sourceArtifactId: input.sourceArtifactId,
        screenshots: [],
        status: 'planned',
      })
      return { format: input.format, path, mediaType: 'application/json', status: 'generated' }
    } catch (error) {
      return {
        format: input.format,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function sourceFilesFromArtifact(
  artifact: DesignExportablePatchArtifact,
): Array<{ path: string; content: string }> {
  const projectRoot = inferSandboxProjectRoot(artifact.operations)
  return artifact.operations
    .filter(operation => operation.kind !== 'delete' && operation.content !== undefined)
    .map(operation => ({
      path: sandboxVirtualPathForOperation(operation.path, projectRoot).replace(/^\/+/, ''),
      content: operation.content ?? '',
    }))
}

function themePackIdFromArtifact(artifact: DesignExportablePatchArtifact): string | undefined {
  const metadata = artifact.metadata
  const themePack = metadata?.themePack
  if (themePack && typeof themePack === 'object' && !Array.isArray(themePack)) {
    const id = (themePack as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  const designSystem = metadata?.designSystem
  if (designSystem && typeof designSystem === 'object' && !Array.isArray(designSystem)) {
    const theme = (designSystem as { themePack?: unknown }).themePack
    if (theme && typeof theme === 'object' && !Array.isArray(theme)) {
      const id = (theme as { id?: unknown }).id
      if (typeof id === 'string') return id
    }
  }
  return undefined
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileEnsured(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeFileEnsured(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

function renderMinimalPdf(title: string, sourceArtifactId: string): Buffer {
  const text = `Design export: ${title}\\nSource artifact: ${sourceArtifactId}`
  const stream = [
    'BT',
    '/F1 18 Tf',
    '72 760 Td',
    `(${escapePdfText(text)}) Tj`,
    'ET',
  ].join('\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${String(Buffer.byteLength(stream))} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ]
  return renderPdfObjects(objects)
}

function renderPdfObjects(objects: string[]): Buffer {
  const chunks = ['%PDF-1.4\n']
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(chunks.join('')))
    chunks.push(object)
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''))
  chunks.push(`xref\n0 ${String(objects.length + 1)}\n`)
  chunks.push('0000000000 65535 f \n')
  for (const offset of offsets.slice(1)) {
    chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(`trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`)
  return Buffer.from(chunks.join(''), 'utf8')
}

function createMinimalPptx(input: { title: string; sourceArtifactId: string }): Buffer {
  return createZip([
    {
      path: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    },
    {
      path: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    },
    {
      path: 'ppt/presentation.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/></p:presentation>',
    },
    {
      path: 'ppt/_rels/presentation.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    },
    {
      path: 'ppt/slides/slide1.xml',
      content: renderSlideXml(input.title, input.sourceArtifactId),
    },
  ])
}

function renderSlideXml(title: string, sourceArtifactId: string): string {
  const body = `${escapeXml(title)} | Source: ${escapeXml(sourceArtifactId)}`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Design Export"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function createZip(entries: Array<{ path: string; content: string | Buffer }>): Buffer {
  const fileRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/^\/+/, ''), 'utf8')
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const crc = crc32(content)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    fileRecords.push(local, content)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralRecords.push(central)
    offset += local.length + content.length
  }
  const centralOffset = offset
  const central = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...fileRecords, central, end])
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE = Array.from({ length: 256 }, (_value, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  }
  return crc >>> 0
})

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\n/g, ') Tj\n0 -24 Td\n(')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}
