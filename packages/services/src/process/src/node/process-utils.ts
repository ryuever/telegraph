import { execFile } from 'child_process';
import { promisify } from 'util';

import PidTree from './PidTree';
import { PidNodeJson } from './types';

const execFileAsync = promisify(execFile);

export async function getPidTree(ppid: string): Promise<PidNodeJson | null> {
  try {
    const whichResult = await execFileAsync('which', ['ps']);
    const command = whichResult.stdout.trim();
    const perfResult = await execFileAsync(command, ['-ax', '-o', 'pid=,ppid=,pcpu=,pmem=,command='], {
      maxBuffer: 1000 * 1024,
      env: { ...process.env, LC_NUMERIC: 'en_US.UTF-8' },
    });
    const records = perfResult.stdout.trim().split('\n');
    const ptree = new PidTree();
    ptree.load(records);
    return ptree.getTree(ppid);
  } catch {
    return null;
  }
}
