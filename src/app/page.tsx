'use client';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white">
      <h1 className="text-4xl font-bold mb-6">Welcome to SocketSpace 💬</h1>
      <p className="text-gray-400 mb-4">An anonymous one-on-one chat room</p>
      <button
        onClick={() => router.push('/chat')}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
      >
        Start Chatting
      </button>
    </main>
  );
}

