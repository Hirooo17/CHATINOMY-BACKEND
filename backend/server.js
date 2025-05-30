const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    withCredentials: true,
    methods: ["GET", "POST"]
  },
  
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection (Optional - for storing chat history)
// mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatonimy');

// In-memory storage for active users and rooms
const waitingUsers = new Set();
const activeRooms = new Map();
const userSockets = new Map();

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle user joining the waiting queue
  socket.on('findPartner', (userData) => {
    const userId = socket.id;
    userSockets.set(userId, { socket, userData });

    // If there's someone waiting, pair them
    if (waitingUsers.size > 0) {
      const partnerId = waitingUsers.values().next().value;
      waitingUsers.delete(partnerId);
      
      // Create a room for the pair
      const roomId = uuidv4();
      const partnerSocket = userSockets.get(partnerId).socket;
      
      // Join both users to the room
      socket.join(roomId);
      partnerSocket.join(roomId);
      
      // Store the room info
      activeRooms.set(roomId, {
        users: [userId, partnerId],
        createdAt: new Date()
      });
      
      // Notify both users they found a partner
      socket.emit('partnerFound', { roomId, partnerId });
      partnerSocket.emit('partnerFound', { roomId, partnerId: userId });
      
      console.log(`Room ${roomId} created for ${userId} and ${partnerId}`);
    } else {
      // Add user to waiting queue
      waitingUsers.add(userId);
      socket.emit('waitingForPartner');
      console.log(`User ${userId} added to waiting queue`);
    }
  });

  // Handle sending messages
  socket.on('sendMessage', ({ roomId, message, timestamp }) => {
    const room = activeRooms.get(roomId);
    if (room && room.users.includes(socket.id)) {
      // Send message to the room (excluding sender)
      socket.to(roomId).emit('messageReceived', {
        message,
        timestamp,
        senderId: socket.id
      });
    }
  });

  // Handle typing indicators
  socket.on('typing', ({ roomId, isTyping }) => {
    socket.to(roomId).emit('partnerTyping', { isTyping });
  });

  // Handle disconnecting from chat
  socket.on('disconnect', () => {
    handleUserDisconnect(socket.id);
  });

  socket.on('leaveChat', ({ roomId }) => {
    handleUserLeave(socket.id, roomId);
  });
});

function handleUserDisconnect(userId) {
  console.log('User disconnected:', userId);
  
  // Remove from waiting queue
  waitingUsers.delete(userId);
  
  // Find and cleanup active rooms
  for (const [roomId, room] of activeRooms.entries()) {
    if (room.users.includes(userId)) {
      const partnerId = room.users.find(id => id !== userId);
      if (partnerId && userSockets.has(partnerId)) {
        userSockets.get(partnerId).socket.emit('partnerDisconnected');
      }
      activeRooms.delete(roomId);
      break;
    }
  }
  
  // Remove user socket reference
  userSockets.delete(userId);
}

function handleUserLeave(userId, roomId) {
  const room = activeRooms.get(roomId);
  if (room && room.users.includes(userId)) {
    const partnerId = room.users.find(id => id !== userId);
    if (partnerId && userSockets.has(partnerId)) {
      userSockets.get(partnerId).socket.emit('partnerLeft');
    }
    activeRooms.delete(roomId);
  }
}

// Basic API routes
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    activeUsers: userSockets.size,
    waitingUsers: waitingUsers.size,
    activeRooms: activeRooms.size
  });
});
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the CHATONIMY API' });
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`CHATONIMY server running on port ${PORT}`);
});