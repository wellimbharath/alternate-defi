import { BigNumber } from 'ethers';

// Constants
const Q96 = BigNumber.from(2).pow(96);
const Q192 = BigNumber.from(2).pow(192);
const MAX_TICK = 887272;
const MIN_TICK = -887272;
export const UniswapV3Math = {
  // Convert sqrt price to regular price
  sqrtPriceX96ToPrice(sqrtPriceX96: BigNumber, decimals0: number, decimals1: number): number {
    const price = sqrtPriceX96.mul(sqrtPriceX96).div(Q192);
    const adjustedPrice = price.div(BigNumber.from(10).pow(decimals1-decimals0)) ;
    return parseFloat(adjustedPrice.toString()) / 2**192;
  },

  // Get sqrt price for a given tick
  getSqrtRatioAtTick(tick: number): BigNumber {
    const absTick = Math.abs(tick);
    let ratio: BigNumber = BigNumber.from(1).shl(96);

    if ((absTick & 0x1) !== 0)  ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x2) !== 0)  ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x4) !== 0)  ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x8) !== 0)  ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x10) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x20) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x40) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x80) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x100) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x200) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x400) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x800) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x1000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x2000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x4000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x8000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x10000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x20000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));
    if ((absTick & 0x40000) !== 0) ratio = ratio.mul(BigNumber.from('79228162514264337593543950336')).div(BigNumber.from('79228162514264337593543950335'));

    if (tick > 0) return ratio;
    return BigNumber.from(2).pow(192).div(ratio);
  },

  sqrtPriceX96ToTick(sqrtPriceX96: BigNumber): number {
    // Ensure the input is a BigNumber
    if (!BigNumber.isBigNumber(sqrtPriceX96)) {
      sqrtPriceX96 = BigNumber.from(sqrtPriceX96);
    }

    // Make sure price is positive
    if (sqrtPriceX96.lte(0)) {
      throw new Error('Invalid sqrtPriceX96');
    }

    // Calculate the tick
    let tick = 0;
    let ratio = sqrtPriceX96;

    if (ratio.gte(Q96)) {
      ratio = BigNumber.from(Q192).div(ratio);
    } else {
      ratio = ratio.shl(96);
      tick = -1;
    }

    let msb = 0;
    for (let i = 0; i < 14; i++) {
      if (ratio.gte(BigNumber.from(2).pow(128))) {
        ratio = ratio.shr(128);
        msb += 128;
      }
      if (ratio.gte(BigNumber.from(2).pow(64))) {
        ratio = ratio.shr(64);
        msb += 64;
      }
      if (ratio.gte(BigNumber.from(2).pow(32))) {
        ratio = ratio.shr(32);
        msb += 32;
      }
      if (ratio.gte(BigNumber.from(2).pow(16))) {
        ratio = ratio.shr(16);
        msb += 16;
      }
      if (ratio.gte(BigNumber.from(2).pow(8))) {
        ratio = ratio.shr(8);
        msb += 8;
      }
      if (ratio.gte(BigNumber.from(2).pow(4))) {
        ratio = ratio.shr(4);
        msb += 4;
      }
      if (ratio.gte(BigNumber.from(2).pow(2))) {
        ratio = ratio.shr(2);
        msb += 2;
      }
      if (ratio.gte(BigNumber.from(2))) {
        msb += 1;
      }
    }

    if (msb >= 128) {
      msb = msb - 128;
      tick = tick + 1;
    }

    tick = tick * 256 + msb - 49;
    if (tick > 0 && sqrtPriceX96.lt(Q96)) {
      tick -= 1;
    }

    return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
  },

  // Get price for a given tick
  getPriceAtTick(tick: number, decimals0: number, decimals1: number): number {
    const sqrtPriceX96 = this.getSqrtRatioAtTick(tick);
    return this.sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1);
  },

  // Calculate liquidity for amount0
  getLiquidityForAmount0(sqrtPriceA: BigNumber, sqrtPriceB: BigNumber, amount0: BigNumber): BigNumber {
    if (sqrtPriceA.gt(sqrtPriceB)) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
    const numerator = amount0.mul(sqrtPriceA).mul(sqrtPriceB);
    const denominator = sqrtPriceB.sub(sqrtPriceA);
    return numerator.div(denominator);
  },

  // Calculate liquidity for amount1
  getLiquidityForAmount1(sqrtPriceA: BigNumber, sqrtPriceB: BigNumber, amount1: BigNumber): BigNumber {
    if (sqrtPriceA.gt(sqrtPriceB)) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
    return amount1.mul(Q96).div(sqrtPriceB.sub(sqrtPriceA));
  },

  // Calculate amount0 for given liquidity
  getAmount0ForLiquidity(sqrtPriceA: BigNumber, sqrtPriceB: BigNumber, liquidity: BigNumber): BigNumber {
    if (sqrtPriceA.gt(sqrtPriceB)) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
    return liquidity.mul(Q96).mul(sqrtPriceB.sub(sqrtPriceA)).div(sqrtPriceA).div(sqrtPriceB);
  },

  // Calculate amount1 for given liquidity
  getAmount1ForLiquidity(sqrtPriceA: BigNumber, sqrtPriceB: BigNumber, liquidity: BigNumber): BigNumber {
    if (sqrtPriceA.gt(sqrtPriceB)) [sqrtPriceA, sqrtPriceB] = [sqrtPriceB, sqrtPriceA];
    return liquidity.mul(sqrtPriceB.sub(sqrtPriceA)).div(Q96);
  }
};