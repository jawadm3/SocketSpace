'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-transparent">
  <div className="max-w-xl w-full mx-auto">
    <div className="glass-morphism rounded-3xl p-10 shadow-2xl flex flex-col items-center neon-glow">
      <h1 className="gradient-text text-5xl md:text-6xl font-extrabold mb-4 drop-shadow-lg text-center">
        SocketSpace
      </h1>
      <p className="text-lg md:text-xl text-gray-300 mb-8 text-center">
        Real-time anonymous one-to-one chat app <br />built with <span className="text-[#38bdf8] font-semibold">Next.js</span> & <span className="text-[#8f5cff] font-semibold">Socket.IO</span>
      </p>
      <Link
        href="/chat"
        className="animated-button neon-glow bg-gradient-to-r from-[#8f5cff] to-[#38bdf8] text-white px-10 py-4 rounded-xl font-bold text-lg uppercase tracking-wider mt-2 shadow-2xl hover:scale-105 transition-all duration-300"
      >
        Enter Chat
      </Link>
    </div>
  </div>
</main>
  );
}
