import UniswapV3Orderbook from "@/components/orderbooks/uniswap-v3";
import Image from "next/image";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
       <UniswapV3Orderbook/>
    </main>
  );
}
