FROM node:16-alpine
RUN apk --no-cache add git
WORKDIR /proj
COPY ./package.dev.json /proj/package.json
# Stub a package json for @zkopru/utils so yarn install works
RUN mkdir /utils && echo '{"version": "0.0.0"}' > /utils/package.json

RUN apk add --no-cache --virtual .gyp \
    python3 \
    make \
    g++ \
    && yarn global add ganache \
    && yarn install \
    && apk del .gyp

COPY ./contracts /proj/contracts
COPY ./src /proj/src
COPY ./utils /proj/utils
COPY ./hardhat.config.ts /proj/hardhat.config.ts
COPY ./scripts/deploy.ts /proj/scripts/deploy.ts
RUN yarn compile
EXPOSE 5000
COPY ./keys /proj/keys
RUN ganache --db=/data -i 20200406 -p 5000 --gasLimit 12000000 --deterministic --host 0.0.0.0 & sleep 5 && yarn deploy
CMD ganache --db=/data -b 5 -i 20200406 -p 5000 --gasLimit 12000000 --deterministic --host 0.0.0.0 --gasPrice 2000000000
