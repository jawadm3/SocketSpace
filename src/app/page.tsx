'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-4">👋 Welcome to SocketSpace</h1>
      <p className="mb-6 text-center text-gray-700">
        Real-time anonymous one-to-one chat app built with Next.js & Socket.IO
      </p>
      <Link
        href="/chat"
        className="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700 transition"
      >
        Enter Chat
      </Link>
    </main>
  );
}
