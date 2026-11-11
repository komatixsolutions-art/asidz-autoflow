FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
EXPOSE 4000
CMD ["node", "--experimental-sqlite", "server.js"]
