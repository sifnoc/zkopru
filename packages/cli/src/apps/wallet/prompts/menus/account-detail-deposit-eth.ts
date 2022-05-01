import { BigNumberish, utils } from 'ethers'
import assert from 'assert'
import chalk from 'chalk'
import { logger } from '@zkopru/utils'
import { BigNumber } from 'ethers'
import App, { AppMenu, Context } from '..'

export default class DepositEther extends App {
  static code = AppMenu.DEPOSIT_ETHER

  // eslint-disable-next-line class-methods-use-this
  async run(context: Context): Promise<{ context: Context; next: number }> {
    if (!context.account) throw Error('Account is not set')
    const { balance } = context
    assert(balance, 'Balance is defined')
    let amountWei: BigNumberish
    let feeWei: BigNumberish
    let hasEnoughBalance = false
    do {
      const { amount } = await this.ask({
        type: 'text',
        name: 'amount',
        initial: 0,
        message: 'How much ETH do you want to deposit?',
      })
      amountWei = utils.parseEther(amount.toString())
      const messages: string[] = []
      messages.push(`Amount: ${amount} ETH`)
      messages.push(`    = ${amountWei.toString()} wei`)
      this.print(messages.join('\n'))
      const { fee } = await this.ask({
        type: 'text',
        name: 'fee',
        initial: 0,
        message: 'How much ETH do you want to pay for the fee?',
      })
      feeWei = utils.parseEther(fee)
      messages.push(`Fee: ${fee} ETH`)
      messages.push(`    = ${feeWei} wei`)
      this.print(messages.join('\n'))
      const total = amountWei.add(feeWei)
      if (BigNumber.from(balance.eth).lt(total)) {
        this.print(chalk.red('Not enough balance. Try again'))
      } else {
        hasEnoughBalance = true
      }
    } while (!hasEnoughBalance)

    const { confirmed } = await this.ask({
      type: 'confirm',
      name: 'confirmed',
      initial: true,
      message: chalk.blue(
        `Deposit: ${utils.formatEther(amountWei)} ETH / Fee: ${utils.formatEther(feeWei)} ETH`,
      ),
    })
    if (!confirmed) {
      return { context, next: AppMenu.DEPOSIT }
    }
    let success = false
    try {
      success = await this.base.depositEther(amountWei, feeWei)
    } catch (err) {
      if (err instanceof Error) logger.error(err)
    }
    if (!success) {
      const { tryAgain } = await this.ask({
        type: 'confirm',
        name: 'tryAgain',
        initial: true,
        message: 'Failed to deposit your balance. Do you want to try again?',
      })
      if (!tryAgain) {
        return { context, next: AppMenu.DEPOSIT_ETHER }
      }
    } else {
      this.print(
        chalk.green(
          'Successfully deposited. You need to wait the coordinator include your deposit into a block.',
        ),
      )
    }
    return { context, next: AppMenu.DEPOSIT }
  }
}
