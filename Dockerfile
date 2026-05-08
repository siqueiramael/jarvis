FROM node:20-slim

# Instalar dependências de runtime + build (pra recompilar whisper se precisar)
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    ffmpeg \
    cmake \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data/obsidian-vault /app/logs

EXPOSE 3000

CMD ["npm", "start"]
