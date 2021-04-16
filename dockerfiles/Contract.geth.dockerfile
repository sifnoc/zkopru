FROM ethereum/client-go:v1.10.2 AS base

# Deploy contract on geth private network
FROM node:12-alpine AS stage
COPY --from=base /usr/local/bin/geth /usr/local/bin/geth
RUN apk add --no-cache --virtual .gyp \
    python \
    make \
    g++ \
    && npm install -g truffle --unsafe-perm=true --allow-root \
    && apk del .gyp
RUN apk add git curl
WORKDIR /proj
COPY genesis.json /proj/genesis.json

COPY ./package.json /proj/package.json
RUN yarn install
COPY ./contracts /proj/contracts
COPY ./utils /proj/utils
COPY ./migrations /proj/migrations
COPY ./truffle-config.js /proj/truffle-config.js
RUN truffle compile 
EXPOSE 5000
COPY ./keys /proj/keys
COPY ./testnet-key /proj/testnet-key
COPY ./testnet-pass /proj/testnet-pass
RUN geth init --datadir data genesis.json && geth account import testnet-key --password testnet-pass --datadir data && geth --maxpeers 0 --fakepow --mine --miner.gasprice 1 --miner.threads 2 --miner.gastarget 12000000 --networkid 20200406 --datadir data --rpc --rpcaddr "0.0.0.0" --rpccorsdomain "*" --http.api eth,net,web3,personal,miner --nousb & truffle migrate --network develop && sleep 1 && curl -H "Content-Type: application/json" -X POST --data '{"id":1337,"jsonrpc":"2.0","method":"miner_stop","params":[]}' http://localhost:8545 && pkill geth && sleep 5
CMD ["geth", "--dev", "--networkid", "20200406", "--datadir", "data", "--rpc", "--rpcaddr", "0.0.0.0", "--rpccorsdomain", "*","--http.api", "eth,net,web3,personal,miner", "--nousb"]
# RUN geth export --datadir data geth-zkopru-exported.gz

# Start from geth private network with deployed Zkopru contracts from stage 
# FROM ethereum/client-go:v1.10.2
# WORKDIR /proj
# COPY genesis.json /proj/genesis.json
# COPY testnet-key /proj/testnet-key
# COPY testnet-pass /proj/testnet-pass
# COPY --from=stage /proj/geth-zkopru-exported.gz /proj/geth-zkopru-exported.gz
# RUN geth init --datadir data genesis.json && geth account import testnet-key --password testnet-pass --datadir data && geth import --datadir data geth-zkopru-exported.gz
# CMD ["--dev", "--networkid", "20200406", "--datadir", "data", "--rpc", "--rpcaddr", "0.0.0.0", "--rpccorsdomain", "*","--http.api", "eth,net,web3,personal,miner", "--nousb"]