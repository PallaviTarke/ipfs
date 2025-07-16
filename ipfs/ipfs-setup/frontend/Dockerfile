# Use official Node image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first and install deps
COPY package*.json ./
RUN npm install

# Copy rest of the code
COPY . .

# Expose the Vite dev server port
EXPOSE 5173

# Start Vite dev server on 0.0.0.0 so it's accessible from outside
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
