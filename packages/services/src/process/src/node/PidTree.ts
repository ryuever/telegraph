import { PidNodeJson, PidNodeProps, PidRecord } from './types';

class PidNode {
  private _parent: PidNode | null = null;
  private _children: Record<string, PidNode> = {};
  private _pid = '';
  private _ppid = '';
  private _cpu = '';
  private _mem = '';
  private _command = '';

  constructor(props?: PidNodeProps) {
    if (props) this.loadRecord(props);
  }

  get pid() {
    return this._pid;
  }
  get ppid() {
    return this._ppid;
  }
  get cpu() {
    return this._cpu;
  }
  get mem() {
    return this._mem;
  }
  get command() {
    return this._command;
  }
  get children() {
    return this._children;
  }

  loadRecord(props: PidNodeProps) {
    this._cpu = props.cpu;
    this._mem = props.mem;
    this._ppid = props.ppid;
    this._pid = props.pid;
    this._command = props.command;
  }

  addNode(node: PidNode) {
    this._children[`${node.pid}`] = node;
    node._parent = this;
  }

  toJson(): PidNodeJson {
    return {
      pid: this._pid,
      ppid: this._ppid,
      mem: this._mem,
      cpu: this._cpu,
      command: this._command,
      children: Object.keys(this._children).map((key) =>
        this._children[key].toJson()
      ),
    };
  }
}

export default class PidTree {
  private group: Record<string, PidNode> = {};

  load(records: PidRecord[]) {
    for (const record of records) {
      const reg =
        /^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)\s+(.+)$/;
      const matched = record.match(reg);
      if (!matched) continue;

      const [, pid, ppid, cpu, mem, command] = matched;
      const node = new PidNode({ pid, ppid, cpu, mem, command });
      this.addNode(node);
    }
  }

  addNode(node: PidNode) {
    const ppid = node.ppid;
    if (!this.group[ppid]) {
      this.group[ppid] = new PidNode();
    }
    this.group[ppid].addNode(node);
    this.group[node.pid] = node;
  }

  getTree(pid: string): PidNodeJson | null {
    return this.group[pid]?.toJson() ?? null;
  }
}
