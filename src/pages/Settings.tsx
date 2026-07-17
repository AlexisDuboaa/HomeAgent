import { useEffect, useState } from 'react'
import { CheckCircle, MapPin, RefreshCw, Trash2, Wifi } from 'lucide-react'
import { useHue } from '../context/HueContext'
import { getLocationConfig, setLocationConfig } from '../api/automations'

export default function Settings() {
  const { config, setConfig, refresh, loading } = useHue()
  const [ip, setIp] = useState(config?.ip ?? '')
  const [username, setUsername] = useState(config?.username ?? '')
  const [saved, setSaved] = useState(false)

  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locationSaved, setLocationSaved] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  useEffect(() => {
    getLocationConfig()
      .then((location) => {
        if (location) {
          setLatitude(String(location.latitude))
          setLongitude(String(location.longitude))
        }
      })
      .catch(() => setLocationError("Impossible de contacter le service d'automatisations."))
  }, [])

  const handleSave = () => {
    if (ip && username) {
      setConfig({ ip, username })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleSaveLocation = async () => {
    const lat = Number(latitude)
    const lng = Number(longitude)
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setLocationError('Latitude et longitude doivent être des nombres.')
      return
    }
    setLocationError(null)
    try {
      await setLocationConfig({ latitude: lat, longitude: lng })
      setLocationSaved(true)
      setTimeout(() => setLocationSaved(false), 2000)
    } catch {
      setLocationError("Impossible de contacter le service d'automatisations.")
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

        {/* Location for sunrise/sunset triggers */}
        <section className="bg-bg-card rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent-purple/20 flex items-center justify-center">
              <MapPin size={18} className="text-accent-purple" />
            </div>
            <h2 className="font-semibold text-white">Localisation</h2>
          </div>
          <p className="text-xs text-text-secondary -mt-2">
            Utilisée pour calculer les horaires de lever et coucher du soleil dans les
            automatisations.
          </p>

          {locationError && <p className="text-sm text-red-400">{locationError}</p>}

          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-text-secondary mb-2 block">Latitude</label>
                <input
                  type="text"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="48.8566"
                  className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-text-secondary mb-2 block">Longitude</label>
                <input
                  type="text"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="2.3522"
                  className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
                />
              </div>
            </div>
            <button
              onClick={handleSaveLocation}
              disabled={!latitude || !longitude}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-orange text-white text-sm font-semibold transition-all hover:bg-accent-orange-dark disabled:opacity-50 self-start"
            >
              {locationSaved ? <CheckCircle size={15} /> : null}
              {locationSaved ? 'Enregistré !' : 'Enregistrer'}
            </button>
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
