import { useHue } from '../context/HueContext'
import RoomCard from '../components/RoomCard'

export default function Rooms() {
  const { groups, loading } = useHue()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0">
        <h1 className="text-2xl font-bold text-white">Pièces</h1>
        <p className="text-sm text-text-secondary mt-1">{groups.length} pièces configurées</p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading && groups.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 text-text-secondary">
            <p className="text-lg">Aucune pièce configurée</p>
            <p className="text-sm mt-1">Vérifiez la connexion au bridge Hue</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {groups.map((group) => (
              <RoomCard key={group.id} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
