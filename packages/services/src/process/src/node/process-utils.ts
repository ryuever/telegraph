import PidTree from './PidTree';
import { PidNodeJson } from './types';

export async function getPidTree(ppid: string): Promise<PidNodeJson | null> {
  try {
    const cp = require('child_process');
    const util = require('util');
    const exec = util.promisify(cp.exec);

    const whichResult = await exec('which ps');
    const command = whichResult.stdout.toString().trim();
    const args = '-ax -o pid=,ppid=,pcpu=,pmem=,command=';
    const perfResult = await exec(`${command} ${args}`, {
      maxBuffer: 1000 * 1024,
      env: { LC_NUMERIC: 'en_US.UTF-8' },
    });
    const records = perfResult.stdout.trim().split('\n');
    const ptree = new PidTree();
    ptree.load(records);
    return ptree.getTree(ppid);
  } catch {
    return null;
  }
}
