#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Configuration — a ajuster selon l'environnement
# ============================================================
IMAGE_NAME="hue-dashboard"
IMAGE_TAG="latest"
NAS_USER="Alexis"
NAS_HOST="gargantua.local"        # IP ou hostname du NAS
NAS_DIR="/volume1/docker/hue-dashboard"
PLATFORM="linux/amd64"            # Architecture du NAS (Intel/AMD)
ARCHIVE="/tmp/${IMAGE_NAME}.tar"

# ============================================================
# Verifications prealables
# ============================================================
if [ ! -f "Dockerfile" ]; then
  echo "Dockerfile introuvable. Lance ce script depuis la racine du projet."
  exit 1
fi

echo "Build & Deploy — ${IMAGE_NAME}"
echo "Cible : $NAS_USER@$NAS_HOST:$NAS_DIR"

# ============================================================
# [1/5] Build Docker cross-platform (sans charger localement)
# ============================================================
echo "[1/5] Build de l'image Docker pour $PLATFORM..."

# Charger les variables du fichier .env.local si présent
if [ -f ".env.local" ]; then
  set -a; source .env.local; set +a
fi

docker buildx build \
  --platform "$PLATFORM" \
  --build-arg "VITE_HUE_USERNAME=${VITE_HUE_USERNAME:-}" \
  --output "type=docker,dest=${ARCHIVE}" \
  --tag "$IMAGE_NAME:$IMAGE_TAG" \
  .

# ============================================================
# [2/5] Compression
# ============================================================
echo "[2/5] Compression de l'image..."
gzip -f "$ARCHIVE"
ARCHIVE_GZ="${ARCHIVE}.gz"

# ============================================================
# [3/5] Preparation du dossier et copie de la config sur le NAS
# ============================================================
echo "[3/5] Preparation du dossier sur le NAS..."
ssh "$NAS_USER@$NAS_HOST" "mkdir -p $NAS_DIR"

# ssh stdin/stdout car le sous-systeme SFTP Synology est incompatible avec scp
echo "       Copie de docker-compose.yml..."
ssh "$NAS_USER@$NAS_HOST" "cat > $NAS_DIR/docker-compose.yml" < docker-compose.yml

# ============================================================
# [4/5] Transfert de l'image
# ============================================================
echo "[4/5] Transfert de l'image vers le NAS..."
ssh "$NAS_USER@$NAS_HOST" "cat > /tmp/${IMAGE_NAME}.tar.gz" < "$ARCHIVE_GZ"

# ============================================================
# [5/5] Chargement et redemarrage sur le NAS
# ============================================================
echo "[5/5] Chargement de l'image et redemarrage du container..."
ssh "$NAS_USER@$NAS_HOST" "
  export PATH=/usr/local/bin:/usr/bin:/bin:\$PATH
  set -e
  sudo docker load < /tmp/${IMAGE_NAME}.tar.gz
  rm /tmp/${IMAGE_NAME}.tar.gz
  cd ${NAS_DIR}
  sudo docker compose down --remove-orphans
  sudo docker compose up -d
  sudo docker ps --filter name=${IMAGE_NAME}
"

# ============================================================
# Nettoyage local
# ============================================================
rm -f "$ARCHIVE_GZ"

echo ""
echo "Deploiement termine !"
echo "App disponible sur : http://$NAS_HOST:8042"
