import { ZkopruNode, CoordinatorManager } from '@zkopru/core'
import { ZkAccount } from '@zkopru/account'
import {
  DB,
  Withdrawal as WithdrawalSql,
  TransactionDB,
} from '@zkopru/database'
import { Address, Uint256, Bytes32 } from 'soltypes'
import {
  UtxoStatus,
  Sum,
  Utxo,
  ZkAddress,
  WithdrawalStatus,
  RawTx,
  ZkTx,
  Outflow,
  Withdrawal,
} from '@zkopru/transaction'
import { Fp, F } from '@zkopru/babyjubjub'
import { Layer1, TransactionObject, Tx, TxUtil } from '@zkopru/contracts'
import fetch, { Response } from 'node-fetch'
import { logger } from '@zkopru/utils'
import { TransactionReceipt, Account } from 'web3-core'
import { signTypedData_v4 as signTypedData } from 'eth-sig-util'
import { ZkWizard } from './zk-wizard'

export interface Balance {
  eth: string

  erc20: { [addr: string]: string }

  erc721: { [addr: string]: string }
}

export interface ZkWalletAccountConfig {
  privateKey?: Buffer | string
  account?: ZkAccount
  accounts?: ZkAccount[]
  node: ZkopruNode
  erc20: Address[]
  erc721: Address[]
  snarkKeyPath?: string
  snarkKeyCid?: string
}

export class ZkWalletAccount {
  db: DB

  node: ZkopruNode

  coordinatorManager: CoordinatorManager

  account?: ZkAccount

  erc20: Address[]

  erc721: Address[]

  wizard: ZkWizard

  constructor(obj: ZkWalletAccountConfig) {
    this.db = obj.node.db
    this.node = obj.node
    this.coordinatorManager = new CoordinatorManager(
      this.node.layer1.address,
      this.node.layer1.web3,
    )
    this.erc20 = obj.erc20
    this.erc721 = obj.erc721
    if (obj.privateKey) {
      this.account = new ZkAccount(obj.privateKey)
    } else if (obj.account) {
      this.account = obj.account
    } else if (obj.accounts && obj.accounts.length > 0) {
      // eslint-disable-next-line prefer-destructuring
      this.account = obj.accounts[0]
    } else {
      throw new Error(
        'Neither privateKey or account supplied for wallet account',
      )
    }
    this.node.tracker.addAccounts(this.account)
    this.wizard = new ZkWizard({
      utxoTree: this.node.layer2.grove.utxoTree,
      path: obj.snarkKeyPath,
      cid: obj.snarkKeyCid,
    })
  }

  addERC20(...addresses: string[]) {
    this.erc20.push(
      ...addresses
        .filter(addr => this.erc20.find(Address.from(addr).eq) === undefined)
        .map(Address.from),
    )
  }

  removeERC20(address: string) {
    this.erc20 = this.erc20.filter(addr => !addr.eq(Address.from(address)))
  }

  addERC721(...addresses: string[]) {
    this.erc721.push(...addresses.map(Address.from))
  }

  removeERC721(address: string) {
    this.erc721 = this.erc721.filter(addr => !addr.eq(Address.from(address)))
  }

  async getSpendableAmount(account?: ZkAccount): Promise<Sum> {
    const notes: Utxo[] = await this.getSpendables(account)
    const assets = Sum.from(notes)
    return assets
  }

  async getLockedAmount(account?: ZkAccount): Promise<Sum> {
    const notes: Utxo[] = await this.getUtxos(account, UtxoStatus.SPENDING)
    const assets = Sum.from(notes)
    return assets
  }

  async getSpendables(account?: ZkAccount): Promise<Utxo[]> {
    const utxos = await this.getUtxos(account, UtxoStatus.UNSPENT)
    return utxos
  }

  async getWithdrawables(
    account?: ZkAccount,
    status?: WithdrawalStatus,
  ): Promise<WithdrawalSql[]> {
    const targetAccount = account || this.account
    if (!targetAccount)
      throw Error('Provide account parameter or set default account')
    const withdrawals = await this.db.findMany('Withdrawal', {
      where: {
        to: targetAccount.ethAddress,
        status,
      },
    })
    return withdrawals
  }

