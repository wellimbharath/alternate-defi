'use client'
import React, { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Switch } from '../ui/switch';

const UNISWAP_V3_POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
  "function tickSpacing() external view returns (int24)"
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

interface OrderbookEntry {
  price: number;
  liquidity: string;
  type: string;
}

interface TokenPair {
  name: string;
  address: string;
}

const popularPairs: TokenPair[] = [
  { name: 'ETH/USDC', address: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8' },
  { name: 'WBTC/ETH', address: '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed' },
  { name: 'USDT/USDC', address: '0x3416cf6c708da44db2624d63ea0aaef7113527c6' },
  { name: 'DAI/USDC', address: '0x5777d92f208679db4b9778590fa3cab3ac9e2168' },
  // Add more pairs as needed
];


const Q96 = ethers.BigNumber.from(2).pow(96);
const Q192 = ethers.BigNumber.from(2).pow(192);


const priceToSqrtP = (price: number): ethers.BigNumber => {
  if (price <= 0) return ethers.constants.Zero;
  return ethers.BigNumber.from(
    ethers.utils.parseUnits(Math.sqrt(price).toFixed(18), 18)
  ).mul(Q96).div(ethers.utils.parseUnits('1', 18));
};

const sqrtPToPrice = (sqrtP: ethers.BigNumber): ethers.BigNumber => {
  if (sqrtP.isZero()) return ethers.BigNumber.from(0);
  const price = sqrtP.mul(sqrtP).div(Q192);
  return price;
};

const getLiquidityForAmount0 = (sqrtA: ethers.BigNumber, sqrtB: ethers.BigNumber, amount0: ethers.BigNumber): ethers.BigNumber => {
  if (sqrtA.gt(sqrtB)) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA.isZero() || sqrtB.isZero()) return ethers.constants.Zero;
  const numerator = amount0.mul(sqrtA).mul(sqrtB).div(Q96);
  const denominator = sqrtB.sub(sqrtA);
  return denominator.isZero() ? ethers.constants.Zero : numerator.div(denominator);
};

const getLiquidityForAmount1 = (sqrtA: ethers.BigNumber, sqrtB: ethers.BigNumber, amount1: ethers.BigNumber): ethers.BigNumber => {
  if (sqrtA.gt(sqrtB)) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA.isZero() || sqrtB.isZero()) return ethers.constants.Zero;
  const denominator = sqrtB.sub(sqrtA);
  return denominator.isZero() ? ethers.constants.Zero : amount1.mul(Q96).div(denominator);
};

const getAmount0ForLiquidity = (sqrtA: ethers.BigNumber, sqrtB: ethers.BigNumber, liquidity: ethers.BigNumber): ethers.BigNumber => {
  if (sqrtA.gt(sqrtB)) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA.isZero() || sqrtB.isZero() || liquidity.isZero()) return ethers.constants.Zero;
  return liquidity.mul(Q96).mul(sqrtB.sub(sqrtA)).div(sqrtA).div(sqrtB);
};

const getAmount1ForLiquidity = (sqrtA: ethers.BigNumber, sqrtB: ethers.BigNumber, liquidity: ethers.BigNumber): ethers.BigNumber => {
  if (sqrtA.gt(sqrtB)) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA.isZero() || sqrtB.isZero() || liquidity.isZero()) return ethers.constants.Zero;
  return liquidity.mul(sqrtB.sub(sqrtA)).div(Q96);
};


