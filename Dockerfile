FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN python3 -m venv /opt/mailcat-venv && /opt/mailcat-venv/bin/pip install --no-cache-dir -r checker/mailcat-requirements.txt
ENV PYTHON_BIN=/opt/mailcat-venv/bin/python
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
