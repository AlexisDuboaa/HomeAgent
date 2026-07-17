# Déploiement Docker sur NAS Synology

Ce document décrit le processus de build et déploiement de ce dashboard (Vite + React, servi par nginx) dans un container Docker sur un NAS Synology, sans registry Docker intermédiaire.

## Vue d'ensemble

Le processus en 5 étapes :

1. Build de l'image Docker en cross-compilation (linux/amd64) → archive `.tar`
2. Compression de l'archive en `.tar.gz`
3. Copie du `docker-compose.yml` sur le NAS via SSH
4. Transfert de l'image compressée vers le NAS via SSH
5. Chargement de l'image et redémarrage du container sur le NAS

## Prérequis

### Côté machine de développement

- Docker Desktop avec **BuildKit / buildx** activé
- Accès SSH au NAS configuré (clé SSH recommandée pour éviter les mots de passe)
- `gzip` disponible (standard sur macOS/Linux)

### Côté NAS Synology

- **Container Manager** (ou Docker) installé via le Package Center
- L'utilisateur SSH doit avoir les droits `sudo docker` (configurable dans DSM > Utilisateurs > Modifier > Permissions sudo)
- Le sous-système SFTP Synology est incompatible avec `scp`/`rsync` standard → on utilise `ssh ... "cat > fichier" < fichier_local` pour tous les transferts
- Un réseau Docker externe `voxurba-network` doit déjà exister sur le NAS (il connecte les containers au tunnel Cloudflare géré par `cloudflared`, qui expose l'app publiquement sans ouvrir de port sur le routeur)

## Fichiers du projet

### `Dockerfile`

Build multi-stage : dépendances → build Vite → image nginx minimale.

```dockerfile
# Stage 1 — Installation des dependances
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2 — Build de l'application
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Active le proxy nginx vers le bridge Hue (appels depuis le browser → NAS → bridge)
ARG VITE_HUE_PROXY=true
ENV VITE_HUE_PROXY=$VITE_HUE_PROXY

# Username Hue pré-configuré (évite le setup modal sur chaque nouvel appareil)
ARG VITE_HUE_USERNAME
ENV VITE_HUE_USERNAME=$VITE_HUE_USERNAME

RUN npm run build

# Stage 3 — Image de production (nginx)
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
# Template traité par envsubst au démarrage : ${HUE_BRIDGE_IP} → IP réelle du bridge
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

**Points importants :**

- `VITE_HUE_USERNAME` est une variable **build-time** : elle est "bakée" dans le bundle JS par Vite au moment du build, comme toute variable `VITE_*`. Elle permet à `HueContext` de se configurer automatiquement sans passer par le `SetupModal`.
- `HUE_BRIDGE_IP` est en revanche une variable **runtime** : elle n'est pas connue au build (le NAS peut différer de la machine de dev), elle est injectée dans `nginx.conf.template` par `envsubst` au démarrage du container via `docker-entrypoint.sh` (comportement natif de l'image `nginx:alpine`, dossier `/etc/nginx/templates/`).

### `nginx.conf.template`

Sert le build statique en SPA (fallback vers `index.html`), cache agressif sur `/assets/` (fichiers hashés par Vite), et proxy `/hue-bridge/` vers le bridge Hue — indispensable car le bridge n'est accessible que depuis le réseau local, alors que l'app est exposée publiquement via le tunnel Cloudflare.

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /hue-bridge/ {
        proxy_pass http://${HUE_BRIDGE_IP}/;
        proxy_set_header Host ${HUE_BRIDGE_IP};
    }
}
```

### `docker-compose.yml`

```yaml
version: '3.9'

services:
  hue-dashboard:
    image: hue-dashboard:latest
    container_name: hue-dashboard-container
    restart: unless-stopped
    # ports:
    #   - "8042:80"       # Décommente pour accès local direct (sans tunnel)
    environment:
      - HUE_BRIDGE_IP=192.168.1.75
    networks:
      - hue-dashboard-default
      - voxurba-network # Reseau partage avec cloudflared (tunnel Cloudflare)

networks:
  hue-dashboard-default:
  voxurba-network:
    external: true # Reseau partage gere existant sur le NAS (contient cloudflared)
```

**Notes :**

- `HUE_BRIDGE_IP` est lu au démarrage du container par `envsubst` (voir `nginx.conf.template`) — pas besoin de rebuild l'image si l'IP du bridge change, un simple `docker compose up -d` suffit.
- Le port n'est volontairement pas publié par défaut : l'accès se fait via le tunnel Cloudflare (`voxurba-network`). Décommenter `ports` pour un accès direct `http://NAS_HOST:8042`.

### `build-docker.sh`

Script de build et déploiement en un coup, à lancer depuis la racine du projet :

```bash
./build-docker.sh
```

Il lit `VITE_HUE_USERNAME` depuis `.env.local` s'il existe, build l'image en cross-compilation `linux/amd64`, la transfère par SSH (le sous-système SFTP Synology étant incompatible avec `scp`/`rsync`, tout passe par `cat > fichier < fichier_local`), puis recharge le container sur le NAS (`gargantua.local`).

Variables à ajuster en tête du script si le contexte de déploiement change : `IMAGE_NAME`, `NAS_USER`, `NAS_HOST`, `NAS_DIR`, `PLATFORM`.

## Résolution de problèmes

**`scp` ou `rsync` échoue vers le NAS**
Le sous-système SFTP de Synology DSM est incompatible avec ces outils. Utiliser à la place :

```bash
ssh USER@NAS "cat > /chemin/fichier" < fichier_local
```

**`docker: command not found` dans le SSH distant**
Le PATH SSH est minimal sur Synology. Forcer le PATH en début de session SSH :

```bash
ssh USER@NAS "export PATH=/usr/local/bin:/usr/bin:/bin:\$PATH && docker ..."
```

**L'image est construite pour la mauvaise architecture**
Vérifier que `PLATFORM="linux/amd64"` correspond au processeur du NAS. Les NAS Intel/AMD utilisent `linux/amd64`, les NAS ARM (certains modèles récents) utilisent `linux/arm64`.

**Le `buildx build` avec `--output type=docker` ne charge pas l'image localement**
C'est voulu : l'option `dest=/tmp/image.tar` génère l'archive sans la charger dans le daemon Docker local, ce qui économise de la mémoire et de l'espace disque pour un déploiement distant.

**Le dashboard n'arrive pas à joindre le bridge Hue après déploiement**
Vérifier que `HUE_BRIDGE_IP` dans `docker-compose.yml` correspond bien à l'IP actuelle du bridge sur le réseau local (elle peut changer si le bail DHCP n'est pas fixe), puis `docker compose up -d` pour relancer le container avec la nouvelle valeur (pas besoin de rebuild).