const UniswapV3Orderbook: React.FC = () => {
  const [dataSource, setDataSource] = useState<'subgraph' | 'rpc'>('subgraph');
  const [rpcUrl, setRpcUrl] = useState<string>('');
  const [subgraphUrl, setSubgraphUrl] = useState<string>('https://gateway.thegraph.com/api/9f45d9bf4cb9d1bed40b678415a67563/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV');
  const [selectedPair, setSelectedPair] = useState<TokenPair | null>(null);
  const [customContractAddress, setCustomContractAddress] = useState<string>('0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [orderbook, setOrderbook] = useState<OrderbookEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token0Symbol, setToken0Symbol] = useState<string>('');
  const [token1Symbol, setToken1Symbol] = useState<string>('');
  const [poolFee, setPoolFee] = useState<number | null>(null);
  const [isToken0Base, setIsToken0Base] = useState<boolean>(true);


  const fetchSubgraphData = useCallback(async () => {
    const query = `
      query ($poolAddress: ID!, $skip: Int!) {
        pool(id: $poolAddress) {
          token0 {
            symbol
            decimals
          }
          token1 {
            symbol
            decimals
          }
          feeTier
          sqrtPrice
          tick
          ticks(first: 1000, skip: $skip, orderBy: tickIdx) {
            tickIdx
            liquidityNet
            price0
            price1
          }
        }
      }
    `;

    let allTicks : any = [];
    let skip = 0;
    let poolData = null;

    while (true) {
      const response = await fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: {
            poolAddress: customContractAddress.toLowerCase(),
            skip: skip
          },
        }),
      });

      const result = await response.json();
      if (result.errors) throw new Error(result.errors[0].message);

      const currentData = result.data.pool;

      if (!poolData) {
        poolData = currentData;
      }

      allTicks = allTicks.concat(currentData.ticks);

      if (currentData.ticks.length < 1000) {
        break;
      }

      skip += 1000;
    }

    poolData.ticks = allTicks;
    return poolData;
  }, [subgraphUrl, customContractAddress]);


  const fetchRpcData = useCallback(async () => {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const poolContract = new ethers.Contract(customContractAddress, UNISWAP_V3_POOL_ABI, provider);

    const [token0Address, token1Address, slot0Data, tickSpacing, fee] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.slot0(),
      poolContract.tickSpacing(),
      poolContract.fee(),
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [token0Symbol, token1Symbol, token0Decimals, token1Decimals] = await Promise.all([
      token0Contract.symbol(),
      token1Contract.symbol(),
      token0Contract.decimals(),
      token1Contract.decimals(),
    ]);

    const currentTick = slot0Data.tick;
    const ticks = [];
    for (let i = -50; i <= 50; i++) {
      const tickIdx = Math.round(currentTick / tickSpacing) * tickSpacing + i * tickSpacing;
      const tickData = await poolContract.ticks(tickIdx);
      ticks.push({
        tickIdx,
        liquidityNet: tickData.liquidityNet.toString(),
        price0: (1.0001 ** tickIdx).toString(),
        price1: (1 / 1.0001 ** tickIdx).toString(),
      });
    }

    return {
      token0: { symbol: token0Symbol, decimals: token0Decimals },
      token1: { symbol: token1Symbol, decimals: token1Decimals },
      feeTier: fee.toString(),
      sqrtPrice: slot0Data.sqrtPriceX96.toString(),
      tick: currentTick.toString(),
      ticks,
    };
  }, [rpcUrl, customContractAddress]);

  function getBaseLog(x : number, y: number) {
    return Math.log(y) / Math.log(x);
  }

  const processPoolData = useCallback((poolData: any) => {
    setToken0Symbol(poolData.token0.symbol);
    setToken1Symbol(poolData.token1.symbol);
    setPoolFee(parseFloat(poolData.feeTier) / 10000);

    const token0Decimals = parseInt(poolData.token0.decimals);
    const token1Decimals = parseInt(poolData.token1.decimals);
    const currentTick = parseInt(poolData.tick);

    const sqrtPrice = ethers.BigNumber.from(poolData.sqrtPrice);
    const currentPrice = parseFloat(ethers.utils.formatUnits(sqrtPToPrice(sqrtPrice),(token1Decimals-token0Decimals)));

    setCurrentPrice(isToken0Base ? currentPrice : 1 / currentPrice);

    const newOrderbook: OrderbookEntry[] = [];
    let cumulativeLiquidity = ethers.BigNumber.from(0);

    poolData.ticks.forEach((tick: any) => {
      const tickIdx = parseInt(tick.tickIdx);
      const liquidityNet = ethers.BigNumber.from(tick.liquidityNet);
      cumulativeLiquidity = cumulativeLiquidity.add(liquidityNet);

      if (cumulativeLiquidity.gt(0)) {
        const sqrtPriceX96 = priceToSqrtP(1.0001 ** tickIdx);
        const price = parseFloat(ethers.utils.formatUnits(sqrtPToPrice(sqrtPriceX96),(token1Decimals-token0Decimals)));

        // Calculate amounts based on liquidity
        const amount0 = getAmount0ForLiquidity(sqrtPrice, sqrtPriceX96, cumulativeLiquidity);
        const amount1 = getAmount1ForLiquidity(sqrtPrice, sqrtPriceX96, cumulativeLiquidity);

        // Convert amounts to decimal representation
        const decimalAmount0 = parseFloat(ethers.utils.formatUnits(amount0, token0Decimals));
        const decimalAmount1 = parseFloat(ethers.utils.formatUnits(amount1, token1Decimals));

        console.log("CurrentIndex" , currentTick, "TickIdx", tick.tickIdx)
        newOrderbook.push({
          price: isToken0Base ? price : 1 / price,
          liquidity: isToken0Base ? decimalAmount1.toString() : decimalAmount0.toString(),
          type: (tickIdx > currentTick ? 'ask' : 'bid')
        });
      }
    });

    setOrderbook(newOrderbook.sort((a, b) =>  b.price - a.price ));
  }, [isToken0Base]);

  const fetchPoolData = async () => {
    setError(null);
    try {
      if (dataSource === 'subgraph' && !subgraphUrl) {
        throw new Error('Subgraph URL is required for subgraph data source');
      }
      if (dataSource === 'rpc' && !rpcUrl) {
        throw new Error('RPC URL is required for RPC data source');
      }
      const contractAddress = selectedPair ? selectedPair.address : customContractAddress;
      if (!contractAddress) {
        throw new Error('Contract address is required');
      }
      const poolData = dataSource === 'subgraph' ? await fetchSubgraphData( ) : await fetchRpcData( );
      processPoolData(poolData);
    } catch (err) {
      console.error(err);
      setError(`Failed to fetch pool data: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const toggleBaseToken = () => {
    setIsToken0Base((prevIsToken0Base) => !prevIsToken0Base);
    if (currentPrice !== null) {
      setCurrentPrice(1 / currentPrice);
    }
    setOrderbook((prevOrderbook) =>
      prevOrderbook.map((order) => ({
        ...order,
        price: 1 / order.price,
        type: order.type === 'bid' ? 'ask' : 'bid'
      })).sort((a, b) => isToken0Base ? a.price - b.price : b.price - a.price)
    );
  };

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Uniswap v3 Orderbook</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 mb-4">
          <Select onValueChange={(value: 'subgraph' | 'rpc') => setDataSource(value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Data Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subgraph">Subgraph</SelectItem>
              <SelectItem value="rpc">RPC</SelectItem>
            </SelectContent>
          </Select>
          {dataSource === 'subgraph' ? (
            <Input
              value={subgraphUrl}
              onChange={(e) => setSubgraphUrl(e.target.value)}
              placeholder="Enter Subgraph URL"
            />
          ) : (
            <Input
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              placeholder="Enter RPC URL"
            />
          )}
          <Select onValueChange={(value) => setSelectedPair(popularPairs.find(pair => pair.address === value) || null)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Token Pair" />
            </SelectTrigger>
            <SelectContent>
              {popularPairs.map((pair) => (
                <SelectItem key={pair.address} value={pair.address}>{pair.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={customContractAddress}
            onChange={(e) => setCustomContractAddress(e.target.value)}
            placeholder="Or enter custom pool contract address"
          />
          <Button onClick={fetchPoolData}>Fetch Data</Button>
        </div>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {currentPrice !== null && (
          <>
            <div className="flex justify-between items-center mb-4">
              <p>Token Pair: {token0Symbol} / {token1Symbol}</p>
              <div className="flex items-center space-x-2">
                <span>{isToken0Base ? token0Symbol : token1Symbol} (Base)</span>
                <Switch checked={isToken0Base} onCheckedChange={toggleBaseToken} />
                <span>{isToken0Base ? token1Symbol : token0Symbol} (Quote)</span>
              </div>
            </div>
            <p className="mb-2">Pool Fee: {poolFee}%</p>
            <p className="mb-4">Current Price: {currentPrice.toFixed(6)} {isToken0Base ? token1Symbol : token0Symbol} per {isToken0Base ? token0Symbol : token1Symbol}</p>

            <div className="h-64 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={orderbook}>
                  <XAxis dataKey="price" />
                  <YAxis dataKey="liquidity" />
                  <Tooltip />
                  <Line type="stepAfter" dataKey="liquidity" stroke="#8884d8" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Price ({isToken0Base ? token1Symbol : token0Symbol} per {isToken0Base ? token0Symbol : token1Symbol})</TableHead>
                <TableHead>Liquidity</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderbook.map((order, index) => (
                <TableRow key={index} className={order.type === 'bid' ? "bg-green-100" : "bg-red-100"}>
                  <TableCell>{order.price.toFixed(6)}</TableCell>
                  <TableCell>{parseFloat(order.liquidity).toFixed(2)}</TableCell>
                  <TableCell>{order.type.toUpperCase()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default UniswapV3Orderbook;