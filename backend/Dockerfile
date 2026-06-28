FROM node:24-bullseye-slim AS builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend .
RUN npx prisma generate
RUN npm run build

FROM node:24-bullseye-slim AS runner
WORKDIR /app/backend
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/node_modules/.prisma ./node_modules/.prisma
COPY collector /app/collector
RUN pip3 install --no-cache-dir -r /app/collector/requirements.txt
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/main.js"]
