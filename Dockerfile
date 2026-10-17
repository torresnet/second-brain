# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copia dependências e instala
COPY package*.json ./
RUN npm ci

# URL do webhook do n8n (embutida no bundle em build time)
ARG VITE_N8N_WEBHOOK_URL
ENV VITE_N8N_WEBHOOK_URL=$VITE_N8N_WEBHOOK_URL

# Copia o código fonte e compila o bundle de produção
COPY . .
RUN npm run build

# Production stage com Nginx ultra-leve (~15MB de RAM)
FROM nginx:alpine

# Copia a configuração personalizada do Nginx para suportar SPA e PWA
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

# A CSP libera o n8n (connect-src) usando a origem da mesma URL embutida no bundle
ARG VITE_N8N_WEBHOOK_URL
RUN origin=$(printf '%s' "$VITE_N8N_WEBHOOK_URL" | sed -nE 's#^(https://[^/]+).*#\1#p') \
    && sed -i "s#__N8N_ORIGIN__#${origin}#" /etc/nginx/security-headers.conf

# Copia os arquivos compilados do build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
