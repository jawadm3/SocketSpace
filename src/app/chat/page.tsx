'use client';

import { useEffect, useState } from 'react';
import socket from '@/lib/socket';

type Message = {
  text: string;
  sender: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const sendMessage = () => {
    if (input.trim() === '') return;

    const newMessage: Message = {
      text: input,
      sender: 'You',
    };

    socket.emit('message', newMessage);
    setMessages((prev) => [...prev, newMessage]);
    setInput('');
  };

  useEffect(() => {
    socket.on('message', (data: Message) => {
      setMessages((prev) => [...prev, { ...data, sender: 'Stranger' }]);
    });

    return () => {
      socket.off('message');
    };
  }, []);

  return (
    <div className="min-h-screen p-6 bg-gray-100">
      <h1 className="text-2xl font-bold mb-4">💬 SocketSpace Chat</h1>
      <div className="bg-white rounded shadow p-4 h-96 overflow-y-scroll mb-4">
        {messages.map((msg, idx) => (
          <div key={idx} className="mb-2">
            <span className="font-semibold">{msg.sender}:</span> {msg.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-grow px-4 py-2 rounded border"
          placeholder="Type a message..."
        />
        <button
          onClick={sendMessage}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Send
        </button>
      </div>
    </div>
  );
}
