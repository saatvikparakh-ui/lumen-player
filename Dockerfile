FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including build tools)
RUN npm install

# Copy source files
COPY . .

# Build client production bundle
RUN npm run build

# Expose default port
EXPOSE 3847

ENV PORT=3847
ENV NODE_ENV=production

# Start full-stack web server
CMD ["node", "server.cjs"]
