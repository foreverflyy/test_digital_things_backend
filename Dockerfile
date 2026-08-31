FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY migrations ./migrations
COPY seed ./seed

CMD ["node", "dist/main.js"]
