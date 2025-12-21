# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies for development
RUN npm install

# Copy the rest of the application code
COPY . .

# Set node options environment variable
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Run the development server when the container launches
CMD ["npm", "run", "dev"]
