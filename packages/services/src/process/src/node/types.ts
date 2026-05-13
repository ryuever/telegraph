export interface PidNodeProps {
  pid: string;
  ppid: string;
  cpu: string;
  mem: string;
  command: string;
}

export type PidRecord = string;

export interface PidNodeJson {
  pid: string;
  ppid: string;
  cpu: string;
  mem: string;
  command: string;
  children: PidNodeJson[];
}
