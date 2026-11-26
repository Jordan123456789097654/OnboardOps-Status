# OnboardOps status page (Kener) + Staff Discord bot in a single Railway service.
# We run the official Kener image and pin its version, so updates only happen when we change this line.
# Find the newest release tag at https://hub.docker.com/r/rajnandan1/kener/tags (or the GitHub releases page).
# If the build says the tag does not exist, change it to one that does. Do not use "latest" in production.
ARG KENER_VERSION=v4.0.16
FROM docker.io/rajnandan1/kener:${KENER_VERSION}

# Install the Discord bot alongside Kener inside the same container.
# The bot starts automatically when DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are set.
USER root

WORKDIR /discord-bot
COPY --chown=node:node discord-bot/package.json discord-bot/package-lock.json ./
RUN npm ci --no-fund && npm cache clean --force && chown -R node:node /discord-bot
COPY --chown=node:node discord-bot/index.js discord-bot/tsconfig.json ./
COPY --chown=node:node discord-bot/src ./src

WORKDIR /app
COPY --chown=node:node start-all.sh ./start-all.sh
RUN sed -i 's/\r$//' ./start-all.sh && chmod +x ./start-all.sh

USER node

ENTRYPOINT ["./start-all.sh"]
CMD ["node", "build/main.js"]
