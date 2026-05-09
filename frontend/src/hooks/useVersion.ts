import { useCallback, useEffect, useState } from "react"

interface VersionInfo {
  current: string
  latest: string | null
  update_available: boolean
}

interface UseVersionResult {
  current: string
  updateAvailable: boolean
  latestVersion: string | null
  updating: boolean
  triggerUpdate: () => Promise<void>
}

export function useVersion(): UseVersionResult {
  const [info, setInfo] = useState<VersionInfo>({ current: "", latest: null, update_available: false })
  const [updating, setUpdating] = useState(false)

  const fetchVersion = useCallback(async () => {
    try {
      const r = await fetch("/api/version")
      if (r.ok) setInfo(await r.json())
    } catch {
      // ignore — offline or dev mode
    }
  }, [])

  useEffect(() => {
    fetchVersion()
    const id = setInterval(fetchVersion, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchVersion])

  const triggerUpdate = useCallback(async () => {
    const previous = info.current
    const target = info.latest
    setUpdating(true)
    try {
      const updateResponse = await fetch("/api/update", { method: "POST" })
      if (!updateResponse.ok) throw new Error(await updateResponse.text())
    } catch {
      setUpdating(false)
      return
    }

    // Poll until the restarted service reports the new version. The service often
    // stays reachable while the detached updater is still downloading.
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const r = await fetch("/api/version")
        if (r.ok) {
          const next = await r.json() as VersionInfo
          const reachedTarget = target && next.current === target
          const changedVersion = previous && next.current && next.current !== previous
          const noLongerOutdated = next.latest && next.current === next.latest && !next.update_available
          if (reachedTarget || changedVersion || noLongerOutdated) {
            window.location.reload()
            return
          }
        }
      } catch {
        // Service is restarting.
      }
    }
    await fetchVersion()
    setUpdating(false)
  }, [fetchVersion, info.current, info.latest])

  return {
    current: info.current,
    updateAvailable: info.update_available,
    latestVersion: info.latest,
    updating,
    triggerUpdate,
  }
}
