FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install
COPY index.ts ./
COPY src ./src
EXPOSE 8097
CMD ["bun", "run", "index.ts"]