  async getUtxos(
    account?: ZkAccount,
    status?: UtxoStatus | UtxoStatus[],
  ): Promise<Utxo[]> {
    const targetAccount = account || this.account
    if (!targetAccount)
      throw Error('Provide account parameter or set default account')
    const notes = await this.db.findMany('Utxo', {
      where: {
        owner: [targetAccount.zkAddress.toString()],
        status: status ? [status].flat() : undefined,
        usedAt: null,
      },
    })
    return notes.map(obj => {
      if (!obj.eth) throw Error('should have Ether data')
      if (!obj.owner) throw Error('should have pubkey data')
      if (!(targetAccount.zkAddress.toString() === obj.owner))
        throw Error('should have same pubkey')
      if (!obj.salt) throw Error('should have salt data')

      if (!obj.tokenAddr || +obj.tokenAddr === 0) {
        return Utxo.newEtherNote({
          eth: obj.eth,
          owner: targetAccount.zkAddress,
          salt: obj.salt,
        })
      }
      if (obj.erc20Amount && Fp.from(obj.erc20Amount || 0).gtn(0)) {
        return Utxo.newERC20Note({
          eth: obj.eth,
          owner: targetAccount.zkAddress,
          salt: obj.salt,
          tokenAddr: obj.tokenAddr,
          erc20Amount: obj.erc20Amount,
        })
      }
      if (obj.nft) {
        return Utxo.newNFTNote({
          eth: obj.eth,
          owner: targetAccount.zkAddress,
          salt: obj.salt,
          tokenAddr: obj.tokenAddr,
          nft: obj.nft,
        })
      }
      throw Error('Not enough data to recover utxo')
    })
  }

  async fetchLayer1Assets(account?: ZkAccount): Promise<Balance> {
    const targetAccount = account || this.account
    if (!targetAccount)
      throw Error('Provide account parameter or set default account')
    const balance: Balance = {
      eth: '0',
      erc20: {},
      erc721: {},
    }
    const promises: (() => Promise<void>)[] = []
    const { web3 } = this.node.layer1
    promises.push(async () => {
      balance.eth = await web3.eth.getBalance(targetAccount.ethAddress)
    })
    promises.push(
      ...this.erc20.map(addr => async () => {
        const erc20 = Layer1.getERC20(web3, addr.toString())
        const bal = await erc20.methods
          .balanceOf(targetAccount.ethAddress)
          .call()
        balance.erc20[addr.toString()] = bal
      }),
    )
    promises.push(
      ...this.erc721.map(addr => async () => {
        const erc721 = Layer1.getIERC721Enumerable(web3, addr.toString())
        const count = await erc721.methods
          .balanceOf(targetAccount.ethAddress)
          .call()
        balance.erc721[addr.toString()] = count
      }),
    )
    await Promise.all(promises.map(task => task()))
    return balance
  }

  async listLayer1Nfts(
    erc721Addr: string,
    balance: number,
    account?: ZkAccount,
  ): Promise<string[]> {
    const targetAccount = account || this.account
    if (!targetAccount)
      throw Error('Provide account parameter or set default account')
    const promises: (() => Promise<void>)[] = []
    const nfts: string[] = []
    const { web3 } = this.node.layer1
    // 0x4f6ccce7 = tokenOfOwnerByIndex func sig
    const supportEnumeration = await Layer1.getIERC721Enumerable(
      web3,
      erc721Addr,
    )
      .methods.supportsInterface('0x4f6ccce7')
      .call()
    if (supportEnumeration) {
      promises.push(
        ...Array(balance)
          .fill(0)
          .map((_, i) => async () => {
            nfts[i] = await Layer1.getIERC721Enumerable(web3, erc721Addr)
              .methods.tokenOfOwnerByIndex(targetAccount.ethAddress, i)
              .call()
          }),
      )
      await Promise.all(promises.map(task => task()))
      return nfts
    }
    logger.error('It does not support tokenOfOwnerByIndex() interface')
    return []
  }

  async depositEther(
    eth: F,
    fee: F,
    to?: ZkAddress,
    salt?: F,
  ): Promise<boolean> {
    if (!this.account) {
      logger.error('Account is not set')
      return false
    }
    const balance = await this.fetchLayer1Assets(this.account)
    if (
      Fp.strictFrom(balance.eth).lt(Fp.strictFrom(eth).add(Fp.strictFrom(fee)))
    ) {
      logger.error('Not enough Ether')
      return false
    }
    const note = Utxo.newEtherNote({
      eth,
      salt,
      owner: to || this.account.zkAddress,
    })
    const result = await this.deposit(note, Fp.strictFrom(fee))
    return result
  }

