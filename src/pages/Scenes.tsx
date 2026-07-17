import { useMemo, useState } from 'react'
import { useHue } from '../context/HueContext'
import SceneCard from '../components/SceneCard'

export default function Scenes() {
  const { scenes, groups } = useHue()
  const [roomFilter, setRoomFilter] = useState<string>('all')

  const groupedScenes = useMemo(() => {
    const groupScenes = scenes.filter((s) => s.type === 'GroupScene' && s.group)
    const filtered =
      roomFilter === 'all' ? groupScenes : groupScenes.filter((s) => s.group === roomFilter)

    const byGroup: Record<string, typeof filtered> = {}
    for (const scene of filtered) {
      const key = scene.group ?? 'other'
      if (!byGroup[key]) byGroup[key] = []
      byGroup[key].push(scene)
    }
    return byGroup
  }, [scenes, roomFilter])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 pt-8 pb-6 shrink-0">
        <h1 className="text-2xl font-bold text-white">Scènes</h1>
        <p className="text-sm text-text-secondary mt-1">{scenes.length} scènes disponibles</p>

        <div className="flex items-center gap-3 mt-5">
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
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8 flex flex-col gap-8">
        {Object.entries(groupedScenes).map(([groupId, groupScenes]) => {
          const group = groups.find((g) => g.id === groupId)
          return (
            <section key={groupId}>
              <h2 className="font-semibold text-base text-white mb-3">{group?.name ?? 'Autre'}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {groupScenes.map((scene) => (
                  <SceneCard key={scene.id} scene={scene} group={group} />
                ))}
              </div>
            </section>
          )
        })}

        {Object.keys(groupedScenes).length === 0 && (
          <div className="text-center py-16 text-text-secondary">
            <p className="text-lg">Aucune scène disponible</p>
          </div>
        )}
      </div>
    </div>
  )
}
