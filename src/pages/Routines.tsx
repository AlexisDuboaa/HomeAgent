import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Lightbulb, Plus, Radar, Sun, Trash2 } from 'lucide-react'
import { deleteAutomation, getAutomations, toggleAutomation } from '../api/automations'
import type { Automation } from '../types/automation'

const TRIGGER_ICONS = {
  time: Clock,
  sun: Sun,
  sensor: Radar,
  light_state: Lightbulb,
} as const

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function describeTrigger(automation: Automation): string {
  const { trigger } = automation
  if (trigger.type === 'time') {
    const days = trigger.days.length === 0 ? 'Tous les jours' : trigger.days.map((d) => DAY_LABELS[d]).join(', ')
    const time = `${String(trigger.hour).padStart(2, '0')}:${String(trigger.minute).padStart(2, '0')}`
    return `${time} · ${days}`
  }
  if (trigger.type === 'sun') {
    const label = trigger.event === 'sunrise' ? 'lever du soleil' : 'coucher du soleil'
    const offset =
      trigger.offsetMinutes === 0 ? '' : ` (${trigger.offsetMinutes > 0 ? '+' : ''}${trigger.offsetMinutes} min)`
    return `Au ${label}${offset}`
  }
  if (trigger.type === 'sensor') {
    return `Capteur ${trigger.sensorId} · ${trigger.event}`
  }
  return `Lampe/groupe ${trigger.targetId} passe ${trigger.state === 'on' ? 'allumé' : 'éteint'}`
}

export default function Routines() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setAutomations(await getAutomations())
    } catch {
      setError("Impossible de contacter le service d'automatisations.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load()
  }, [])

  const handleToggle = async (id: string) => {
    setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)))
    await toggleAutomation(id)
  }

  const handleDelete = async (id: string) => {
    setAutomations((prev) => prev.filter((a) => a.id !== id))
    await deleteAutomation(id)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Automatisations</h1>
          <p className="text-sm text-text-secondary mt-1">Automatisez vos lumières</p>
        </div>
        <Link
          to="/routines/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all"
        >
          <Plus size={16} />
          Nouvelle automatisation
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-3 max-w-2xl">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !error && automations.length === 0 && (
          <p className="text-sm text-text-secondary">Aucune automatisation pour l'instant.</p>
        )}
        {automations.map((automation) => {
          const Icon = TRIGGER_ICONS[automation.trigger.type]
          return (
            <div key={automation.id} className="bg-bg-card rounded-2xl p-5 flex items-center gap-4">
              <Link
                to={`/routines/${automation.id}`}
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-accent-orange/20"
              >
                <Icon size={18} className="text-accent-orange" />
              </Link>
              <Link to={`/routines/${automation.id}`} className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{automation.name}</p>
                <p className="text-xs text-text-secondary mt-0.5">{describeTrigger(automation)}</p>
              </Link>
              <button
                onClick={() => handleDelete(automation.id)}
                className="text-text-secondary hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => handleToggle(automation.id)}
                className="relative w-11 h-6 rounded-full transition-all shrink-0"
                style={{ background: automation.enabled ? '#FFB347' : '#2E2E3F' }}
              >
                <span
                  className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
                  style={{ left: automation.enabled ? 'calc(100% - 20px)' : '4px' }}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
