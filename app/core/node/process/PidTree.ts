import type { PidNodeProps, PidRecord, PidNodeJson } from './types'

class PidNode {
  private _parent: PidNode

  private _children: {
    [key: string]: PidNode
  } = {}

  private name = ''

  private _pid: string

  private _ppid: string

  private _mem: string

  private _cpu: string

  private _command: string

  constructor(props?: PidNodeProps) {
    if (props) this.loadRecord(props)
  }

  get cpu() {
    return this._cpu
  }

  get mem() {
    return this._mem
  }

  get ppid() {
    return this._ppid
  }

  get pid() {
    return this._pid
  }

  get command() {
    return this._command
  }

  get children() {
    return this._children
  }

  get parent() {
    return this._parent
  }

  loadRecord(props: PidNodeProps) {
    this._cpu = props.cpu
    this._mem = props.mem
    this._ppid = props.ppid
    this._pid = props.pid
    this._command = props.command
  }

  addNode(node: PidNode) {
    this.children[`${node.pid}`] = node
    node._parent = this
  }

  toJson(): PidNodeJson {
    return {
      pid: this.pid,
      ppid: this.ppid,
      mem: this.mem,
      cpu: this.cpu,
      command: this.command,
      children: Object.keys(this.children).map(key => this.children[key].toJson()),
    }
  }
}

export default class PidTree {
  private group: {
    [key: string]: PidNode
  } = {}

  load(records: PidRecord[]) {
    records.forEach(record => {
      const reg = /^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)\s+(.+)$/
      const matched = record.match(reg)!
      const pid = matched[1]
      const ppid = matched[2]
      const cpu = matched[3]
      const mem = matched[4]
      const command = matched[5]

      const node = new PidNode({ pid, ppid, cpu, mem, command })
      this.addNode(node)
    })
  }

  addNode(node: PidNode) {
    const pid = node.pid
    const ppid = node.ppid
    let parent = this.group[ppid]
    if (!parent) {
      parent = new PidNode()
      this.group[`${ppid}`] = parent
    }
    parent.addNode(node)
    this.group[`${pid}`] = node
  }

  getTree(pid: string) {
    return this.group[pid].toJson()
  }
}
