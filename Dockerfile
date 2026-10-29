FROM node:22-bookworm

WORKDIR /app
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY LICENSE THIRD_PARTY_NOTICES.md ./

RUN mkdir -p /data && chown node:node /data
USER node
ENV AGENT_STATE_DIR=/data \
    AGENT_SANDBOX=local \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
VOLUME /data

ENTRYPOINT ["node", "/app/bin/minecraft-agent.js"]
