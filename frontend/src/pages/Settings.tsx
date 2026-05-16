import React, { useEffect, useState } from "react"
import { ThemeToggle } from "../components/ui/ThemeToggle"
import { formatProviderName } from "../utils"
import { useConfig } from "../hooks/useConfig"
import type { ModelPricing, ProviderId, ProviderSummary } from "../types"

const PROVIDER_COLOR_VARS: Record<string, string> = {
  gemini: "var(--gemini)",
  codex: "var(--codex)",
  copilot: "var(--copilot)",
  claude: "var(--claude)",
}

interface ProviderFormState {
  enabled: boolean
  home_path: string
}

function providerToForm(p: ProviderSummary): ProviderFormState {
  return {
    enabled: p.enabled,
    home_path: p.config.home_path,
  }
}

export function Settings(): React.JSX.Element {
  const { config, providers, busy, updateConfig, createProvider, updateProvider, deleteProvider, scanProvider } = useConfig()

  const [syncMinutes, setSyncMinutes] = useState(5)
  const [daemonSaving, setDaemonSaving] = useState(false)
  const [daemonSaved, setDaemonSaved] = useState(false)

  const [pricing, setPricing] = useState<Record<string, ModelPricing>>({})
  const [pricingSearch, setPricingSearch] = useState("")
  const [pricingSaving, setPricingSaving] = useState(false)
  const [pricingSaved, setPricingSaved] = useState(false)

  const [providerForms, setProviderForms] = useState<Record<string, ProviderFormState>>({})

  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newBaseProvider, setNewBaseProvider] = useState("gemini")
  const [newDisplayName, setNewDisplayName] = useState("")
  const [newHomePath, setNewHomePath] = useState("")
  const [homePathEdited, setHomePathEdited] = useState(false)

  useEffect(() => {
    if (config) {
      setSyncMinutes(
        config.daemon.sync_interval_minutes ??
          config.daemon.passive_sync_interval_minutes ??
          5,
      )
      setPricing(config.pricing || {})
    }
  }, [config])

  useEffect(() => {
    if (providers.length > 0) {
      const next: Record<string, ProviderFormState> = {}
      providers.forEach((p) => {
        next[p.id] = providerToForm(p)
      })
      setProviderForms(next)
    }
  }, [providers])

  async function handleSaveDaemon(): Promise<void> {
    setDaemonSaving(true)
    try {
      await updateConfig({ sync_interval_minutes: syncMinutes })
      setDaemonSaved(true)
      setTimeout(() => setDaemonSaved(false), 2000)
    } finally {
      setDaemonSaving(false)
    }
  }

  async function handleSavePricing(): Promise<void> {
    setPricingSaving(true)
    try {
      await updateConfig({ pricing })
      setPricingSaved(true)
      setTimeout(() => setPricingSaved(false), 2000)
    } finally {
      setPricingSaving(false)
    }
  }

  function updatePricingField(key: string, field: keyof ModelPricing, value: string): void {
    const num = parseFloat(value) || 0
    setPricing((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: num },
    }))
  }

  async function handleSaveProvider(id: string): Promise<void> {
    const form = providerForms[id]
    if (!form) return
    setActionBusy(`save-${id}`)
    try {
      await updateProvider(id, { enabled: form.enabled, home_path: form.home_path })
    } finally {
      setActionBusy(null)
    }
  }

  async function handleSync(id: string): Promise<void> {
    setActionBusy(`sync-${id}`)
    try {
      await scanProvider(id)
    } finally {
      setActionBusy(null)
    }
  }

  async function handleDeleteProvider(id: string): Promise<void> {
    if (!window.confirm(`Are you sure you want to delete the secondary account "${formatProviderName(id)}"? This will also delete all its history.`)) return
    setActionBusy(`delete-${id}`)
    try {
      await deleteProvider(id)
    } finally {
      setActionBusy(null)
    }
  }

  function setProviderField<K extends keyof ProviderFormState>(
    id: string,
    field: K,
    value: ProviderFormState[K],
  ): void {
    setProviderForms((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
  }

  async function handleAddProvider(): Promise<void> {
    if (!newDisplayName.trim() || !newHomePath.trim()) return
    const account_name = newDisplayName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    if (!account_name) return

    await createProvider({
      base_provider: newBaseProvider,
      account_name,
      display_name: newDisplayName.trim(),
      home_path: newHomePath.trim(),
    })
    setIsAddModalOpen(false)
    setNewDisplayName("")
    setNewHomePath("")
    setHomePathEdited(false)
  }

  if (!config && !busy) {
    return (
      <div style={{ padding: "22px 28px" }}>
        <div
          style={{
            background: "color-mix(in oklab, var(--crit) 12%, transparent)",
            border: "1px solid color-mix(in oklab, var(--crit) 28%, transparent)",
            borderRadius: "var(--radius-2)",
            padding: "12px 16px",
            fontSize: 13,
            color: "var(--crit)",
          }}
        >
          Failed to load configuration. Make sure the daemon is running.
        </div>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-2)",
    border: "1px solid var(--border-1)",
    borderRadius: "var(--radius-1)",
    padding: "8px 12px",
    fontSize: 13,
    color: "var(--fg-1)",
    fontFamily: "inherit",
    width: "100%",
    outline: "none",
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-crumb">
          <span className="crumb-title">Settings</span>
        </div>
        <div className="topbar-spacer" />
        <ThemeToggle />
      </div>

      <div className="page">
        <div className="page-head">
          <div>
            <div className="page-title">Settings</div>
            <div className="page-sub">Daemon and provider configuration</div>
          </div>
        </div>

        {/* Daemon settings card */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">Daemon Settings</span>
          </div>
          <div className="card-body">
            <div style={{ maxWidth: 320 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                  Sync interval (minutes)
                </span>
                <input
                  type="number"
                  min={1}
                  value={syncMinutes}
                  onChange={(e) => setSyncMinutes(Number(e.target.value))}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
              <button
                className="icon-btn primary"
                disabled={daemonSaving}
                onClick={handleSaveDaemon}
              >
                {daemonSaving ? "Saving…" : "Save"}
              </button>
              {daemonSaved && (
                <span style={{ fontSize: 12, color: "var(--ok)" }}>Saved!</span>
              )}
            </div>
            {config && (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border-1)",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  fontSize: 12,
                  color: "var(--fg-3)",
                }}
              >
                <span>
                  Host:{" "}
                  <span style={{ color: "var(--fg-2)" }}>
                    {config.daemon.web_host}:{config.daemon.web_port}
                  </span>
                </span>
                <span>
                  DB:{" "}
                  <code style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>
                    {config.daemon.database_path}
                  </code>
                </span>
                <span>
                  Log level:{" "}
                  <span style={{ color: "var(--fg-2)" }}>{config.daemon.log_level}</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Pricing card */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">Model Pricing</span>
            <div className="card-actions">
              <input
                type="text"
                placeholder="Filter models..."
                className="select"
                style={{ width: 180, height: 28, padding: "0 8px" }}
                value={pricingSearch}
                onChange={(e) => setPricingSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              <table className="table" style={{ borderTop: "none" }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, background: "var(--bg-1)", zIndex: 10 }}>
                    <th>Model Key</th>
                    <th className="num">Input ($/1M)</th>
                    <th className="num">Cached ($/1M)</th>
                    <th className="num">Output ($/1M)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pricing)
                    .filter(([k]) => k.toLowerCase().includes(pricingSearch.toLowerCase()))
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, p]) => (
                      <tr key={key}>
                        <td className="mono" style={{ fontSize: 11 }}>{key}</td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.0001"
                            value={p.input_1m}
                            onChange={(e) => updatePricingField(key, "input_1m", e.target.value)}
                            style={{ ...inputStyle, width: 75, textAlign: "right", padding: "4px 6px" }}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.0001"
                            value={p.cached_1m}
                            onChange={(e) => updatePricingField(key, "cached_1m", e.target.value)}
                            style={{ ...inputStyle, width: 75, textAlign: "right", padding: "4px 6px" }}
                          />
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            step="0.0001"
                            value={p.output_1m}
                            onChange={(e) => updatePricingField(key, "output_1m", e.target.value)}
                            style={{ ...inputStyle, width: 75, textAlign: "right", padding: "4px 6px" }}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16, borderTop: "1px solid var(--border-1)", display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="icon-btn primary"
                disabled={pricingSaving}
                onClick={handleSavePricing}
              >
                {pricingSaving ? "Saving…" : "Save Pricing"}
              </button>
              {pricingSaved && (
                <span style={{ fontSize: 12, color: "var(--ok)" }}>Saved!</span>
              )}
              <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
                Key format: <code>provider_id:model_name</code>
              </span>
            </div>
          </div>
        </div>

        {/* Provider cards */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div className="section-title">Providers</div>
          <button
            className="icon-btn primary"
            onClick={() => setIsAddModalOpen(true)}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add secondary account
          </button>
        </div>

        <div className="grid-2eq">
          {providers.map((p) => {
            const id = p.id
            const baseId = id.split(":")[0]
            const form = providerForms[id]
            if (!form) return null
            const isBusy = actionBusy !== null || busy
            const color = PROVIDER_COLOR_VARS[baseId] || "var(--fg-1)"
            
            const label = formatProviderName(id, p.config?.display_name)

            return (
              <div key={id} className="card">
                <div className="card-head">
                  <span className="card-title" style={{ color }}>
                    {label}
                  </span>
                  <div className="card-actions">
                    <span
                      className={`tag${form.enabled ? " ok" : ""}`}
                    >
                      {form.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
                <div className="card-body">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr",
                      gap: 16,
                      marginBottom: 16,
                    }}
                  >
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Home path</span>
                      <input
                        type="text"
                        value={form.home_path}
                        onChange={(e) => setProviderField(id, "home_path", e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                  </div>

                  <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Toggle
                      label="Enabled"
                      checked={form.enabled}
                      onChange={(v) => setProviderField(id, "enabled", v)}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="icon-btn"
                        disabled={isBusy && actionBusy !== `sync-${id}`}
                        onClick={() => handleSync(id)}
                        style={{ padding: "4px 8px", fontSize: 12 }}
                      >
                        {actionBusy === `sync-${id}` ? "Syncing…" : "Sync"}
                      </button>
                      {id.includes(":") && (
                        <button
                          className="icon-btn"
                          disabled={isBusy && actionBusy !== `delete-${id}`}
                          onClick={() => handleDeleteProvider(id)}
                          style={{ padding: "4px 8px", fontSize: 12, color: "var(--crit)", borderColor: "color-mix(in oklab, var(--crit) 30%, transparent)" }}
                        >
                          {actionBusy === `delete-${id}` ? "Deleting…" : "Delete"}
                        </button>
                      )}
                      <button
                        className="icon-btn primary"
                        disabled={isBusy && actionBusy !== `save-${id}`}
                        onClick={() => handleSaveProvider(id)}
                        style={{ padding: "4px 8px", fontSize: 12 }}
                      >
                        {actionBusy === `save-${id}` ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {isAddModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, backdropFilter: "blur(2px)"
        }}>
          <div className="card" style={{ width: 400, padding: 0, overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "12px 16px" }}>
              <span className="card-title">Add secondary account</span>
              <button className="icon-btn" onClick={() => setIsAddModalOpen(false)}>✕</button>
            </div>
            <div className="card-body" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Base provider</span>
                <select
                  className="select"
                  value={newBaseProvider}
                  onChange={(e) => {
                    setNewBaseProvider(e.target.value)
                    if (!homePathEdited) {
                      const slug = newDisplayName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-") || "secondary"
                      setNewHomePath(`~/.${e.target.value}-${slug}`)
                    }
                  }}
                  style={{ width: "100%", height: 32 }}
                >
                  <option value="gemini">Gemini</option>
                  <option value="codex">Codex</option>
                  <option value="copilot">Copilot</option>
                  <option value="claude">Claude</option>
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Display name (e.g. Personal Laptop)</span>
                <input
                  type="text"
                  placeholder="My Secondary Account"
                  value={newDisplayName}
                  onChange={(e) => {
                    setNewDisplayName(e.target.value)
                    if (!homePathEdited) {
                      const slug = e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
                      if (slug) setNewHomePath(`~/.${newBaseProvider}-${slug}`)
                      else setNewHomePath(`~/.${newBaseProvider}-secondary`)
                    }
                  }}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Directory path</span>
                <input
                  type="text"
                  value={newHomePath}
                  onChange={(e) => {
                    setNewHomePath(e.target.value)
                    setHomePathEdited(true)
                  }}
                  style={inputStyle}
                />
              </label>

              <div style={{
                background: "color-mix(in oklab, var(--warn) 10%, transparent)",
                border: "1px solid color-mix(in oklab, var(--warn) 25%, transparent)",
                borderRadius: "var(--radius-1)",
                padding: "10px 12px",
                fontSize: 12,
                color: "var(--warn-text, var(--fg-2))",
                lineHeight: 1.4
              }}>
                <strong>⚠️ Credentials required:</strong> You must manually copy your auth credentials (e.g. <code>oauth_creds.json</code>) into this folder for quota tracking to work.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button className="icon-btn" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
                <button
                  className="icon-btn primary"
                  disabled={!newDisplayName || !newHomePath || busy}
                  onClick={handleAddProvider}
                >
                  {busy ? "Adding…" : "Add account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


interface ToggleProps {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}

function Toggle({ label, checked, onChange }: ToggleProps): React.JSX.Element {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          display: "inline-flex",
          width: 36,
          height: 20,
          borderRadius: 99,
          background: checked ? "var(--accent)" : "var(--border-2)",
          cursor: "pointer",
          transition: "background 120ms",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: 99,
            background: "white",
            transition: "left 120ms",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </div>
      <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{label}</span>
    </label>
  )
}
