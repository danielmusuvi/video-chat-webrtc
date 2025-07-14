const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve files from the 'public' folder
app.use(express.static('public'));

// Queue for waiting users
let waitingUser = null;

// Helper: Generate anonymous ID
function genUsername() {
  return 'User' + Math.floor(1000 + Math.random() * 9000);
}

// When a new user connects
io.on('connection', (socket) => {
  socket.username = genUsername();
  socket.emit('your-name', socket.username);

  console.log(`🟢 ${socket.username} connected (${socket.id})`);

  if (waitingUser) {
    const partner = waitingUser;
    socket.partner = partner;
    partner.partner = socket;

    waitingUser = null;

    socket.emit('paired', { with: partner.username });
    partner.emit('paired', { with: socket.username });

    console.log(`🔗 Paired ${socket.username} <--> ${partner.username}`);
  } else {
    waitingUser = socket;
    socket.emit('waiting');
    console.log(`⏳ ${socket.username} is waiting for a stranger...`);
  }

  // TEXT CHAT
  socket.on('chat message', (msg) => {
    if (socket.partner) {
      socket.partner.emit('chat message', `${socket.username}: ${msg}`);
    }
  });

  // "Find New Stranger" Button
  socket.on('find new', () => {
    console.log(`${socket.username} is finding a new stranger.`);

    if (socket.partner) {
      socket.partner.emit('stranger disconnected');
      socket.partner.partner = null;
    }

    socket.partner = null;

    if (waitingUser === null) {
      waitingUser = socket;
      socket.emit('waiting');
    } else if (waitingUser !== socket) {
      const partner = waitingUser;
      waitingUser = null;

      socket.partner = partner;
      partner.partner = socket;

      socket.emit('paired', { with: partner.username });
      partner.emit('paired', { with: socket.username });

      console.log(`🔁 Repaired ${socket.username} <--> ${partner.username}`);
    }
  });

  // WebRTC Signaling
  socket.on('webrtc-offer', (offer) => {
    if (socket.partner) {
      socket.partner.emit('webrtc-offer', offer);
    }
  });

  socket.on('webrtc-answer', (answer) => {
    if (socket.partner) {
      socket.partner.emit('webrtc-answer', answer);
    }
  });

  socket.on('webrtc-ice-candidate', (candidate) => {
    if (socket.partner) {
      socket.partner.emit('webrtc-ice-candidate', candidate);
    }
  });

  // When a user disconnects
  socket.on('disconnect', () => {
    console.log(`🔴 ${socket.username} disconnected`);

    if (waitingUser === socket) {
      waitingUser = null;
    }

    if (socket.partner) {
      socket.partner.emit('stranger disconnected');
      socket.partner.partner = null;
    }
  });
});

// Start server
server.listen(3000, () => {
  console.log('🚀 Server is running on http://localhost:3000');
});
