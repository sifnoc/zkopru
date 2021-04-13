import '@nomiclabs/hardhat-web3'
import { HardhatUserConfig } from 'hardhat/types'

const config: HardhatUserConfig = {
  solidity: {
    version: '0.7.4',
  },
  networks: {
    hardhat: {
      mining: {
        auto: false,
        interval: 0,
      },
    },
  },
  paths: {
    tests: './tests/uint/L1testChain',
  },
}
export default config
