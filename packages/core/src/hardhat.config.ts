import { HardhatUserConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-ethers'
// import 'hardhat-deploy'
// import 'hardhat-deploy-ethers'

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
    tests: './tests/uint/layer1',
  },
}
export default config
