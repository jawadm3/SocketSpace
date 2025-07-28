'use client';

import { useEffect, useState, useRef, KeyboardEvent } from 'react';
import io, { Socket } from 'socket.io-client';

interface Message {
  id: string;
  message: string;
  isMe: boolean;
  timestamp: string;
}

let socket: Socket;

export default function Chat() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const getCurrentTimestamp = () => {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSendMessage = () => {
    if (message.trim() && socket?.id) {
      const newMessage: Message = {
        id: socket.id,
        message,
        isMe: true,
        timestamp: getCurrentTimestamp(),
      };

      setMessages((prevMessages) => [...prevMessages, newMessage]);
      socket.emit('message', {
        message,
        timestamp: newMessage.timestamp, // send timestamp to backend
      });
      setMessage('');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    socket = io('http://localhost:8001'); // Make sure server is running on this port

    socket.on('message', (data: { id: string; message: string; timestamp: string }) => {
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          id: data.id,
          message: data.message,
          isMe: false,
          timestamp: data.timestamp,
        },
      ]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="container mx-auto p-4 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex-grow overflow-y-auto p-4 bg-base-200 bg-opacity-50 rounded-lg shadow-inner space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className={`chat ${msg.isMe ? 'chat-end' : 'chat-start'}`}>
            <div className="chat-header text-sm text-base-content/70 mb-1 flex gap-2 items-center">
              <span>{msg.isMe ? 'You' : 'Stranger'}</span>
              <span className="text-xs opacity-60">{msg.timestamp}</span>
            </div>
            <div
              className={`chat-bubble ${
                msg.isMe ? 'chat-bubble-primary' : 'chat-bubble-neutral'
              }`}
            >
              {msg.message}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="mt-4 flex items-center gap-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          className="textarea textarea-bordered w-full"
        />
        <button onClick={handleSendMessage} className="btn btn-primary">
          Send
        </button>
      </div>
    </div>
  );
}
