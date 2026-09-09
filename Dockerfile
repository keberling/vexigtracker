FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/media && chown -R node:node /app /data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
