# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copia dependências e instala
COPY package*.json ./
RUN npm install

# Copia o código fonte e compila o bundle de produção
COPY . .
RUN npm run build

# Production stage com Nginx ultra-leve (~15MB de RAM)
FROM nginx:alpine

# Copia a configuração personalizada do Nginx para suportar SPA e PWA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia os arquivos compilados do build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
