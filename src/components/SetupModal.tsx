import { useState } from 'react'
import { Wifi, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react'
import { discoverBridges, createUser } from '../api/hue'
import { useHue } from '../context/HueContext'

export default function SetupModal() {
  const { setConfig } = useHue()
  const [step, setStep] = useState<'discover' | 'manual' | 'link' | 'done'>('discover')
  const [bridges, setBridges] = useState<{ id: string; internalipaddress: string }[]>([])
  const [selectedIp, setSelectedIp] = useState('')
  const [manualIp, setManualIp] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDiscover = async () => {
    setLoading(true)
    setError('')
    try {
      const found = await discoverBridges()
      setBridges(found)
      if (found.length > 0) {
        setSelectedIp(found[0].internalipaddress)
        setStep('link')
      } else {
        setError("Aucun bridge trouvé. Entrez l'IP manuellement.")
        setStep('manual')
      }
    } catch {
      setError("Impossible de trouver le bridge. Entrez l'IP manuellement.")
      setStep('manual')
    } finally {
      setLoading(false)
    }
  }

  const handleLink = async (ip: string) => {
    setLoading(true)
    setError('')
    try {
      const user = await createUser(ip)
      setConfig({ ip, username: user })
      setStep('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('link button')) {
        setError('Appuyez sur le bouton du bridge Hue, puis réessayez.')
      } else {
        setError(message || 'Erreur de connexion')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleManualConnect = () => {
    if (username) {
      setConfig({ ip: manualIp || selectedIp, username })
    } else {
      handleLink(manualIp || selectedIp)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card rounded-3xl p-8 w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent-orange to-accent-orange-dark flex items-center justify-center">
            <Wifi size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Connexion Hue</h2>
            <p className="text-sm text-text-secondary">Configurez votre bridge Philips Hue</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {step === 'discover' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              Recherchez automatiquement votre bridge Philips Hue sur le réseau local.
            </p>
            <button
              onClick={handleDiscover}
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-accent-orange text-white font-semibold transition-all hover:bg-accent-orange-dark disabled:opacity-50"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Wifi size={16} />}
              {loading ? 'Recherche...' : 'Détecter le bridge'}
            </button>
            <button
              onClick={() => setStep('manual')}
              className="text-sm text-text-secondary hover:text-white transition-colors text-center"
            >
              Saisir l'IP manuellement
            </button>
          </div>
        )}

        {(step === 'manual' || step === 'link') && (
          <div className="flex flex-col gap-4">
            {bridges.length > 0 && (
              <div>
                <label className="text-xs font-medium text-text-secondary mb-2 block">
                  Bridge détecté
                </label>
                <select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange"
                >
                  {bridges.map((b) => (
                    <option key={b.id} value={b.internalipaddress}>
                      {b.internalipaddress} ({b.id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                IP du bridge {bridges.length > 0 ? '(ou autre)' : ''}
              </label>
              <input
                type="text"
                placeholder="192.168.1.x"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-2 block">
                Username API (optionnel — laissez vide pour créer)
              </label>
              <input
                type="text"
                placeholder="Votre clé API Hue"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-bg-primary border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-accent-orange placeholder:text-text-muted"
              />
            </div>

            <div className="bg-accent-orange/10 border border-accent-orange/20 rounded-xl p-3">
              <p className="text-xs text-accent-orange">
                💡 Si vous créez un nouvel utilisateur, appuyez d'abord sur le bouton physique de
                votre bridge Hue, puis cliquez sur Connecter.
              </p>
            </div>

            <button
              onClick={handleManualConnect}
              disabled={loading || (!selectedIp && !manualIp)}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-accent-orange text-white font-semibold transition-all hover:bg-accent-orange-dark disabled:opacity-50"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : null}
              {loading ? 'Connexion...' : 'Connecter'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-accent-green/20 flex items-center justify-center">
              <CheckCircle size={32} className="text-accent-green" />
            </div>
            <p className="text-lg font-bold text-white">Bridge connecté !</p>
            <p className="text-sm text-text-secondary text-center">
              Votre bridge Hue est configuré. Le dashboard va se charger.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
