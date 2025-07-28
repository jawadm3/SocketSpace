'use client';

import { useState, useEffect } from 'react';
import socket from '../lib/socket';

export default function ChatPage() {
  const [messages, setMessages] = useState<{ text: string; sender: string }[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to socket server ✅');
    });

    socket.on('receive-message', (msg: string) => {
      setMessages((prev) => [...prev, { text: msg, sender: 'them' }]);
    });

    return () => {
      socket.off('receive-message');
    };
  }, []);

  const sendMessage = () => {
    if (input.trim() === '') return;

    socket.emit('send-message', input);
    setMessages((prev) => [...prev, { text: input, sender: 'me' }]);
    setInput('');
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="p-4 bg-gray-800 text-lg font-semibold shadow">SocketSpace Chat</div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-xs px-4 py-2 rounded-lg ${
              msg.sender === 'me'
                ? 'bg-blue-600 self-end ml-auto'
                : 'bg-gray-700 self-start mr-auto'
            }`}
          >
            {msg.text}
          </div>
        ))}
      </div>

      <div className="p-4 bg-gray-800 flex gap-2">
        <input
          type="text"
          className="flex-1 px-4 py-2 rounded-lg bg-gray-700 text-white outline-none"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          Send
        </button>
      </div>
    </div>
  );
}
