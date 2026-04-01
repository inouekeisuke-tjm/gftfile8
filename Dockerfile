# Use the official Microsoft Playwright image as the base
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the frontend (vite build)
RUN npm run build

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the port used by the server
EXPOSE 8080

# Start the application
CMD ["node", "server/index.js"]
