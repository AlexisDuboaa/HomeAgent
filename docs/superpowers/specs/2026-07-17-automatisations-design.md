# Automatisations — design

Date : 2026-07-17
Statut : approuvé, en attente de relecture finale avant plan d'implémentation

## Contexte

Objectif produit : remplacer Home Assistant par hueDashboard. La page `/routines`
existe déjà en placeholder (`src/pages/Routines.tsx`) avec des données mockées et
la mention "Cette fonctionnalité sera disponible prochainement." Ce document
spécifie l'implémentation réelle de cette fonctionnalité : les automatisations.

## Exigences validées avec l'utilisateur

- **Fiabilité 24/7** : les automatisations doivent s'exécuter même quand aucun
  navigateur n'a le dashboard ouvert, exactement comme Home Assistant. C'est
  l'exigence structurante de tout le design — elle exclut une implémentation
  purement côté navigateur.
- **Déclencheurs à supporter** (tous confirmés nécessaires) :
  - heure fixe / récurrence (jours de la semaine)
  - lever / coucher du soleil (± décalage)
  - capteurs Hue physiques (mouvement, luminosité, bouton)
  - état d'une lampe/scène comme déclencheur (automatisations chaînées)
- L'utilisateur a validé l'ajout d'un service backend permanent sur le NAS —
  c'est un changement d'architecture assumé par rapport à l'app actuelle
  (100% front, zéro backend, cf. `CLAUDE.md`).

## Architecture

Un nouveau service **`automation-engine`** (Node.js/TypeScript), déployé comme
second container Docker sur le NAS à côté du container `hue-dashboard`
existant. Il tourne en continu et est composé de :

- **Scheduler** : boucle cron-like pour les déclencheurs `time` et `sun`. Le
  calcul du lever/coucher du soleil utilise la lib `suncalc` à partir d'une
  latitude/longitude — à ajouter comme nouveau champ de configuration dans la
  page Settings du front (persisté au même endroit que la config du bridge).
- **Listener temps réel** : abonnement au flux d'événements du bridge Hue
  (CLIP v2 eventstream) pour réagir instantanément aux déclencheurs `sensor`
  et `light_state`.
- **Évaluateur de règles** : fonction pure qui, pour un déclenchement donné,
  vérifie les conditions optionnelles de l'automatisation avant de retourner
  la liste d'actions à exécuter. Isolée du reste pour être testable
  unitairement sans dépendre du bridge.
- **Exécuteur d'actions** : envoie les appels REST au bridge Hue (set état
  lampe/groupe, activer scène).
- **Client Hue minimal côté serveur** : le service a son propre petit client
  HTTP vers le bridge (lights/groups/sensors/scenes + eventstream), distinct
  de `src/api/hue.ts` côté front. **Choix assumé** : pas de package partagé
  entre front et backend pour cette v1 — le repo n'est pas un monorepo, et
  mettre en place des workspaces npm pour partager ~50 lignes de logique HTTP
  serait disproportionné par rapport au bénéfice. Duplication limitée et
  acceptée.
- **Persistance** : un fichier JSON sur un volume Docker (lib légère type
  lowdb, pas de vraie base de données — le volume de données est trivial
  pour un usage domestique). Survit aux redéploiements du container.
- **API REST interne** : consommée uniquement par le frontend, pour le CRUD
  des automatisations et la consultation de l'historique.

### Pourquoi hybride polling+eventstream (et pas 100% l'un ou l'autre)

