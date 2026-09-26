import { useEffect, useState } from 'react'
import type { GeoPoint } from '@/types'

export type GeoState =
  | { status: 'locating' }
  | { status: 'found'; point: GeoPoint }
  | { status: 'unavailable'; reason: string }

/**
 * Ask for the phone's position once when a collection starts. A collection is
 * never blocked by GPS; it is saved without a location if none is available.
 */
export function useGeolocation(): GeoState {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator
  const [state, setState] = useState<GeoState>(
    supported
      ? { status: 'locating' }
      : { status: 'unavailable', reason: 'This phone cannot share its location.' },
  )

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return
        setState({
          status: 'found',
          point: {
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
            accuracyM: Math.round(pos.coords.accuracy),
          },
        })
      },
      (err) => {
        if (cancelled) return
        setState({
          status: 'unavailable',
          reason:
            err.code === err.PERMISSION_DENIED
              ? 'Location is switched off for this app. Turn it on in your browser settings.'
              : 'Could not get a GPS fix. The collection will be saved without a location.',
        })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
    return () => {
      cancelled = true
    }
  }, [supported])

  return state
}
