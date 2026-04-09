export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Customer Graph</h1>
      <p className="text-gray-400 mb-8">
        GPU-accelerated customer relationship graph visualization
      </p>
      <div className="bg-gray-800 p-4 rounded-lg text-sm text-gray-300">
        <p className="mb-2">⚠️ WebGPU support required</p>
        <p>Please use Chrome or Edge browser (version 113+)</p>
      </div>
    </main>
  );
}