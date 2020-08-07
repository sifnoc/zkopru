import { Field } from '@zkopru/babyjubjub'
import { Note } from './note'

export class Sum {
  eth: Field

  erc20: { [addr: string]: Field }

  erc721: { [addr: string]: Field[] }

  constructor(
    eth: Field,
    erc20: { [addr: string]: Field },
    erc721: { [addr: string]: Field[] },
  ) {
    this.eth = eth
    this.erc20 = erc20
    this.erc721 = erc721
  }

  static etherFrom(notes: Note[]): Field {
    let sum = Field.from(0)
    for (const note of notes) {
      sum = sum.add(note.asset.eth)
    }
    return sum
  }

  static erc20From(notes: Note[]): { [addr: string]: Field } {
    const erc20: { [addr: string]: Field } = {}
    for (const note of notes) {
      const addr = note.asset.tokenAddr.toHex()
      if (!note.asset.erc20Amount.isZero() && note.asset.nft.isZero()) {
        const prev = erc20[addr] ? erc20[addr] : Field.from(0)
        erc20[addr] = prev.add(note.asset.erc20Amount)
      }
    }
    return erc20
  }

  static nftsFrom(notes: Note[]): { [addr: string]: Field[] } {
    const erc721: { [addr: string]: Field[] } = {}
    for (const note of notes) {
      const addr = note.asset.tokenAddr.toHex()
      if (note.asset.erc20Amount.isZero() && !note.asset.nft.isZero()) {
        if (!erc721[addr]) {
          erc721[addr] = []
        }
        erc721[addr].push(note.asset.nft)
      }
    }
    return erc721
  }

  static from(notes: Note[]): Sum {
    return {
      eth: Sum.etherFrom(notes),
      erc20: Sum.erc20From(notes),
      erc721: Sum.nftsFrom(notes),
    }
  }
}
