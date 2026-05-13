import { exec as cpexec } from 'child_process'
import { promisify } from 'util'
import PidTree from './PidTree'

const exec = promisify(cpexec)

export const getUsageInfo = (ppid: string) => {
  return new Promise(resolve => {
    exec('which ps').then(whichResult => {
      const command = whichResult.stdout.toString().trim()
      const args = '-ax -o pid=,ppid=,pcpu=,pmem=,command='
      exec(`${command} ${args}`, {
        maxBuffer: 1000 * 1024,
        env: { LC_NUMERIC: 'en_US.UTF-8' },
      }).then(perfResult => {
        const { stdout } = perfResult
        const records = stdout.trim().split('\n')
        const ptree = new PidTree()
        ptree.load(records)
        resolve(ptree.getTree(ppid))
      })
    })
  })
}