Un déclencheur `time`/`sun` n'a aucune exigence de latence (une routine
"réveil à 7h" n'a pas besoin de la milliseconde près) — un cron simple
suffit et reste le plus simple à maintenir. Un déclencheur `sensor` ou
`light_state` doit en revanche réagir quasi instantanément pour donner
l'impression d'un vrai remplacement de HA (une automatisation "mouvement
détecté" perçue avec plusieurs secondes de retard serait un échec produit).
D'où l'hybride : cron pour l'un, eventstream pour l'autre — pas de complexité
temps réel là où elle n'apporte rien.

## Modèle de données

```ts
type Trigger =
  | { type: 'time'; hour: number; minute: number; days: number[] } // days: 0=dimanche...6=samedi, [] = tous les jours
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offsetMinutes: number } // offset négatif = avant
  | { type: 'sensor'; sensorId: string; event: 'motion' | 'no_motion' | 'button_press' | 'low_light' | 'bright_light' }
  | { type: 'light_state'; targetId: string; targetKind: 'light' | 'group'; state: 'on' | 'off' }

type Condition =
  | { type: 'time_window'; after?: { hour: number; minute: number }; before?: { hour: number; minute: number } }
  | { type: 'light_state'; targetId: string; targetKind: 'light' | 'group'; state: 'on' | 'off' }
  | { type: 'sensor_state'; sensorId: string; state: 'motion' | 'no_motion' | 'low_light' | 'bright_light' }

type Action =
  | { type: 'set_light_state'; targetId: string; targetKind: 'light' | 'group'; update: LightUpdate } // LightUpdate réutilisé tel quel depuis src/types/hue.ts
  | { type: 'activate_scene'; groupId: string; sceneId: string }

interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: Trigger
  conditions: Condition[] // combinées en ET — pas de OU en v1
  actions: Action[] // exécutées dans l'ordre
  createdAt: string
}

interface AutomationRunLogEntry {
  at: string // ISO timestamp
  success: boolean
  error?: string
  actionsExecuted: number
}
```

Fichier de persistance : `{ automations: Automation[], history: Record<string, AutomationRunLogEntry[]> }`,
avec l'historique par automatisation borné aux 20 dernières entrées pour
éviter une croissance illimitée du fichier.

## API REST (`automation-engine`)

Exposée uniquement en interne (réseau Docker `hue-dashboard-default`, pas de
publication sur `voxurba-network`) :

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/automations` | Liste des automatisations |
| POST | `/automations` | Créer |
| PUT | `/automations/:id` | Modifier |
| DELETE | `/automations/:id` | Supprimer |
| POST | `/automations/:id/toggle` | Activer/désactiver |
| GET | `/automations/:id/history` | Dernières exécutions |

## Frontend

`src/pages/Routines.tsx` (mock statique actuel) devient une vraie page
**Automatisations**, avec un nouveau module `src/api/automations.ts` qui
appelle l'API ci-dessus (au lieu du bridge Hue directement, comme le fait le
reste du front) :

- Liste des automatisations (nom, résumé du déclencheur, toggle actif/inactif
  — reprend le pattern visuel déjà présent dans le placeholder).
- Formulaire de création/édition : choix du déclencheur → conditions
  optionnelles → actions (réutilise les sélecteurs de lampes/scènes déjà
  existants ailleurs dans l'app).
- Vue historique par automatisation (mini-log des dernières exécutions).
- Nouveau champ latitude/longitude dans `src/pages/Settings.tsx`, requis pour
  les déclencheurs `sun`.

## Déploiement

- Nouveau `Dockerfile` pour `automation-engine` (Node.js), ajouté dans
  `docker-compose.yml` à côté du service `hue-dashboard`, sur le réseau
  interne `hue-dashboard-default` uniquement. Écoute sur le port interne
  3001.
- Volume Docker nommé pour persister le fichier JSON entre redéploiements.
- `nginx.conf.template` : nouveau bloc `location /automations-api/` qui
  proxy vers `http://automation-engine:3001/` (nom de service Docker,
  résolution DNS interne au réseau Compose) — même principe que le proxy
  `/hue-bridge/` déjà en place vers `${HUE_BRIDGE_IP}`.
- `build-docker.sh` : adapté pour builder et transférer deux images au lieu
  d'une.

## Gestion d'erreurs

- Bridge injoignable (coupure réseau, redémarrage) : scheduler et listener
  continuent de tourner, retry avec backoff, aucun crash du service — log
  uniquement.
- Connexion eventstream coupée : reconnexion automatique avec backoff ; le
  scheduler cron continue en parallèle, indépendamment.
- Échec d'exécution d'une action (ex. lampe injoignable) : loggé dans
  l'historique de l'automatisation concernée avec statut d'échec ; les
  autres actions/automatisations ne sont pas bloquées par un échec isolé.
- Démarrage propre même si le fichier de persistance n'existe pas encore
  (liste d'automatisations vide au premier lancement).

## Tests

Le repo n'a actuellement aucune suite de tests. L'évaluateur de règles
(trigger + conditions → doit-on exécuter les actions ?) est de la logique
pure à forte valeur/faible coût à tester : on y ajoute des tests unitaires
ciblés (Vitest, cohérent avec l'écosystème Vite déjà en place), sans
instaurer une suite de tests complète sur le reste du projet. Le reste
(scheduler, eventstream, exécution réelle) est vérifié manuellement contre
le bridge physique, comme le reste de l'app aujourd'hui.

## Ordre de construction

1. Scaffold du service `automation-engine` : modèle de données, persistance
   JSON, API REST CRUD — sans scheduler ni listener (juste la donnée).
2. Scheduler cron pour déclencheurs `time` et `sun` + exécuteur d'actions —
   rend fonctionnel le cas d'usage du placeholder actuel (réveil, extinction
   nuit).
3. Listener eventstream pour déclencheurs `sensor` et `light_state`.
4. Frontend : nouvelle page Automatisations (liste, création/édition,
   historique) + champ lat/long dans Settings.
5. Déploiement : Dockerfile, docker-compose, proxy nginx, mise à jour de
   build-docker.sh.

Cette séquence donne un résultat fonctionnel et vérifiable dès l'étape 2
(routines "heure fixe" opérationnelles) avant d'attaquer la partie temps réel
plus complexe.

## Hors scope (v1)

- Conditions combinées en OU (seulement ET pour l'instant).
- Notifications/alertes (push, Telegram, etc.) déclenchées par une
  automatisation.
- Partage de code front/backend via monorepo — duplication limitée assumée
  (voir Architecture).
- Import/export d'automatisations Home Assistant existantes.
