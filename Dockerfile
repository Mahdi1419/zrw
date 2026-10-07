FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/var/data
COPY package.json ./
COPY . .
RUN mkdir -p /var/data && npm run check
EXPOSE 10000
CMD ["npm", "start"]
