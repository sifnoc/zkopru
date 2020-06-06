/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable no-underscore-dangle */
import { Field } from '@zkopru/babyjubjub'
import AsyncLock from 'async-lock'
import { Note } from '@zkopru/transaction'
import BN from 'bn.js'
import { toBN } from 'web3-utils'
import { hexify } from '@zkopru/utils'
import { DB, TreeSpecies } from '@zkopru/prisma'
import { Hasher } from './hasher'
import { MerkleProof, startingLeafProof } from './merkle-proof'

export interface Item<T extends Field | BN> {
  leafHash: T
  note?: Note
}

export interface TreeMetadata<T extends Field | BN> {
  id: string
  species: number
  index: number
  start: T
  end: T
}

export interface TreeData<T extends Field | BN> {
  root: T
  index: T
  siblings: T[]
}

export interface TreeConfig<T extends Field | BN> {
  hasher: Hasher<T>
  forceUpdate?: boolean
  fullSync?: boolean
}

export abstract class LightRollUpTree<T extends Field | BN> {
  zero?: T

  species: TreeSpecies

  db: DB

  config: TreeConfig<T>

  metadata: TreeMetadata<T>

  data: TreeData<T>

  depth: number

  lock: AsyncLock

  constructor({
    db,
    species,
    metadata,
    data,
    config,
  }: {
    db: DB
    species: TreeSpecies
    metadata: TreeMetadata<T>
    data: TreeData<T>
    config: TreeConfig<T>
  }) {
    this.lock = new AsyncLock()
    this.species = species
    this.db = db
    this.metadata = metadata
    this.data = data
    this.config = config
    this.depth = data.siblings.length
  }

  root(): T {
    return this.data.root
  }

  maxSize(): BN {
    return new BN(1).shln(this.depth)
  }

  latestLeafIndex(): T {
    return this.data.index
  }

  siblings(): T[] {
    return [...this.data.siblings]
  }

  async merkleProof({
    hash,
    index,
  }: {
    hash: T
    index?: T
  }): Promise<MerkleProof<T>> {
    let proof!: MerkleProof<T>
    await this.lock.acquire('root', async () => {
      proof = await this._merkleProof({ hash, index })
    })
    return proof
  }

  async append(
    ...items: Item<T>[]
  ): Promise<{
    root: T
    index: T
    siblings: T[]
  }> {
    let result!: {
      root: T
      index: T
      siblings: T[]
    }
    await this.lock.acquire('root', async () => {
      result = await this._append(...items)
    })
    return result
  }

