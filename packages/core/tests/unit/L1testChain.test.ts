/* eslint-disable @typescript-eslint/camelcase */
import hre from 'hardhat'
import { sleep } from '@zkopru/utils'
import { web3Extend, L1testChain, snapShot } from '../../dist'

const assert = require('assert')

const defaultInterval = 50

describe('layer1.ts - L1testChain', async () => {
  const hreWeb3 = await hre.web3.extend(web3Extend)
  const testChain = new L1testChain(
    'http://localhost:8545',
    defaultInterval,
    hre.network.provider,
  )
  testChain.web3 = hreWeb3 // Injected web3 of the hardhat runtime environment into testChain

  it('current block number', async () => {
    const startingBlockNumber = await testChain.web3.eth.getBlockNumber()
    assert.equal(startingBlockNumber, 0)
  })

  it('start auto mine configured 1000ms block time', async () => {
    testChain.startMine(defaultInterval)
    await sleep(defaultInterval + 5)
    const currentBlockNumber = await testChain.web3.eth.getBlockNumber()
    assert.equal(currentBlockNumber, 1)
  })

  it('stop auto mine after more block mined', async () => {
    await sleep(defaultInterval)
    testChain.stopMine()
    await sleep(defaultInterval / 5)
    const currentBlockNumber = await testChain.web3.eth.getBlockNumber()
    assert.equal(currentBlockNumber, 2)
  })

  it('take a snapshot', async () => {
    testChain.web3.evm.mineBlock()
    const snapshotResult: snapShot = await testChain.snapshot()
    assert.equal(snapshotResult.count, 1)
    assert.equal(snapshotResult.blockNumber, 3)
  })

  it('revert blockchain after 10 blocks mined', async () => {
    for (let i = 0; i < 10; i++) {
      testChain.web3.evm.mineBlock()
    }
    const currentBlockNumber = await testChain.web3.eth.getBlockNumber()
    assert.equal(currentBlockNumber, 13)
    await testChain.revert()
    const revertedBlockNumber = await testChain.web3.eth.getBlockNumber()
    assert.equal(revertedBlockNumber, 3)
  })
})
