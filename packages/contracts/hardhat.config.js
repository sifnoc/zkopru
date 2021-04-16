/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.7.4",
  networks: {
    hardhat: {
      chainId: 20200406,
      blockGasLimit: 12000000,
      forking: {
        url: "http://zkopru-geth:8545",
        blockNumber: 0
      },
      mining: {
        auto: true,
        interval: 0
      },
      accounts: {
        mnemonic:
          "myth like bonus scare over problem client lizard pioneer submit female collect",
        count: 10,
        accountsBalance: "100000000000000000000"
      }
    }
  }
};
