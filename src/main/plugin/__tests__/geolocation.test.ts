import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type GeolocationProvider,
  type GeolocationProviderName,
  type GeolocationPosition,
  resolveGeolocationPosition,
  selectProvidersForPlatform
} from '../geolocation-orchestrator'
import {
  parseWindowsLocationPayload,
  parseWindowsLocationStdout
} from '../../services/windows-location-service'
import { parseGeoClueLocationPath } from '../../services/linux-geoclue-location'

function createPosition(overrides: Partial<GeolocationPosition> = {}): GeolocationPosition {
  return {
    latitude: 31.2304,
    longitude: 121.4737,
    accuracy: 35,
    source: 'native',
    provider: 'linux-geoclue',
    timestamp: 1_700_000_000_000,
    fallbackUsed: false,
    attempts: [],
    ...overrides
  }
}

function provider(
  name: GeolocationProviderName,
  locate: GeolocationProvider['locate'],
  available = true
): GeolocationProvider {
  return {
    name,
    source: name === 'ip' ? 'ip' : name === 'electron-web' ? 'web' : 'native',
    isAvailable: () => available,
    locate
  }
}

describe('PluginGeolocation provider orchestration', () => {
  it('selects only the native provider for the current platform before web and IP fallbacks', () => {
    const providers = [
      provider('macos-corelocation', async () => createPosition({ provider: 'macos-corelocation' })),
      provider('windows-location-service', async () => createPosition({ provider: 'windows-location-service' })),
      provider('linux-geoclue', async () => createPosition({ provider: 'linux-geoclue' })),
      provider('electron-web', async () => createPosition({ source: 'web', provider: 'electron-web' })),
      provider('ip', async () => createPosition({ source: 'ip', provider: 'ip' }))
    ]

    assert.deepEqual(
      selectProvidersForPlatform(providers, 'darwin').map((currentProvider) => currentProvider.name),
      ['macos-corelocation', 'electron-web', 'ip']
    )
    assert.deepEqual(
      selectProvidersForPlatform(providers, 'win32').map((currentProvider) => currentProvider.name),
      ['windows-location-service', 'electron-web', 'ip']
    )
    assert.deepEqual(
      selectProvidersForPlatform(providers, 'linux').map((currentProvider) => currentProvider.name),
      ['linux-geoclue', 'electron-web', 'ip']
    )
    assert.deepEqual(
      selectProvidersForPlatform(providers, 'aix').map((currentProvider) => currentProvider.name),
      ['electron-web', 'ip']
    )
  })

  it('returns the first native provider result without calling IP fallback', async () => {
    let ipCalls = 0
    const providers = [
      provider('linux-geoclue', async () => createPosition({ provider: 'linux-geoclue' })),
      provider('ip', async () => {
        ipCalls += 1
        return createPosition({ source: 'ip', provider: 'ip', accuracy: 5000 })
      })
    ]

    const position = await resolveGeolocationPosition(providers, { allowFallback: true })

    assert.equal(position.source, 'native')
    assert.equal(position.provider, 'linux-geoclue')
    assert.equal(position.fallbackUsed, false)
    assert.equal(position.attempts.length, 1)
    assert.deepEqual(position.attempts[0], {
      provider: 'linux-geoclue',
      source: 'native',
      status: 'success',
      accuracy: 35
    })
    assert.equal(ipCalls, 0)
  })

  it('falls back to IP and preserves native failure details when precise providers fail', async () => {
    const providers = [
      provider('linux-geoclue', async () => {
        throw new Error('GeoClue permission denied')
      }),
      provider('electron-web', async () => {
        throw new Error('navigator.geolocation timeout')
      }),
      provider('ip', async () => createPosition({
        latitude: 30,
        longitude: 120,
        accuracy: 5000,
        source: 'ip',
        provider: 'ip'
      }))
    ]

    const position = await resolveGeolocationPosition(providers, { allowFallback: true })

    assert.equal(position.source, 'ip')
    assert.equal(position.provider, 'ip')
    assert.equal(position.fallbackUsed, true)
    assert.deepEqual(position.attempts.map((attempt) => attempt.provider), [
      'linux-geoclue',
      'electron-web',
      'ip'
    ])
    assert.equal(position.attempts[0].status, 'error')
    assert.match(position.attempts[0].message || '', /GeoClue permission denied/)
    assert.equal(position.attempts[1].status, 'error')
    assert.match(position.attempts[1].message || '', /timeout/)
    assert.equal(position.attempts[2].status, 'success')
  })

  it('does not fall back to IP when fallback is disabled', async () => {
    let ipCalls = 0
    const providers = [
      provider('electron-web', async () => {
        throw new Error('web geolocation unavailable')
      }),
      provider('ip', async () => {
        ipCalls += 1
        return createPosition({ source: 'ip', provider: 'ip', accuracy: 5000 })
      })
    ]

    await assert.rejects(
      () => resolveGeolocationPosition(providers, { allowFallback: false }),
      /web geolocation unavailable/
    )
    assert.equal(ipCalls, 0)
  })
})

describe('Windows Location Service payload parsing', () => {
  it('normalizes WinRT Geoposition JSON into a native geolocation position', () => {
    const position = parseWindowsLocationPayload({
      latitude: '31.2304',
      longitude: 121.4737,
      accuracy: 42.5,
      altitude: 12,
      timestamp: 1_700_000_000_123
    })

    assert.equal(position.source, 'native')
    assert.equal(position.provider, 'windows-location-service')
    assert.equal(position.latitude, 31.2304)
    assert.equal(position.longitude, 121.4737)
    assert.equal(position.accuracy, 42.5)
    assert.equal(position.altitude, 12)
    assert.equal(position.timestamp, 1_700_000_000_123)
  })

  it('parses stdout with NaN optional fields without rejecting the native fix', () => {
    const position = parseWindowsLocationStdout('31.2304\t121.4737\t42.5\t12\t\tNaN\tNaN\t1700000000123')

    assert.equal(position.provider, 'windows-location-service')
    assert.equal(position.latitude, 31.2304)
    assert.equal(position.longitude, 121.4737)
    assert.equal(position.accuracy, 42.5)
    assert.equal(position.altitude, 12)
    assert.equal(position.heading, undefined)
    assert.equal(position.speed, undefined)
    assert.equal(position.timestamp, 1_700_000_000_123)
  })
})

describe('Linux GeoClue payload parsing', () => {
  it('treats the D-Bus root path as an empty GeoClue location', () => {
    assert.equal(parseGeoClueLocationPath('/'), null)
    assert.equal(parseGeoClueLocationPath(''), null)
    assert.equal(
      parseGeoClueLocationPath('/org/freedesktop/GeoClue2/Location/1'),
      '/org/freedesktop/GeoClue2/Location/1'
    )
  })
})
