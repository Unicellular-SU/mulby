import type { ChildProcess } from 'node:child_process'

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400
const JOB_OBJECT_BASIC_LIMIT_INFORMATION_CLASS = 2
const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100

interface WindowsJobApi {
  CreateJobObjectW: (securityAttributes: null, name: null) => unknown
  SetInformationJobObject: (job: unknown, infoClass: number, info: unknown, length: number) => boolean
  OpenProcess: (desiredAccess: number, inheritHandle: boolean, processId: number) => unknown
  AssignProcessToJobObject: (job: unknown, process: unknown) => boolean
  CloseHandle: (handle: unknown) => boolean
  GetLastError: () => number
  BasicLimitInformation: ReturnType<typeof import('koffi')['opaque']>
  koffi: typeof import('koffi')
}

let cachedApi: WindowsJobApi | null | undefined

function loadWindowsJobApi(): WindowsJobApi | null {
  if (process.platform !== 'win32') return null
  if (cachedApi !== undefined) return cachedApi

  try {
    // `koffi` is already used elsewhere in the app for Windows native calls.
    // Keep it lazy so non-Windows platforms never load the optional native package.
    const koffi = require('koffi') as typeof import('koffi')
    const kernel32 = koffi.load('kernel32.dll')
    const BasicLimitInformation = koffi.struct('MULBY_JOBOBJECT_BASIC_LIMIT_INFORMATION', {
      PerProcessUserTimeLimit: 'int64_t',
      PerJobUserTimeLimit: 'int64_t',
      LimitFlags: 'uint32_t',
      MinimumWorkingSetSize: 'uintptr_t',
      MaximumWorkingSetSize: 'uintptr_t',
      ActiveProcessLimit: 'uint32_t',
      Affinity: 'uintptr_t',
      PriorityClass: 'uint32_t',
      SchedulingClass: 'uint32_t'
    })

    cachedApi = {
      CreateJobObjectW: kernel32.func('void* __stdcall CreateJobObjectW(void* lpJobAttributes, const char16_t* lpName)'),
      SetInformationJobObject: kernel32.func('bool __stdcall SetInformationJobObject(void* hJob, int JobObjectInfoClass, void* lpJobObjectInfo, uint32_t cbJobObjectInfoLength)'),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
      AssignProcessToJobObject: kernel32.func('bool __stdcall AssignProcessToJobObject(void* hJob, void* hProcess)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void* hObject)'),
      GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
      BasicLimitInformation,
      koffi
    }
    return cachedApi
  } catch {
    cachedApi = null
    return null
  }
}

function isNullHandle(value: unknown): boolean {
  return value === null || value === undefined || value === 0 || value === BigInt(0)
}

export function isWindowsJobObjectSandboxAvailable(): boolean {
  return loadWindowsJobApi() !== null
}

export function assignChildToWindowsJobObject(child: ChildProcess): () => void {
  const api = loadWindowsJobApi()
  if (!api) {
    throw new Error('Windows Job Object backend is unavailable')
  }
  if (!child.pid) {
    throw new Error('Cannot assign child process to Job Object before pid is available')
  }

  const job = api.CreateJobObjectW(null, null)
  if (isNullHandle(job)) {
    throw new Error(`CreateJobObjectW failed: ${api.GetLastError()}`)
  }

  let processHandle: unknown
  try {
    const limits = {
      PerProcessUserTimeLimit: BigInt(0),
      PerJobUserTimeLimit: BigInt(0),
      LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
      MinimumWorkingSetSize: BigInt(0),
      MaximumWorkingSetSize: BigInt(0),
      ActiveProcessLimit: 0,
      Affinity: BigInt(0),
      PriorityClass: 0,
      SchedulingClass: 0
    }

    const ok = api.SetInformationJobObject(
      job,
      JOB_OBJECT_BASIC_LIMIT_INFORMATION_CLASS,
      api.koffi.as(limits, api.koffi.pointer(api.BasicLimitInformation)),
      api.koffi.sizeof(api.BasicLimitInformation)
    )
    if (!ok) {
      throw new Error(`SetInformationJobObject failed: ${api.GetLastError()}`)
    }

    processHandle = api.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, child.pid)
    if (isNullHandle(processHandle)) {
      throw new Error(`OpenProcess failed: ${api.GetLastError()}`)
    }

    if (!api.AssignProcessToJobObject(job, processHandle)) {
      throw new Error(`AssignProcessToJobObject failed: ${api.GetLastError()}`)
    }

    return () => {
      if (!isNullHandle(processHandle)) {
        api.CloseHandle(processHandle)
        processHandle = null
      }
      api.CloseHandle(job)
    }
  } catch (error) {
    if (!isNullHandle(processHandle)) api.CloseHandle(processHandle)
    api.CloseHandle(job)
    throw error
  }
}
