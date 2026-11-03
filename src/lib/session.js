import { useSyncExternalStore } from 'react'

const SESSION_KEY = 'buslanka.session'
const listeners = new Set()

function readStored() {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY))
    return stored?.token && stored.expiresAt > Date.now() ? stored : null
  } catch {
    return null
  }
}

let session = readStored()

export function getSession() {
  return session
}

export function setSession(next) {
  session = next
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // The session still works until the page is closed.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSession)
}
