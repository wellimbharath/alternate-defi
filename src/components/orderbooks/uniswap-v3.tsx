'use client'
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Github, Loader2 } from 'lucide-react';

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


const Q96 = ethers.BigNumber.from(2).pow(96);
const Q192 = ethers.BigNumber.from(2).pow(192);


const priceToSqrtP = (price: number): ethers.BigNumber => {
  if (price <= 0) return ethers.constants.Zero;
  return ethers.BigNumber.from(
    ethers.utils.parseUnits(Math.sqrt(price).toFixed(8), 8)
  ).mul(Q96).div(ethers.utils.parseUnits('1', 8));
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
  const [subgraphUrl, setSubgraphUrl] = useState<string>('https://subgraph.satsuma-prod.com/[api-key]/perosnal--524835/community/uniswap-v3-mainnet/version/0.0.1/api');
  const [selectedPair, setSelectedPair] = useState<TokenPair | null>(null);
  const [customContractAddress, setCustomContractAddress] = useState<string>('0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [orderbook, setOrderbook] = useState<OrderbookEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token0Symbol, setToken0Symbol] = useState<string>('');
  const [token0Decimals, setToken0Decimals] = useState<number>(0);
  const [token1Decimals, setToken1Decimals] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [token1Symbol, setToken1Symbol] = useState<string>('');
  const [poolFee, setPoolFee] = useState<number | null>(null);

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

    let allTicks: any = [];
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

  const processPoolData = useCallback((poolData: any) => {

    setToken0Symbol(poolData.token0.symbol);
    setToken1Symbol(poolData.token1.symbol);

    setToken0Decimals(parseInt(poolData.token0.decimals));
    setToken1Decimals(parseInt(poolData.token1.decimals));

    setPoolFee(parseFloat(poolData.feeTier) / 10000);

    let token0Decimals = parseInt(poolData.token0.decimals);
    let token1Decimals = parseInt(poolData.token1.decimals);

    const currentTick = parseInt(poolData.tick);
    const sqrtPrice = ethers.BigNumber.from(poolData.sqrtPrice);
    const currentPrice = parseFloat(sqrtPToPrice(sqrtPrice).toString()) / (10 ** (token1Decimals - token0Decimals));

    setCurrentPrice(1 / currentPrice);

    const asks: OrderbookEntry[] = [];
    const bids: OrderbookEntry[] = [];

    let cumulativeLiquidity = ethers.BigNumber.from(0);

    poolData.ticks.forEach((tick: any) => {
      const tickIdx = parseInt(tick.tickIdx);
      const liquidityNet = ethers.BigNumber.from(tick.liquidityNet);
      cumulativeLiquidity = cumulativeLiquidity.add(liquidityNet);

      if (cumulativeLiquidity.gt(0)) {
        const sqrtPriceX96 = priceToSqrtP(1.0001 ** tickIdx);
        const price = parseFloat(sqrtPToPrice(sqrtPriceX96).toString()) / (10 ** (token1Decimals - token0Decimals));

        // Calculate amounts based on liquidity
        const amount0 = getAmount0ForLiquidity(sqrtPrice, sqrtPriceX96, cumulativeLiquidity);
        const amount1 = getAmount1ForLiquidity(sqrtPrice, sqrtPriceX96, cumulativeLiquidity);

        // Convert amounts to decimal representation
        const decimalAmount0 = parseFloat(ethers.utils.formatUnits(amount0, token0Decimals));
        const decimalAmount1 = parseFloat(ethers.utils.formatUnits(amount1, token1Decimals));

        if (decimalAmount0 > 0 && decimalAmount1 > 0) {
          const entry: OrderbookEntry = {
            price: 1 / price,
            liquidity: decimalAmount1.toString(),
            type: tickIdx > currentTick ? 'bid' : 'ask'
          };

          if (tickIdx > currentTick) {
            bids.push(entry);
          } else {
            asks.push(entry);
          }
        }
      }
    });

    // Sort asks from lowest to highest price
    asks.sort((a, b) => a.price - b.price);
    // Sort bids from highest to lowest price
    bids.sort((a, b) => b.price - a.price);

    // Slice to get top 50 asks and bids
    const topAsks = asks.slice(0, 15);
    const topBids = bids.slice(0, 15);

    // Combine and set the orderbook
    setOrderbook([...topAsks.reverse(), ...topBids]);
  }, []);

  const fetchPoolData = async () => {
    setError(null);
    setIsLoading(true);
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
      const poolData = dataSource === 'subgraph' ? await fetchSubgraphData() : await fetchRpcData();
      processPoolData(poolData);
    } catch (err) {
      console.error(err);
      setError(`Failed to fetch pool data: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const chartData = useMemo(() => {
    let bidSum = 0;
    let askSum = 0;
    return orderbook.map(order => {
      if (order.type === 'bid') {
        bidSum += parseFloat(order.liquidity);
        return { price: order.price, bidDepth: bidSum, askDepth: 0 };
      } else {
        askSum += parseFloat(order.liquidity);
        return { price: order.price, bidDepth: 0, askDepth: askSum };
      }
    });
  }, [orderbook]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 border border-gray-300 rounded shadow">
          <p className="text-sm">Price: {label.toFixed(6)}</p>
          {payload[0].value > 0 && (
            <p className="text-sm text-green-600">Bid Depth: {payload[0].value.toFixed(2)}</p>
          )}
          {payload[1].value > 0 && (
            <p className="text-sm text-red-600">Ask Depth: {payload[1].value.toFixed(2)}</p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="w-full max-w-3xl mx-auto grid grid-cols-2">
      <>
        <CardHeader>
          <CardTitle>Uniswap v3 Orderbook</CardTitle>
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
              <>
              <Input
                value={subgraphUrl}
                onChange={(e) => setSubgraphUrl(e.target.value)}
                placeholder="Enter Subgraph URL"
              />

              <span className="text-xs">* get your api key from <a href="https://subgraphs.alchemy.com/subgraphs/5603"> Alchemy </a> or <a href="https://thegraph.com/studio/apikeys/"> TheGraph </a> </span>
              </>
            ) : (
              <Input
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
                placeholder="Enter RPC URL"
              />

            )}
            {/* <Select onValueChange={(value) => setSelectedPair(popularPairs.find(pair => pair.address === value) || null)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Token Pair" />
            </SelectTrigger>
            <SelectContent>
              {popularPairs.map((pair) => (
                <SelectItem key={pair.address} value={pair.address}>{pair.name}</SelectItem>
              ))}
            </SelectContent>
          </Select> */}
            <br />
            {/* or */}
            <>

            <Input
              value={customContractAddress}
              onChange={(e) => setCustomContractAddress(e.target.value)}
              placeholder="Enter custom pool contract address"
            />
              <span className="text-xs"> * Uni v3 Pool Address</span>
            </>
            <br/>
            <Button onClick={fetchPoolData}> {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Fetch Data'
            )}</Button>
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

              </div>
              <p className="mb-2">Pool Fee: {poolFee}%</p>
              <p className="mb-4">Current Price: {currentPrice.toFixed(token0Decimals)}  </p>

              <div className="h-64 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <XAxis
                        dataKey="price"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(value) => value.toFixed(2)}
                      />
                      <YAxis />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="stepAfter"
                        dataKey="bidDepth"
                        stackId="1"
                        stroke="#82ca9d"
                        fill="#82ca9d"
                      />
                      <Area
                        type="stepAfter"
                        dataKey="askDepth"
                        stackId="1"
                        stroke="#ff7e76"
                        fill="#ff7e76"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ResponsiveContainer>
              </div>


            </>

          )}
 <ul className="text-xs">
          Example V3 Contracts :
            <li> USDC/WETH : 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640</li>
            <li> WBTC/ETH : 0xCBCdF9626bC03E24f779434178A73a0B4bad62eD </li>
          </ul>

        </CardHeader>

      </>
      <CardContent>

        <div className="overflow-x-auto">
          <Table className="w-full text-xs">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="py-1">Price</TableHead>
                <TableHead className="py-1">Liquidity</TableHead>
                <TableHead className="py-1">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderbook.map((order, index) => (
                <TableRow key={index} className={`${order.type === 'bid' ? "bg-green-50" : "bg-red-50"} hover:bg-transparent`}>
                  <TableCell className="py-0.5">{order.price.toFixed(6)}</TableCell>
                  <TableCell className="py-0.5">{parseFloat(order.liquidity).toFixed(2)}</TableCell>
                  <TableCell className="py-0.5">{order.type.toUpperCase()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col items-center justify-center pt-4 pb-2 px-4 mt-4 border-t text-sm text-gray-500 flex-col-2">
        <div className="flex items-center mb-2">
         Made with ❤️ by <a href="https://twitter.com/wellimbharath" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700">@wellimbharath</a>
        </div>

        </CardFooter>
        <CardFooter className="flex flex-col items-center justify-center pt-4 pb-2 px-4 mt-4 border-t text-sm text-gray-500 flex-col-2">
        <div className="flex items-center space-x-4">
          <a href="https://github.com/wellimbharath/alternate-defi" target="_blank" rel="noopener noreferrer" className="flex items-center hover:text-gray-700">
            <Github className="h-4 w-4 mr-1" />
            <span>GitHub</span>
          </a>

          <a href="#" target="_blank" rel="noopener noreferrer" className="hover:text-black-700">
            <b>Alternate Defi</b>
          </a>
        </div>
      </CardFooter>
    </Card>
  );
};

export default UniswapV3Orderbook;