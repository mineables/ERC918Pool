FROM node:latest

WORKDIR /src

ADD package.json /src
ADD package-lock.json /src
RUN npm i

ADD . /src
EXPOSE 3000
