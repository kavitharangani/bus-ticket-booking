import { useCallback, useEffect, useState } from 'react'

// Keeps the previous data while reloading, so the page doesn't flicker.
export function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setState((previous) => ({ ...previous, error: null, loading: true }))
    load().then(
      (data) => current && setState({ data, error: null, loading: false }),
      (error) => current && setState((previous) => ({ ...previous, error, loading: false })),
    )
    return () => {
      current = false
    }
  }, [...deps, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { ...state, reload }
}
