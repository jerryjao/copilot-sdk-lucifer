FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY directories.json ./

# Install ca-certificates and update certs in build stage
RUN apt-get update && apt-get install -y ca-certificates && update-ca-certificates && rm -rf /var/lib/apt/lists/*

RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ARG COPILOT_CLI_VERSION=latest

# Install ca-certificates and update certs in build stage
RUN apt-get update && apt-get install -y ca-certificates && update-ca-certificates && rm -rf /var/lib/apt/lists/*

RUN npm install -g @github/copilot@${COPILOT_CLI_VERSION} \
  && npm cache clean --force

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY directories.json ./

CMD ["node", "dist/index.js"]
