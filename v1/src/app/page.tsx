'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex h-[calc(100vh-7.7rem)] flex-col items-center justify-center p-6 bg-transparent">
  <div className="max-w-xl w-full mx-auto">
    <div className="glass-morphism rounded-3xl p-10 shadow-2xl flex flex-col items-center neon-glow">
      <h1 className="gray-text text-5xl md:text-6xl font-extrabold mb-4 drop-shadow-lg text-center">
        SocketSpace 🚀
      </h1>
      <p className="text-lg md:text-xl text-gray-300 mb-8 text-center">
        Real-time anonymous one-to-one chat app <br />built with <span className="text-[#38bdf8] font-semibold">Next.js</span> & <span className="text-[#8f5cff] font-semibold">Socket.IO</span>
      </p>
      <Link href="/chat" className="btn bg-white text-black border-[#e5e5e5] hover:bg-gray-200">
        <svg aria-label="Email icon" width="16" height="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="mr-2"><g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2" fill="none" stroke="black"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></g></svg>
        Start Chatting
      </Link>
    </div>
  </div>
</main>
  );
}
