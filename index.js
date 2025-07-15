const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve Socket.io client
app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.js'));
});

// Queue for waiting users
let waitingUser = null;

// Generate random username
function genUsername() {
  return 'User' + Math.floor(1000 + Math.random() * 9000);
}

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
    console.log(`⏳ ${socket.username} is waiting...`);
  }

  // Text chat
  socket.on('chat message', (msg) => {
    if (socket.partner) {
      socket.partner.emit('chat message', `${socket.username}: ${msg}`);
    }
  });

  // Typing indicators
  socket.on('typing', () => {
    if (socket.partner) {
      socket.partner.emit('typing', socket.username);
    }
  });

  socket.on('stop-typing', () => {
    if (socket.partner) {
      socket.partner.emit('stop-typing');
    }
  });

  // Find new stranger
  socket.on('find new', () => {
    console.log(`${socket.username} is finding a new stranger.`);

    if (socket.partner) {
      socket.partner.emit('stranger disconnected');
      socket.partner.partner = null;
      socket.partner = null;
    }

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

  // WebRTC signaling
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

  // Disconnect
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});