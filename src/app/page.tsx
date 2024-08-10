import UniswapV3Orderbook from "@/components/orderbooks/uniswap-v3";
import Head from "next/head";
import Image from "next/image";


export default function Home() {
  return (
    <>
      <Head>
        <title>Alternate Defi</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
      <main className="flex min-h-screen flex-col items-center justify-between p-24">
        <UniswapV3Orderbook />
      </main>
    </>
  );
}
