FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV CLOUDFLARE_CF_FETCH_ENABLED=false
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE 8787
CMD ["npm", "start"]
