FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/data/obsidian-vault /app/logs
EXPOSE 3000
CMD ["npm", "start"]
