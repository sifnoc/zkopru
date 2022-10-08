/* eslint-disable jest/no-export */
/* eslint-disable jest/no-hooks */
/* eslint-disable jest/require-top-level-describe */
import { parseEther } from 'ethers/lib/utils'
import { CtxProvider } from '../context'

export const testNewCoordinatorAccount = (ctx: CtxProvider) => async () => {
  const { provider, accounts } = ctx()
  expect(
    await provider.getBalance(accounts.newCoordinator.ethAccount.address),
  ).toEqual(parseEther('1000'))
}
export const testAliceAccount = (ctx: CtxProvider) => async () => {
  const { provider, accounts } = ctx()
  expect(await provider.getBalance(accounts.alice.ethAccount.address)).toEqual(
    parseEther('1000'),
  )
}
export const testBobAccount = (ctx: CtxProvider) => async () => {
  const { provider, accounts } = ctx()
  expect(await provider.getBalance(accounts.bob.ethAccount.address)).toEqual(
    parseEther('1000'),
  )
}

export const testCarlAccount = (ctx: CtxProvider) => async () => {
  const { provider, accounts } = ctx()
  expect(await provider.getBalance(accounts.carl.ethAccount.address)).toEqual(
    parseEther('1000'),
  )
}
