# Laser Arena - Multiplayer Game Container
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm i

# Copy game files
COPY server/ ./server/
COPY client/ ./client/

# Expose game port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Run the game server
CMD ["node", "server/index.js"]
