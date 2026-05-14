import log from 'electron-log'
import type { GeolocationPosition } from '../plugin/geolocation-orchestrator'

interface DBusMessageBus {
  getProxyObject(name: string, path: string): Promise<DBusProxyObject>
  disconnect(): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface DBusProxyObject {
  getInterface(name: string): DBusInterface
}

interface DBusInterface {
  GetClient?(): Promise<string>
  Start?(): Promise<void>
  Stop?(): Promise<void>
  on(event: string, handler: (...args: unknown[]) => void): void
  removeListener(event: string, handler: (...args: unknown[]) => void): void
}

interface DBusPropertiesInterface {
  Get(interfaceName: string, propertyName: string): Promise<DBusVariant>
  Set(interfaceName: string, propertyName: string, value: DBusVariant): Promise<void>
}

interface DBusVariant {
  value: unknown
}

interface DBusModule {
  sessionBus(): DBusMessageBus
  systemBus(): DBusMessageBus
  Variant: new (type: string, value: unknown) => DBusVariant
}

const GEOCLUE_BUS_NAME = 'org.freedesktop.GeoClue2'
const GEOCLUE_MANAGER_PATH = '/org/freedesktop/GeoClue2/Manager'
const GEOCLUE_MANAGER_IFACE = 'org.freedesktop.GeoClue2.Manager'
const GEOCLUE_CLIENT_IFACE = 'org.freedesktop.GeoClue2.Client'
const GEOCLUE_LOCATION_IFACE = 'org.freedesktop.GeoClue2.Location'
const DBUS_PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties'
const GEOCLUE_ACCURACY_EXACT = 8

let dbusModule: DBusModule | null = null

function loadDBus(): DBusModule | null {
  if (process.platform !== 'linux') return null
  if (dbusModule !== null) return dbusModule

  try {
    dbusModule = require('dbus-next') as DBusModule
    return dbusModule
  } catch (error) {
    log.warn('[GeoClue] Failed to load dbus-next:', error)
    dbusModule = null
    return null
  }
}

function createSafeSystemBus(dbus: DBusModule): Promise<DBusMessageBus> {
  return new Promise((resolve, reject) => {
    try {
      const bus = dbus.systemBus()
      bus.on('error', (error: unknown) => {
        log.warn('[GeoClue] D-Bus connection error:', error)
        reject(error)
      })
      setImmediate(() => resolve(bus))
    } catch (error) {
      reject(error)
    }
  })
}

export async function getLinuxGeoCluePosition(timeoutMs: number): Promise<Omit<GeolocationPosition, 'fallbackUsed' | 'attempts'>> {
  if (process.platform !== 'linux') {
    throw new Error('GeoClue is only available on Linux')
  }

  const dbus = loadDBus()
  if (!dbus) {
    throw new Error('dbus-next is unavailable')
  }

  let bus: DBusMessageBus | null = null
  let clientIface: DBusInterface | null = null
  try {
    bus = await createSafeSystemBus(dbus)
    const managerObject = await bus.getProxyObject(GEOCLUE_BUS_NAME, GEOCLUE_MANAGER_PATH)
    const manager = managerObject.getInterface(GEOCLUE_MANAGER_IFACE)
    if (typeof manager.GetClient !== 'function') {
      throw new Error('GeoClue Manager.GetClient is unavailable')
    }

    const clientPath = await manager.GetClient()
    const clientObject = await bus.getProxyObject(GEOCLUE_BUS_NAME, clientPath)
    clientIface = clientObject.getInterface(GEOCLUE_CLIENT_IFACE)
    const clientProperties = clientObject.getInterface(DBUS_PROPERTIES_IFACE) as unknown as DBusPropertiesInterface

    await clientProperties.Set(GEOCLUE_CLIENT_IFACE, 'DesktopId', new dbus.Variant('s', 'mulby'))
    await clientProperties.Set(GEOCLUE_CLIENT_IFACE, 'RequestedAccuracyLevel', new dbus.Variant('u', GEOCLUE_ACCURACY_EXACT))

    const locationPath = await waitForGeoClueLocation(clientIface, clientProperties, timeoutMs)
    const position = await readGeoClueLocation(bus, locationPath)
    return {
      ...position,
      source: 'native',
      provider: 'linux-geoclue'
    }
  } finally {
    if (clientIface && typeof clientIface.Stop === 'function') {
      try { await clientIface.Stop() } catch { /* ignore cleanup failures */ }
    }
    if (bus) {
      try { bus.disconnect() } catch { /* ignore cleanup failures */ }
    }
  }
}

async function waitForGeoClueLocation(
  clientIface: DBusInterface,
  clientProperties: DBusPropertiesInterface,
  timeoutMs: number
): Promise<string> {
  const existingLocation = await getClientLocationPath(clientProperties)
  if (existingLocation) return existingLocation

  if (typeof clientIface.Start !== 'function') {
    throw new Error('GeoClue Client.Start is unavailable')
  }

  return await new Promise<string>((resolve, reject) => {
    let resolved = false
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`GeoClue timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const cleanup = () => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      try { clientIface.removeListener('LocationUpdated', onLocationUpdated) } catch { /* ignore */ }
    }

    const onLocationUpdated = (_oldLocationPath: unknown, newLocationPath: unknown) => {
      const locationPath = String(newLocationPath || '')
      if (!locationPath) return
      cleanup()
      resolve(locationPath)
    }

    clientIface.on('LocationUpdated', onLocationUpdated)
    clientIface.Start!().catch((error) => {
      cleanup()
      reject(error)
    })
  })
}

async function getClientLocationPath(clientProperties: DBusPropertiesInterface): Promise<string | null> {
  try {
    const location = await clientProperties.Get(GEOCLUE_CLIENT_IFACE, 'Location')
    return parseGeoClueLocationPath(location.value)
  } catch {
    return null
  }
}

export function parseGeoClueLocationPath(value: unknown): string | null {
  const locationPath = String(value || '')
  return locationPath && locationPath !== '/' ? locationPath : null
}

async function readGeoClueLocation(
  bus: DBusMessageBus,
  locationPath: string
): Promise<Omit<GeolocationPosition, 'source' | 'provider' | 'fallbackUsed' | 'attempts'>> {
  const locationObject = await bus.getProxyObject(GEOCLUE_BUS_NAME, locationPath)
  const properties = locationObject.getInterface(DBUS_PROPERTIES_IFACE) as unknown as DBusPropertiesInterface

  const [latitude, longitude, accuracy] = await Promise.all([
    getNumberProperty(properties, GEOCLUE_LOCATION_IFACE, 'Latitude'),
    getNumberProperty(properties, GEOCLUE_LOCATION_IFACE, 'Longitude'),
    getNumberProperty(properties, GEOCLUE_LOCATION_IFACE, 'Accuracy')
  ])

  return {
    latitude,
    longitude,
    accuracy,
    timestamp: Date.now()
  }
}

async function getNumberProperty(
  properties: DBusPropertiesInterface,
  interfaceName: string,
  propertyName: string
): Promise<number> {
  const variant = await properties.Get(interfaceName, propertyName)
  const value = typeof variant.value === 'number' ? variant.value : Number(variant.value)
  if (!Number.isFinite(value)) {
    throw new Error(`GeoClue returned invalid ${propertyName}`)
  }
  return value
}