  async dryAppend(
    ...items: Item<T>[]
  ): Promise<{
    root: T
    index: T
    siblings: T[]
  }> {
    let start!: T
    let latestSiblings!: T[]
    await this.lock.acquire('root', async () => {
      start = this.latestLeafIndex()
      latestSiblings = this.siblings()
    })
    let root: T = this.root()

    let index = start
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      // if note exists, save the data and mark as an item to keep tracking
      // udpate the latest siblings and save the intermediate value if it needs to be tracked
      const leafIndex = new BN(1).shln(this.depth).or(index)
      let node = item.leafHash
      let hasRightSibling!: boolean
      for (let level = 0; level < this.depth; level += 1) {
        const pathIndex = leafIndex.shrn(level)
        hasRightSibling = pathIndex.and(new BN(1)).isZero()
        if (hasRightSibling) {
          // right empty sibling
          latestSiblings[level] = node // current node will be the next merkle proof's left sibling
          node = this.config.hasher.parentOf(
            node,
            this.config.hasher.preHash[level],
          )
        } else {
          // left sibling
          // keep current sibling
          node = this.config.hasher.parentOf(latestSiblings[level], node)
        }
      }
      // update root
      root = node
      // update index
      if (this.zero instanceof Field) {
        index = Field.from(index.addn(1)) as T
      } else {
        index = index.addn(1) as T
      }
    }
    // update the latest siblings
    return {
      root,
      index,
      siblings: latestSiblings,
    }
  }

  getStartingLeafProof(): {
    root: T
    index: T
    siblings: T[]
  } {
    const index = this.latestLeafIndex()
    const siblings: T[] = [...this.data.siblings]
    let path: BN = index
    for (let i = 0; i < this.depth; i += 1) {
      if (path.isEven()) {
        siblings[i] = this.config.hasher.preHash[i]
      }
      path = path.shrn(1)
    }
    return {
      root: this.root(),
      index,
      siblings,
    }
  }

  private async _merkleProof({
    hash,
    index,
  }: {
    hash: T
    index?: T
  }): Promise<MerkleProof<T>> {
    let leafIndex: T
    if (index) {
      leafIndex = index
    } else {
      const leafCandidates = await this.db.prisma.treeNode.findMany({
        where: {
          value: hexify(hash),
          treeId: this.metadata.id,
        },
        take: 1,
      })
      if (leafCandidates.length === 0) throw Error('Leaf does not exist.')
      else if (leafCandidates.length > 1)
        throw Error('Multiple leaves exist for same hash.')
      else {
        const leafNodeIndex: BN = toBN(leafCandidates[0].nodeIndex)
        const prefix = new BN(1).shln(this.depth)
        if (this.zero instanceof Field) {
          leafIndex = Field.from(leafNodeIndex.xor(prefix)) as T
        } else {
          leafIndex = leafNodeIndex.xor(prefix) as T
        }
      }
    }
    const siblings = await this._getSiblings(leafIndex)
    const root = this.root()
    return {
      root,
      index: leafIndex,
      leaf: hash,
      siblings,
    }
  }

  private async _getSiblings(leafIndex: T): Promise<T[]> {
    const cachedSiblings = await this._getCachedSiblings(leafIndex)
    const siblings = Array(this.depth).fill(undefined)
    const leafNodeIndex = new BN(1).shln(this.depth).or(leafIndex)
    let pathNodeIndex!: BN
    let siblingNodeIndex!: BN
    for (let level = 0; level < this.depth; level += 1) {
      pathNodeIndex = leafNodeIndex.shrn(level)
      siblingNodeIndex = new BN(1).xor(pathNodeIndex)
      const usePreHashed: boolean = siblingNodeIndex.gt(
        new BN(1)
          .shln(this.depth)
          .or(this.metadata.end)
          .shrn(level),
      )
      if (usePreHashed) {
        // should return pre hashed zero
        siblings[level] = this.config.hasher.preHash[level]
      } else {
        // should find the node value
        const cached = cachedSiblings[hexify(siblingNodeIndex)]
        if (this.zero instanceof Field) {
          siblings[level] = Field.from(cached)
        } else {
          siblings[level] = toBN(cached)
        }
        if (siblings[level] === undefined)
          throw Error(
            'Sibling was not cached. Make sure you added your public key before scanning',
          )
      }
    }
    return siblings
  }

  private async _getCachedSiblings(
    leafIndex: T,
  ): Promise<{ [index: string]: string }> {
    const cachedSiblings = await this.db.preset.getCachedSiblings(
      this.depth,
      this.metadata.id,
      leafIndex,
    )
    const siblingCache = {}
    for (const sibling of cachedSiblings) {
      siblingCache[sibling.nodeIndex] = hexify(toBN(sibling.value))
    }
    if (
      this.metadata.start?.gt(leafIndex) ||
      this.metadata.end?.lte(leafIndex)
    ) {
      throw Error('not in range')
    }
    return siblingCache
  }

  private async _append(
    ...items: Item<T>[]
  ): Promise<{
    root: T
    index: T
    siblings: T[]
  }> {
    const start = this.latestLeafIndex()
    const latestSiblings = this.siblings()
    const cached: {
      [nodeIndex: string]: string
    } = {}

    const candidates: Item<T>[] = []
    let root: T = this.root()

    const trackingLeaves: T[] = await this.indexesOfTrackingLeaves()

    let index = start
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      // if note exists, save the data and mark as an item to keep tracking
      if (this.config.fullSync || item.note) {
        candidates.push(item)
      }

      if (items[i].note) {
        trackingLeaves.push(index)
      }

      // udpate the latest siblings and save the intermediate value if it needs to be tracked
      const leafNodeIndex = new BN(1).shln(this.depth).or(index)
      let node = item.leafHash
      let hasRightSibling!: boolean
      for (let level = 0; level < this.depth; level += 1) {
        const pathIndex = leafNodeIndex.shrn(level)
        hasRightSibling = pathIndex.isEven()
        if (
          this.config.fullSync ||
          this.shouldTrack(trackingLeaves, pathIndex)
        ) {
          cached[`0x${pathIndex.toString('hex')}`] = hexify(node)
        }

        if (index.gtn(0)) {
          // store nodes when if the previous sibling set has a node on the tracking path,
          // because the latest siblings are going to be updated.
          const prevIndexPath = new BN(1).shln(this.depth).or(index.subn(1))
          const prevPathIndex = prevIndexPath.shrn(level)
          const prevSibIndex = new BN(1).xor(prevPathIndex)
          if (
            prevSibIndex.isEven() &&
            (this.config.fullSync ||
              this.shouldTrack(trackingLeaves, prevSibIndex))
          ) {
            // if this should track the sibling node which is not a pre-hashed zero
            cached[`0x${prevSibIndex.toString('hex')}`] = `0x${latestSiblings[
              level
            ].toString('hex')}`
          }
        }

        if (hasRightSibling) {
          // right empty sibling
          latestSiblings[level] = node // current node will be the next merkle proof's left sibling
          node = this.config.hasher.parentOf(
            node,
            this.config.hasher.preHash[level],
          )
        } else {
          // left sibling
          // keep current sibling
          node = this.config.hasher.parentOf(latestSiblings[level], node)
        }
      }
      // update root
      root = node
      // increment index
      if (this.zero instanceof Field) {
        index = Field.from(index.addn(1)) as T
      } else {
        index = index.addn(1) as T
      }
    }
    // update the latest siblings
    this.data = {
      root,
      index,
      siblings: latestSiblings,
    }
    this.metadata.end = index
    // Update database
    // update rollup snapshot
    const rollUpSync = {
      start: hexify(start),
      end: hexify(index),
    }
    const rollUpSnapshot = {
      root: hexify(root),
      index: hexify(index),
      siblings: JSON.stringify(latestSiblings.map(sib => hexify(sib))),
    }
    await this.db.prisma.lightTree.upsert({
      where: {
        species_treeIndex: {
          species: this.species,
          treeIndex: this.metadata.index,
        },
      },
      update: {
        ...rollUpSync,
        ...rollUpSnapshot,
      },
      create: {
        ...rollUpSync,
        ...rollUpSnapshot,
        species: this.species,
        treeIndex: this.metadata.index,
      },
    })
    // insert notes
    for (const candidate of candidates) {
      const note = {
        hash: hexify(candidate.leafHash),
        index: hexify(index),
        eth: candidate.note?.eth.toHex(),
        pubKey: candidate.note?.pubKey.toHex(),
        salt: candidate.note?.salt.toHex(),
        tokenAddr: candidate.note?.tokenAddr.toHex(),
        erc20Amount: candidate.note?.erc20Amount.toHex(),
        nft: candidate.note?.nft.toHex(),
      }
      await this.db.prisma.note.upsert({
        where: { hash: note.hash },
        update: note,
        create: {
          ...note,
          tree: {
            connect: {
              species_treeIndex: {
                species: this.metadata.species,
                treeIndex: this.metadata.index,
              },
            },
          },
        },
      })
    }
    // update cached nodes
    for (const nodeIndex of Object.keys(cached)) {
      await this.db.prisma.treeNode.upsert({
        where: {
          treeId_nodeIndex: {
            treeId: this.metadata.id,
            nodeIndex,
          },
        },
        update: {
          value: cached[nodeIndex],
        },
        create: {
          treeId: this.metadata.id,
          nodeIndex,
          value: cached[nodeIndex],
        },
      })
    }
    return {
      root,
      index,
      siblings: latestSiblings,
    }
  }

  static async initTreeFromDatabase<T extends Field | BN>({
    db,
    species,
    metadata,
    data,
    config,
  }: {
    db: DB
    species: TreeSpecies
    metadata: TreeMetadata<T>
    data: TreeData<T>
    config: TreeConfig<T>
  }): Promise<{
    db: DB
    species: TreeSpecies
    metadata: TreeMetadata<T>
    data: TreeData<T>
    config: TreeConfig<T>
  }> {
    // Check the data has a valid merkle proof
    if (
      !startingLeafProof(config.hasher, data.root, data.index, data.siblings)
    ) {
      throw Error('bootstrapped with invalid merkle proof')
    }
    // If it does not have force update config, check existing merkle tree
    const where = {
      species_treeIndex: {
        species,
        treeIndex: metadata.index,
      },
    }
    const exisingTree = await db.prisma.lightTree.findOne({
      where,
    })
    if (
      !config.forceUpdate &&
      data.index.lte(toBN(exisingTree?.index || '0'))
    ) {
      throw Error('Bootstrap is behind the database. Use forceUpdate config')
    }
    // Create or update the merkle tree using the "bootstrapTree" preset query
    const tree = {
      species,
      treeIndex: metadata.index,
      // rollup sync data
      start: hexify(data.index),
      end: hexify(data.index),
      // rollup snapshot data
      root: hexify(data.root),
      index: hexify(data.index),
      siblings: JSON.stringify(data.siblings.map(sib => hexify(sib))),
    }
    const newTree = await db.prisma.lightTree.upsert({
      where,
      update: tree,
      create: {
        ...tree,
      },
    })
    const { start, end, treeIndex } = newTree
    // Return tree object
    let _start: T
    let _end: T
    if (metadata.start instanceof Field) {
      _start = Field.from(start) as T
      _end = Field.from(end) as T
    } else {
      _start = toBN(start) as T
      _end = toBN(end) as T
    }
    return {
      db,
      species,
      metadata: {
        ...metadata,
        index: treeIndex,
        start: _start,
        end: _end,
      },
      data,
      config,
    }
  }

  /**
   * It returns true when the given node is a sibling of any leaf to keep tracking
   * @param nodeIndex Tree node's index
   */
  private shouldTrack(trackingLeaves: T[], nodeIndex: BN): boolean {
    let leafIndex: BN
    let pathIndex: BN
    for (const leaf of trackingLeaves) {
      leafIndex = new BN(1).shln(this.depth).or(leaf)
      pathIndex = leafIndex.shrn(leafIndex.bitLength() - nodeIndex.bitLength())
      // if the node is one of the sibling for the leaf proof return true
      if (pathIndex.xor(nodeIndex).eqn(1)) return true
    }
    return false
  }

  abstract async indexesOfTrackingLeaves(): Promise<T[]>
}
