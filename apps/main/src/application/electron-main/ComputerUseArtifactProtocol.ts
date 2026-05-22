import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createId, inject, injectable } from '@x-oasis/di';
import { protocol } from 'electron';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

export interface IComputerUseArtifactProtocol {
  start(): void;
}

export const ComputerUseArtifactProtocolId = createId('ComputerUseArtifactProtocol');

const COMPUTER_USE_ARTIFACT_HOST = 'computer-use-artifacts';

@injectable()
export class ComputerUseArtifactProtocol implements IComputerUseArtifactProtocol {
  private registered = false;

  constructor(
    @inject(LogServiceId) private readonly logger: ILogger
  ) {}

  start(): void {
    if (this.registered) return;
    this.registered = true;

    protocol.handle('telegraph', async (request) => {
      const resolved = resolveComputerUseArtifactPath(request.url);
      if (!resolved) {
        return new Response('Not found', { status: 404 });
      }

      try {
        const bytes = await readFile(resolved.path);
        return new Response(bytes, {
          headers: {
            'content-type': mediaTypeForPath(resolved.path),
            'cache-control': 'no-store',
          },
        });
      } catch (error) {
        this.logger.warn('[ComputerUseArtifactProtocol] artifact read failed', {
          url: request.url,
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response('Not found', { status: 404 });
      }
    });

    this.logger.info('[ComputerUseArtifactProtocol] telegraph:// handler registered');
  }
}

export function registerTelegraphProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'telegraph',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  }]);
}

export function resolveComputerUseArtifactPath(
  url: string,
  baseDir = join(process.cwd(), '.telegraph', 'computer-use-artifacts')
): { path: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'telegraph:' || parsed.hostname !== COMPUTER_USE_ARTIFACT_HOST) {
    return null;
  }

  const segments: string[] = [];
  for (const rawSegment of parsed.pathname.split('/').filter(Boolean)) {
    try {
      segments.push(decodeURIComponent(rawSegment));
    } catch {
      return null;
    }
  }
  if (segments.length < 2 || segments.some(segment => segment === '..' || segment.includes('/') || segment.includes('\\'))) {
    return null;
  }

  const root = resolve(baseDir);
  const path = resolve(root, ...segments);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    return null;
  }

  return { path };
}

function mediaTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
