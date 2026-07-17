import { useState } from 'react'
import { Wifi, Trash2, RefreshCw, CheckCircle } from 'lucide-react'
import { useHue } from '../context/HueContext'

export default function Settings() {
  const { config, setConfig, refresh, loading } = useHue()
  const [ip, setIp] = useState(config?.ip ?? '')
  const [username, setUsername] = useState(config?.username ?? '')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    if (ip && username) {
      setConfig({ ip, username })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleReset = () => {
    localStorage.removeItem('hue_bridge_config')
    window.location.reload()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0">
        <h1 className="text-2xl font-bold text-white">Paramètres</h1>
        <p className="text-sm text-text-secondary mt-1">Configuration du bridge Hue</p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-6 max-w-lg">
        {/* Bridge config */}
        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent-orange/20 flex items-center justify-center">
              <Wifi size={18} className="text-accent-orange" />
            </div>
            <h2 className="font-semibold text-white">Bridge Philips Hue</h2>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                Adresse IP du bridge
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.x"
                className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                Clé API (username)
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Votre clé API Hue"
                className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted font-mono text-xs"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={!ip || !username}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold transition-all hover:bg-accent-orange-dark disabled:opacity-50"
              >
                {saved ? <CheckCircle size={15} /> : null}
                {saved ? 'Enregistré !' : 'Enregistrer'}
              </button>
              <button
                onClick={refresh}
                disabled={loading || !config}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-hover text-text-secondary text-sm font-medium transition-all hover:text-white"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                Actualiser
              </button>
            </div>
          </div>
        </section>

        {/* Status */}
        {config && (
          <section className="bg-bg-card rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-4">Statut</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Bridge IP</span>
                <span className="text-sm font-mono text-white">{config.ip}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Connexion</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                  <span className="text-sm text-accent-green">Connecté</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
          <h2 className="font-semibold text-red-400 mb-3">Zone de danger</h2>
          <p className="text-sm text-text-secondary mb-4">
            Réinitialiser la configuration supprimera toutes les données enregistrées.
          </p>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/40 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-all"
          >
            <Trash2 size={15} />
            Réinitialiser la configuration
          </button>
        </section>
      </div>
    </div>
  )
}
