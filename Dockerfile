FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --include=optional

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["npm","run","dev","--","-p","3000"]
