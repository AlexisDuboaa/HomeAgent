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
