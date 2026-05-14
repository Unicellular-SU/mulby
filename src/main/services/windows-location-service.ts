import { execFile } from 'child_process'
import { promisify } from 'util'
import log from 'electron-log'
import type { GeolocationPosition } from '../plugin/geolocation-orchestrator'

const execFileAsync = promisify(execFile)

interface WindowsLocationPayload {
  latitude?: unknown
  longitude?: unknown
  accuracy?: unknown
  altitude?: unknown
  altitudeAccuracy?: unknown
  heading?: unknown
  speed?: unknown
  timestamp?: unknown
}

const POWERSHELL_LOCATION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation\`1,Windows.Foundation,ContentType=WindowsRuntime]

function Await-WinRtAsyncOperation($Operation, [Type]$ResultType, [int]$TimeoutMs) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1).MakeGenericMethod($ResultType)
  $task = $asTask.Invoke($null, @($Operation))
  if (-not $task.Wait($TimeoutMs)) {
    throw "Windows Location Service timed out after $TimeoutMs ms"
  }
  return $task.Result
}

function Format-LocationValue($Value) {
  if ($null -eq $Value) { return '' }
  return [System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture)
}

$timeoutMs = [int]$env:MULBY_GEOLOCATION_TIMEOUT_MS
if ($timeoutMs -lt 1000) { $timeoutMs = 10000 }

$geolocator = [Windows.Devices.Geolocation.Geolocator]::new()
$geolocator.DesiredAccuracyInMeters = 50
$operation = $geolocator.GetGeopositionAsync()
$position = Await-WinRtAsyncOperation $operation ([Windows.Devices.Geolocation.Geoposition]) $timeoutMs
$coordinate = $position.Coordinate
$point = $coordinate.Point.Position

$values = @(
  $point.Latitude,
  $point.Longitude,
  $coordinate.Accuracy,
  $point.Altitude,
  $coordinate.AltitudeAccuracy,
  $coordinate.Heading,
  $coordinate.Speed,
  ([DateTimeOffset]$coordinate.Timestamp).ToUnixTimeMilliseconds()
)
$tab = [string][char]9
[Console]::Out.WriteLine(($values | ForEach-Object { Format-LocationValue $_ }) -join $tab)
`

export async function getWindowsLocationServicePosition(
  timeoutMs: number
): Promise<Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'>> {
  if (process.platform !== 'win32') {
    throw new Error('Windows Location Service is only available on Windows')
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_LOCATION_SCRIPT],
      {
        timeout: timeoutMs + 2_000,
        env: {
          ...process.env,
          MULBY_GEOLOCATION_TIMEOUT_MS: String(timeoutMs)
        },
        windowsHide: true
      }
    )
    return parseWindowsLocationStdout(stdout)
  } catch (error) {
    log.warn('[WindowsLocation] Failed to get location:', error)
    throw error
  }
}

export function parseWindowsLocationStdout(
  stdout: string
): Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'> {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!line) {
    throw new Error('Windows Location Service returned empty output')
  }
  const [
    latitude,
    longitude,
    accuracy,
    altitude,
    altitudeAccuracy,
    heading,
    speed,
    timestamp
  ] = line.split('\t')

  return parseWindowsLocationPayload({
    latitude,
    longitude,
    accuracy,
    altitude,
    altitudeAccuracy,
    heading,
    speed,
    timestamp
  })
}

export function parseWindowsLocationPayload(
  payload: WindowsLocationPayload
): Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'> {
  const latitude = parseFiniteNumber(payload.latitude)
  const longitude = parseFiniteNumber(payload.longitude)
  const accuracy = parseFiniteNumber(payload.accuracy)

  if (latitude === null || longitude === null || accuracy === null) {
    throw new Error('Windows Location Service returned invalid coordinates')
  }

  return {
    latitude,
    longitude,
    accuracy,
    source: 'native',
    provider: 'windows-location-service',
    altitude: parseFiniteNumber(payload.altitude) ?? undefined,
    altitudeAccuracy: parseFiniteNumber(payload.altitudeAccuracy) ?? undefined,
    heading: parseFiniteNumber(payload.heading) ?? undefined,
    speed: parseFiniteNumber(payload.speed) ?? undefined,
    timestamp: parseFiniteNumber(payload.timestamp) ?? Date.now()
  }
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
