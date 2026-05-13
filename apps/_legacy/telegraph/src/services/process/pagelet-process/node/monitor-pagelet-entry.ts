/**
 * monitor 进程的 amdEntry wrapper。
 * pagelet-process-bootstrap 通过 TELEGRAPH_AMD_ENTRY 加载此文件，
 * 此文件 re-export monitor app 的 initApplication。
 */
export { default } from '@monitor/main'