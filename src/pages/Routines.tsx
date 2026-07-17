import { Clock, Plus } from 'lucide-react'

// Placeholder page — full implementation would require Hue schedules API
export default function Routines() {
  const mockRoutines = [
    {
      id: 1,
      name: 'Réveil progressif',
      time: '07:00',
      days: 'Lun – Ven',
      active: true,
      color: '#FFB347',
    },
    {
      id: 2,
      name: 'Soirée détente',
      time: '20:00',
      days: 'Tous les jours',
      active: true,
      color: '#A78BFA',
    },
    {
      id: 3,
      name: 'Extinction nuit',
      time: '23:30',
      days: 'Tous les jours',
      active: false,
      color: '#60A5FA',
    },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Routines</h1>
          <p className="text-sm text-text-secondary mt-1">Automatisez vos lumières</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-orange text-white text-sm font-semibold hover:bg-accent-orange-dark transition-all">
          <Plus size={16} />
          Nouvelle routine
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-3 max-w-2xl">
        {mockRoutines.map((routine) => (
          <div key={routine.id} className="bg-bg-card rounded-2xl p-5 flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${routine.color}20` }}
            >
              <Clock size={18} style={{ color: routine.color }} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white">{routine.name}</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {routine.time} · {routine.days}
              </p>
            </div>
            <button
              className="relative w-11 h-6 rounded-full transition-all shrink-0"
              style={{ background: routine.active ? routine.color : '#2E2E3F' }}
            >
              <span
                className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all"
                style={{ left: routine.active ? 'calc(100% - 20px)' : '4px' }}
              />
            </button>
          </div>
        ))}

        <div className="mt-4 p-4 rounded-2xl border border-white/5 text-center">
          <p className="text-sm text-text-muted">
            Les routines utilisent l'API Schedules de votre bridge Hue.
            <br />
            Cette fonctionnalité sera disponible prochainement.
          </p>
        </div>
      </div>
    </div>
  )
}
