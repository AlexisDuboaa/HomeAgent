import { useState, useMemo } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useHue } from '../context/HueContext'
import LightCard from '../components/LightCard'

export default function Lights() {
  const { lights, groups, loading } = useHue()
  const [search, setSearch] = useState('')
  const [roomFilter, setRoomFilter] = useState<string>('all')
  const [showOnlyActive, setShowOnlyActive] = useState(false)

  const filtered = useMemo(() => {
    return lights.filter((l) => {
      if (search && !l.name.toLowerCase().includes(search.toLowerCase())) return false
      if (roomFilter !== 'all' && l.roomId !== roomFilter) return false
      if (showOnlyActive && !l.state.on) return false
      return true
    })
  }, [lights, search, roomFilter, showOnlyActive])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0">
        <h1 className="text-2xl font-bold text-white">Lumières</h1>
        <p className="text-sm text-text-secondary mt-1">{lights.length} lampes configurées</p>

        {/* Filters */}
        <div className="flex items-center gap-3 mt-5">
          <div className="flex items-center gap-2 bg-bg-card rounded-xl px-4 h-10 flex-1 max-w-xs">
            <Search size={15} className="text-text-secondary shrink-0" />
            <input
              type="text"
              placeholder="Rechercher une lampe..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-white placeholder:text-text-muted outline-none w-full"
            />
          </div>

          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            className="bg-bg-card border-none rounded-xl px-4 h-10 text-sm text-white outline-none cursor-pointer"
          >
            <option value="all">Toutes les pièces</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowOnlyActive(!showOnlyActive)}
            className={`flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-medium transition-all ${
              showOnlyActive
                ? 'bg-accent-orange text-white'
                : 'bg-bg-card text-text-secondary hover:text-white'
            }`}
          >
            <SlidersHorizontal size={15} />
            Actives seulement
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading && lights.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-text-secondary">
            <p className="text-lg">Aucune lampe trouvée</p>
            <p className="text-sm mt-1">Modifiez les filtres ou vérifiez la connexion</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map((light) => (
              <LightCard key={light.id} light={light} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
