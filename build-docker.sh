#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Configuration — a ajuster selon l'environnement
# ============================================================
NAS_USER="Alexis"
NAS_HOST="gargantua.local"        # IP ou hostname du NAS
NAS_DIR="/volume1/docker/hue-dashboard"
PLATFORM="linux/amd64"            # Architecture du NAS (Intel/AMD)

# ============================================================
# Verifications prealables
# ============================================================
if [ ! -f "Dockerfile" ]; then
  echo "Dockerfile introuvable. Lance ce script depuis la racine du projet."
  exit 1
fi

if [ ! -f "automation-engine/Dockerfile" ]; then
  echo "automation-engine/Dockerfile introuvable."
  exit 1
fi

echo "Build & Deploy — hue-dashboard + automation-engine"
echo "Cible : $NAS_USER@$NAS_HOST:$NAS_DIR"

# Charge les variables du fichier .env.local si present
if [ -f ".env.local" ]; then
  set -a; source .env.local; set +a
fi

# ============================================================
# [1/6] Build de l'image du dashboard
# ============================================================
echo "[1/6] Build de l'image hue-dashboard pour $PLATFORM..."
docker buildx build \
  --platform "$PLATFORM" \
  --build-arg "VITE_HUE_USERNAME=${VITE_HUE_USERNAME:-}" \
  --output "type=docker,dest=/tmp/hue-dashboard.tar" \
  --tag "hue-dashboard:latest" \
  .

# ============================================================
# [2/6] Build de l'image du moteur d'automatisations
# ============================================================
echo "[2/6] Build de l'image automation-engine pour $PLATFORM..."
docker buildx build \
  --platform "$PLATFORM" \
  --output "type=docker,dest=/tmp/automation-engine.tar" \
  --tag "automation-engine:latest" \
  ./automation-engine

# ============================================================
# [3/6] Compression
# ============================================================
echo "[3/6] Compression des images..."
gzip -f /tmp/hue-dashboard.tar
gzip -f /tmp/automation-engine.tar

# ============================================================
# [4/6] Preparation du dossier et copie de la config sur le NAS
# ============================================================
echo "[4/6] Preparation du dossier sur le NAS..."
ssh "$NAS_USER@$NAS_HOST" "mkdir -p $NAS_DIR"

# ssh stdin/stdout car le sous-systeme SFTP Synology est incompatible avec scp
echo "       Copie de docker-compose.yml..."
ssh "$NAS_USER@$NAS_HOST" "cat > $NAS_DIR/docker-compose.yml" < docker-compose.yml

echo "       Copie de .env (HUE_USERNAME pour automation-engine)..."
echo "HUE_USERNAME=${VITE_HUE_USERNAME:-}" | ssh "$NAS_USER@$NAS_HOST" "cat > $NAS_DIR/.env"

# ============================================================
# [5/6] Transfert des images
# ============================================================
echo "[5/6] Transfert des images vers le NAS..."
ssh "$NAS_USER@$NAS_HOST" "cat > /tmp/hue-dashboard.tar.gz" < /tmp/hue-dashboard.tar.gz
ssh "$NAS_USER@$NAS_HOST" "cat > /tmp/automation-engine.tar.gz" < /tmp/automation-engine.tar.gz

# ============================================================
# [6/6] Chargement et redemarrage sur le NAS
# ============================================================
echo "[6/6] Chargement des images et redemarrage des containers..."
ssh "$NAS_USER@$NAS_HOST" "
  export PATH=/usr/local/bin:/usr/bin:/bin:\$PATH
  set -e
  sudo docker load < /tmp/hue-dashboard.tar.gz
  sudo docker load < /tmp/automation-engine.tar.gz
  rm /tmp/hue-dashboard.tar.gz /tmp/automation-engine.tar.gz
  cd ${NAS_DIR}
  sudo docker compose down --remove-orphans
  sudo docker compose up -d
  sudo docker ps --filter name=hue-dashboard --filter name=automation-engine
"

# ============================================================
# Nettoyage local
# ============================================================
rm -f /tmp/hue-dashboard.tar.gz /tmp/automation-engine.tar.gz

echo ""
echo "Deploiement termine !"
echo "App disponible sur : http://$NAS_HOST:8042"