  depositEtherTx(
    eth: F,
    fee: F,
    to?: ZkAddress,
  ): {
    to: string
    data: any
    value: string
    onComplete: () => Promise<any>
  } {
    if (!this.account) {
      logger.error('Account is not set')
      throw new Error('Account is not set')
    }
    const note = Utxo.newEtherNote({
      eth,
      owner: to || this.account.zkAddress,
    })
    return this.depositTx(note, Fp.strictFrom(fee))
  }

  async depositERC20(
    eth: F,
    addr: string,
    amount: F,
    fee: F,
    to?: ZkAddress,
  ): Promise<boolean> {
    if (!this.account) {
      logger.error('Account is not set')
      return false
    }
    const balance = await this.fetchLayer1Assets(this.account)
    if (!balance) {
      logger.error('Failed to fetch balance')
      return false
    }
    if (
      Fp.strictFrom(balance.eth).lt(Fp.strictFrom(eth).add(Fp.strictFrom(fee)))
    ) {
      logger.error('Not enough Ether')
      return false
    }
    if (Fp.strictFrom(balance.erc20[addr]).lt(Fp.strictFrom(amount))) {
      logger.error('Not enough ERC20 balance')
      return false
    }
    const note = Utxo.newERC20Note({
      eth,
      owner: to || this.account.zkAddress,
      tokenAddr: addr,
      erc20Amount: amount,
    })
    const result = await this.deposit(note, Fp.strictFrom(fee))
    return result
  }

  depositERC20Tx(
    eth: F,
    addr: string,
    amount: F,
    fee: F,
    to?: ZkAddress,
  ): {
    to: string
    data: any
    value: string
    onComplete: () => Promise<any>
  } {
    if (!this.account) {
      throw new Error('Account is not set')
    }
    const note = Utxo.newERC20Note({
      eth,
      owner: to || this.account.zkAddress,
      tokenAddr: addr,
      erc20Amount: amount,
    })
    return this.depositTx(note, Fp.strictFrom(fee))
  }

  async depositERC721(
    eth: F,
    addr: string,
    nft: F,
    fee: F,
    to?: ZkAddress,
  ): Promise<boolean> {
    if (!this.account) {
      logger.error('Account is not set')
      return false
    }
    const balance = await this.fetchLayer1Assets(this.account)
    if (!balance) {
      logger.error('Failed to fetch balance')
      return false
    }
    if (
      Fp.strictFrom(balance.eth).lt(Fp.strictFrom(eth).add(Fp.strictFrom(fee)))
    ) {
      logger.error('Not enough Ether')
      return false
    }
    const note = Utxo.newNFTNote({
      eth,
      owner: to || this.account.zkAddress,
      tokenAddr: addr,
      nft,
    })
    const result = await this.deposit(note, Fp.strictFrom(fee))
    return result
  }

  async withdraw(withdrawal: WithdrawalSql): Promise<boolean> {
    if (!this.account) {
      logger.error('Account is not set')
      return false
    }
    if (!withdrawal.siblings) throw Error('No sibling data')
    if (!withdrawal.includedIn) throw Error('No block hash which includes it')
    if (!withdrawal.index) throw Error('No leaf index')
    const siblings: string[] = JSON.parse(withdrawal.siblings)
    const tx = this.node.layer1.user.methods.withdraw(
      withdrawal.hash,
      withdrawal.to,
      withdrawal.eth,
      withdrawal.tokenAddr,
      withdrawal.erc20Amount,
      withdrawal.nft,
      withdrawal.fee,
      withdrawal.includedIn,
      withdrawal.index,
      siblings,
    )
    const receipt = await this.node.layer1.sendTx(tx, this.account.ethAccount)
    if (receipt) {
      await this.db.update('Withdrawal', {
        where: { hash: withdrawal.hash },
        update: { status: WithdrawalStatus.WITHDRAWN },
      })
      return true
    }
    return false
  }

