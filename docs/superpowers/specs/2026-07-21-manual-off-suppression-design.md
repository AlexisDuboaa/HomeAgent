# Respect de l'extinction manuelle — design

Date : 2026-07-21
Statut : approuvé, en attente de relecture finale avant plan d'implémentation

## Contexte

`automation-engine` exécute des automatisations 24/7 sur le NAS (scheduler
cron pour heure fixe/lever-coucher du soleil, listener temps réel pour
capteurs/état de lampe). Un scénario réel s'est présenté : une automatisation
programmée éteint des lampes à heure fixe (ex. "extinction 23h30"), mais si
l'utilisateur les a déjà éteintes manuellement avant cette heure, une autre
automatisation (ex. déclenchée par un capteur de mouvement ou de luminosité)
peut ensuite les rallumer automatiquement — ce qui n'est pas souhaité :
l'utilisateur a fait un choix explicite, l'automatisation ne doit pas le
contredire avant que ça redevienne pertinent (le lendemain soir).

Ce document spécifie un mécanisme opt-in, par automatisation, pour respecter
ce choix jusqu'au prochain lever de soleil.

## Exigences validées avec l'utilisateur

- **Granularité** : par automatisation × par cible d'action, pas globale par
  lampe. Une automatisation avec le réglage activé est suspendue pour une
  cible donnée après une extinction manuelle de cette cible ; une autre
  automatisation non cochée visant la même lampe/groupe continue de
  fonctionner normalement.
- **Détection "manuel vs automatisé"** : le bridge Hue ne distingue pas la
  source d'un changement d'état. `automation-engine` s'auto-attribue ses
  propres actions via un registre en mémoire à courte durée de vie (quelques
  secondes) ; tout changement d'état "éteint" qui n'est pas dans ce registre
  est considéré manuel (app Hue, interrupteur physique, assistant vocal, ou
  même une autre automatisation non trackée par erreur — dans tous les cas,
  un signal externe légitime).
- **Levée de la suspension** : au prochain lever de soleil (pas le coucher —
  le coucher coïnciderait quasiment avec le moment de l'extinction manuelle
  elle-même ; le lever du jour garantit que l'automatisation est de nouveau
  active bien avant la soirée suivante).

## Architecture

Deux nouveaux modules dans `automation-engine`, séparés par responsabilité :

- **`selfAttribution.ts`** — registre en mémoire uniquement (pas besoin de
  survivre à un redémarrage : une coupure du service pendant la fenêtre de
  10 secondes entre notre action et l'écho SSE est un cas limite
  négligeable). Expose `markExecuted(targetId)` (appelé par l'exécuteur juste
  après une action réussie) et `wasRecentlyExecuted(targetId): boolean`
  (fenêtre glissante de 10 secondes — marge confortable au-dessus de la
  latence réelle observée du bridge, cf. le timeout de 5s déjà utilisé pour
  les appels HTTP dans `hueClient.ts`).
- **`suppression.ts`** — persisté, dans le même fichier JSON que les
  automatisations via une nouvelle collection sur `AutomationStore` :
  `suppressions: Record<string, { until: string }>`, clé
  `"<automationId>:<targetId>"`. Expose `isSuppressed(store, automationId,
  targetId, now): boolean` (vérifie l'expiration) et `recordManualOff(store,
  targetId, targetKind, now, sunTimes): Promise<void>` (trouve toutes les
  automatisations avec `respectManualOff: true` ciblant `targetId` et écrit
  une suspension avec `until` = prochain lever de soleil).

**Nouveau champ sur `Automation`** (dupliqué comme tous les autres types
entre `automation-engine/src/types.ts` et `src/types/automation.ts`, par
convention établie) :

```ts
export interface Automation {
  // ... champs existants ...
  respectManualOff?: boolean
}
```

## Flux d'exécution

1. **Détection** (`eventListener.ts`, branche `light`/`grouped_light`
   existante) : à la réception d'un événement d'extinction pour une cible,
   vérifier `wasRecentlyExecuted(targetId)`. Si vrai → notre propre action,
   ignoré, comportement inchangé. Si faux → extinction manuelle confirmée,
   appeler `recordManualOff`.
2. **Vérification à l'exécution** (`executor.ts`) : avant d'exécuter une
   action `set_light_state` avec `on: true` ou `activate_scene` appartenant
   à une automatisation avec `respectManualOff: true`, vérifier
   `isSuppressed(store, automationId, cible, now)`. Si suspendu, l'action est
   sautée ; les autres actions de la même automatisation s'exécutent
   normalement. Toute action réellement exécutée appelle `markExecuted`.
3. **Levée** : purement paresseuse — dès que `now` dépasse `until`,
   `isSuppressed` renvoie `false` sans tâche de nettoyage active.

`executeActions` a donc besoin d'un contexte plus riche qu'aujourd'hui (juste
`client` + `actions`) : `automationId`, `respectManualOff` et `store` en plus,
pour pouvoir vérifier/enregistrer les suspensions. `runner.ts` (qui appelle
`executeActions`) a déjà `store` sous la main.

## Historique

`AutomationRunLogEntry` gagne un champ optionnel `skippedActions?: number`.
Quand une automatisation se déclenche et qu'une ou plusieurs de ses actions
sont sautées pour cause de suspension, l'entrée d'historique le reflète
(`actionsExecuted` ne compte que les actions réellement exécutées,
`skippedActions` compte celles sautées) — visible dans la vue historique déjà
en place côté frontend, pas silencieux.

## Frontend

Dans `AutomationForm.tsx`, une case à cocher (même convention que la case
"Activée" déjà présente) : *"Respecter l'extinction manuelle (ne pas
rallumer avant le prochain lever du soleil)"*, liée à
`automation.respectManualOff`. Dans la vue historique déjà en place, une
exécution avec `skippedActions > 0` affiche une mention distincte du succès
plein (ex. "2 actions exécutées, 1 suspendue").

## Tests

Extension mesurée de la couverture Vitest (jusqu'ici limitée à
l'évaluateur) : `isSuppressed` (logique d'expiration) et `nextSunrise`
(calcul de date, utilisé par `recordManualOff`) sont des fonctions pures
équivalentes en nature à celles déjà testées dans `evaluator.ts` — même
niveau de rigueur, mêmes raisons (logique pure, critique, bon marché à
tester). Le reste (registre d'auto-attribution en mémoire, intégration
eventListener/executor bout en bout) reste vérifié manuellement contre le
bridge physique, comme le reste du moteur.

## Hors scope (v1)

- Indicateur visuel de suspension active dans la liste des automatisations
  (`Routines.tsx`) — la visibilité passe par l'historique pour l'instant.
- Suspension globale par lampe/groupe indépendamment de l'automatisation
  (option écartée au profit du réglage par automatisation).
- Configuration d'une heure de levée personnalisée (fixe ou calendaire) —
  uniquement le prochain lever de soleil.
