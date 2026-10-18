FROM node:24-alpine

COPY . /usr/src

WORKDIR /usr/src

RUN apk add --no-cache ffmpeg

RUN npm ci

RUN npm run build

ENTRYPOINT ["/bin/sh", "-c" , "npm start"]