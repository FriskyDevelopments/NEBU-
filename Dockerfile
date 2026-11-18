# Build configuration for Railway - Complete Bot + OAuth Server
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and complete bot script
COPY package.json package.json
COPY railway-complete-bot.js .
COPY bot/meetingCommandAudit.js ./bot/meetingCommandAudit.js

# Install dependencies
RUN npm install --production

# Expose port
EXPOSE 3000

# Start the complete bot with OAuth server
CMD ["node", "railway-complete-bot.js"]