  async instantWithdrawal(
    prePayer: Address,
    prepayFeeInEth: Uint256,
    prepayFeeInToken: Uint256,
    withdrawal: WithdrawalSql,
    expiration: number,
  ): Promise<boolean> {
    if (!this.account) {
      logger.error('Account is not set')
      return false
    }
    if (!withdrawal.siblings) throw Error('No sibling data')
    if (!withdrawal.includedIn) throw Error('No block hash which includes it')
    if (!withdrawal.index) throw Error('No leaf index')

    const siblings: string[] = JSON.parse(withdrawal.siblings)
    const chainId = await this.node.layer1.web3.eth.getChainId()
    const msgParams = {
      domain: {
        chainId,
        name: 'Zkopru',
        verifyingContract: this.node.layer1.address,
        version: '1',
      },
      primaryType: 'PrepayRequest' as const,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        PrepayRequest: [
          { name: 'prepayer', type: 'address' },
          { name: 'withdrawalHash', type: 'bytes32' },
          { name: 'prepayFeeInEth', type: 'uint256' },
          { name: 'prepayFeeInToken', type: 'uint256' },
          { name: 'expiration', type: 'uint256' },
        ],
      },
      message: {
        prepayer: prePayer.toString(),
        withdrawalHash: Uint256.from(withdrawal.withdrawalHash)
          .toBytes()
          .toString(),
        prepayFeeInEth: prepayFeeInEth.toString(),
        prepayFeeInToken: prepayFeeInToken.toString(),
        expiration,
      },
    }
    const signature = signTypedData(
      Bytes32.from(this.account.ethAccount.privateKey).toBuffer(),
      {
        data: msgParams,
      },
    )
    const data = {
      ...withdrawal,
      siblings,
      prepayer: prePayer.toString(),
      prepayFeeInEth: prepayFeeInEth.toString(),
      prepayFeeInToken: prepayFeeInToken.toString(),
      expiration,
      signature,
    }
    const coordinatorUrl = await this.coordinatorManager.activeCoordinatorUrl()
    const response = await fetch(`${coordinatorUrl}/instant-withdraw`, {
      method: 'post',
      body: JSON.stringify(data),
    })
    if (response.ok) {
      const signedTx = await response.text()
      const receipt = await this.node.layer1.web3.eth.sendSignedTransaction(
        signedTx,
      )
      if (receipt.status) {
        // mark withdrawal as transferred
        await this.db.update('Withdrawal', {
          where: { hash: withdrawal.hash },
          update: { status: WithdrawalStatus.TRANSFERRED },
        })
        return true
      }
    }
    return false
  }

  async fetchPrice(): Promise<string> {
    const coordinatorUrl = await this.coordinatorManager.activeCoordinatorUrl()
    const response = await fetch(`${coordinatorUrl}/price`)
    if (response.ok) {
      const { weiPerByte } = await response.json()
      if (weiPerByte) return weiPerByte
    }
    throw Error(`${response}`)
  }

  async sendLayer1Tx<T>({
    contract,
    tx,
    signer,
    option,
  }: {
    contract: Address | string
    tx: TransactionObject<T>
    signer?: Account
    option?: Tx
  }): Promise<TransactionReceipt | undefined> {
    const { web3 } = this.node.layer1
    const from = signer || this.account?.ethAccount
    if (!from) throw Error(`You need to set 'from' account`)
    const result = await TxUtil.sendTx(
      tx,
      contract.toString(),
      web3,
      from,
      option,
    )
    return result
  }

  async lockUtxos(utxos: Utxo[], db?: TransactionDB): Promise<void> {
    await (db || this.db).update('Utxo', {
      where: {
        hash: utxos.map(utxo =>
          utxo
            .hash()
            .toUint256()
            .toString(),
        ),
      },
      update: { status: UtxoStatus.SPENDING },
    })
  }

  async unlockUtxos(utxos: Utxo[]): Promise<void> {
    await this.db.update('Utxo', {
      where: {
        hash: utxos.map(utxo =>
          utxo
            .hash()
            .toUint256()
            .toString(),
        ),
      },
      update: { status: UtxoStatus.UNSPENT },
    })
  }

  async shieldTx({
    tx,
    from,
    encryptTo,
    prepayInfo,
  }: {
    tx: RawTx
    from?: ZkAccount
    encryptTo?: ZkAddress
    prepayInfo?: any
  }): Promise<ZkTx> {
    if (
      encryptTo &&
      tx.outflow.find(outflow => outflow.owner.eq(encryptTo)) === undefined
    ) {
      throw Error('Cannot find the recipient')
    }
    const fromAccount = from || this.account
    if (!fromAccount) throw Error('Account is not set')
    try {
      const zkTx = await this.wizard.shield({
        tx,
        from: fromAccount,
        encryptTo,
        prepayInfo,
      })
      const snarkValid = await this.node.layer2.snarkVerifier.verifyTx(zkTx)
      if (!snarkValid) {
        throw new Error('Generated snark proof is invalid')
      }
      await this.db.transaction(async db => {
        await this.storePendingTx(tx, zkTx, fromAccount, db)
        await this.storePendingWithdrawal(tx, db)
        for (const outflow of tx.outflow) {
          // eslint-disable-next-line no-continue
          if (outflow instanceof Withdrawal) continue
          await this.saveOutflow(outflow, db)
        }
        await this.lockUtxos(tx.inflow, db)
      })
      return zkTx
    } catch (err) {
      logger.error(err)
      throw err
    }
  }

  async storePendingTx(
    tx: RawTx,
    zkTx: ZkTx,
    from: ZkAccount,
    db?: TransactionDB,
  ) {
    for (const outflow of tx.outflow) {
      if (outflow instanceof Withdrawal) return
    }
    // calculate the amount of the tx for the ui
    const notes = from.decrypt(zkTx, this.node.layer2.tokenRegistry)
    let tokenAddress: Fp | undefined
    const tokenSentAmount = Fp.from(0)
    const ethSentAmount = Fp.from(0)
    for (const i of tx.inflow) {
      if (!tokenAddress && !i.tokenAddr().eq(Fp.from(0))) {
        tokenAddress = i.tokenAddr()
      }
      ethSentAmount.iadd(i.asset.eth)
      if (tokenAddress && i.asset.tokenAddr.eq(Fp.from(tokenAddress))) {
        tokenSentAmount.iadd(i.asset.erc20Amount)
      }
    }
    // const tokenAddress = `0x${notes[0].asset.tokenAddr.toString('hex')}`
    const myTokenAmount = Fp.from(0)
    const myEthAmount = Fp.from(0)
    for (const note of notes) {
      if (tokenAddress && note.asset.tokenAddr.eq(tokenAddress)) {
        myTokenAmount.iadd(note.asset.erc20Amount)
      }
      myEthAmount.iadd(note.asset.eth)
    }
    // sentAmount = totalInflow - myOutflow - fee
    const tokenSent = tokenSentAmount.sub(myTokenAmount)
    const ethSent = ethSentAmount.sub(myEthAmount).sub(tx.fee)
    const pendingTx = {
      hash: zkTx.hash().toString(),
      fee: zkTx.fee.toString(),
      proof: zkTx.proof,
      memoVersion: zkTx.memo?.version,
      memoData: zkTx.memo?.data.toString('base64'),
      swap: zkTx.swap?.toString(),
      inflow: zkTx.inflow,
      outflow: zkTx.outflow,
      senderAddress: from.zkAddress.toString(),
      tokenAddr: tokenAddress ? tokenAddress.toHex() : '0x0',
      erc20Amount: tokenSent.toString(),
      eth: ethSent.toString(),
    }
    await (db || this.db).upsert('PendingTx', {
      where: {
        hash: pendingTx.hash,
      },
      create: pendingTx,
      update: pendingTx,
    })
  }

  async storePendingWithdrawal(tx: RawTx, db?: TransactionDB) {
    const withdrawalOutflows = tx.outflow.filter(
      outflow => outflow instanceof Withdrawal,
    ) as Withdrawal[]
    for (const outflow of withdrawalOutflows) {
      const data = {
        hash: outflow
          .hash()
          .toUint256()
          .toString(),
        withdrawalHash: outflow.withdrawalHash().toString(),
        owner: outflow.owner.toString(),
        salt: outflow.salt.toUint256().toString(),
        eth: outflow
          .eth()
          .toUint256()
          .toString(),
        tokenAddr: outflow
          .tokenAddr()
          .toAddress()
          .toString(),
        erc20Amount: outflow
          .erc20Amount()
          .toUint256()
          .toString(),
        nft: outflow
          .nft()
          .toUint256()
          .toString(),
        to: outflow.publicData.to.toAddress().toString(),
        fee: tx.fee.toUint256().toString(),
      }
      await (db || this.db).upsert('Withdrawal', {
        where: { hash: data.hash },
        update: data,
        create: { ...data, status: WithdrawalStatus.NON_INCLUDED },
      })
    }
  }

  async sendLayer2Tx(zkTx: ZkTx | ZkTx[]): Promise<Response> {
    const txs = [zkTx].flat()
    const coordinatorUrl = await this.coordinatorManager.activeCoordinatorUrl()
    const response = await fetch(`${coordinatorUrl}/txs`, {
      method: 'post',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(txs.map(tx => tx.encode().toString('hex'))),
    })
    return response
  }

  async sendTx({
    tx,
    from,
    encryptTo,
  }: {
    tx: RawTx
    from?: ZkAccount
    encryptTo?: ZkAddress
  }): Promise<void> {
    const zkTx = await this.shieldTx({ tx, from, encryptTo })
    const response = await this.sendLayer2Tx(zkTx)
    if (response.status !== 200) {
      await this.unlockUtxos(tx.inflow)
      throw Error(await response.text())
    }
  }

  private async deposit(note: Utxo, fee: Fp): Promise<boolean> {
    if (!this.account) {
      logger.error('Account is not set')
      return false
    }
    const tx = this.node.layer1.user.methods.deposit(
      note.owner.spendingPubKey().toString(),
      note.salt.toUint256().toString(),
      note
        .eth()
        .toUint256()
        .toString(),
      note
        .tokenAddr()
        .toAddress()
        .toString(),
      note
        .erc20Amount()
        .toUint256()
        .toString(),
      note
        .nft()
        .toUint256()
        .toString(),
      fee.toUint256().toString(),
    )
    const receipt = await this.node.layer1.sendTx(tx, this.account.ethAccount, {
      value: note
        .eth()
        .add(fee)
        .toString(),
    })
    // TODO check what web3 methods returns when it failes
    if (receipt) {
      await this.saveOutflow(note)
      return true
    }
    return false
  }

  private depositTx(
    note: Utxo,
    fee: Fp,
  ): {
    data: string
    onComplete: () => Promise<any>
    to: string
    value: string
  } {
    if (!this.account) {
      throw new Error('Account is not set')
    }
    const tx = this.node.layer1.user.methods.deposit(
      note.owner.spendingPubKey().toString(),
      note.salt.toUint256().toString(),
      note
        .eth()
        .toUint256()
        .toString(),
      note
        .tokenAddr()
        .toAddress()
        .toString(),
      note
        .erc20Amount()
        .toUint256()
        .toString(),
      note
        .nft()
        .toUint256()
        .toString(),
      fee.toUint256().toString(),
    )
    return {
      to: this.node.layer1.user.options.address,
      data: tx.encodeABI(),
      value: note
        .eth()
        .add(fee)
        .toString(16),
      onComplete: async () => {
        await this.db.transaction(async db => {
          db.create('PendingDeposit', {
            note: note
              .hash()
              .toUint256()
              .toString(),
            fee: fee.toUint256().toString(),
          })
          await this.saveOutflow(note, db)
        })
      },
    }
  }

  private async saveOutflow(outflow: Outflow, db?: TransactionDB) {
    if (outflow instanceof Utxo) {
      const data = {
        hash: outflow
          .hash()
          .toUint256()
          .toString(),
        owner: outflow.owner.toString(),
        salt: outflow.salt.toUint256().toString(),
        eth: outflow
          .eth()
          .toUint256()
          .toString(),
        tokenAddr: outflow
          .tokenAddr()
          .toAddress()
          .toString(),
        erc20Amount: outflow
          .erc20Amount()
          .toUint256()
          .toString(),
        nft: outflow
          .nft()
          .toUint256()
          .toString(),
      }
      await (db || this.db).upsert('Utxo', {
        where: { hash: data.hash },
        update: data,
        create: { ...data, status: UtxoStatus.NON_INCLUDED },
      })
    } else {
      throw new Error('Non-UTXO object in zk-wallet-account::saveOutflow')
    }
  }
}
