// src/lib/socket.ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:8001', {
  transports: ['websocket'],
});

export default socket;