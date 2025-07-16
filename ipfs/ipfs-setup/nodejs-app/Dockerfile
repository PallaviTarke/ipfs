# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app
COPY . .

# Create uploads folder
RUN mkdir -p uploads

# Expose backend port
EXPOSE 3000

# Run the app
CMD ["npm", "start"]
