FROM node:20-alpine

WORKDIR /app

# Install build tools needed for better-sqlite3 (native C++ bindings)
RUN apk add --no-cache python3 make g++

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

EXPOSE 5050

CMD ["node", "src/index.js"]
