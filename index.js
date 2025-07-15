const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const countries = require('countries-list').countries;
const uaParser = require('ua-parser-js');

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

// Fake user count (starts at 600)
let fakeUserCount = 600;
setInterval(() => {
  // Random fluctuation between -5 and +5
  fakeUserCount += Math.floor(Math.random() * 11) - 5;
  // Keep between 590-610
  fakeUserCount = Math.max(590, Math.min(610, fakeUserCount));
  io.emit('user-count', fakeUserCount);
}, 10000);

// Country data
const countryCodes = Object.keys(countries);
function getRandomCountry() {
  const code = countryCodes[Math.floor(Math.random() * countryCodes.length)];
  return {
    code,
    name: countries[code].name,
    emoji: countries[code].emoji
  };
}

// Queue system
let waitingUser = null;

// User data storage
const users = new Map();

io.on('connection', (socket) => {
  // Initialize user data
  const userAgent = uaParser(socket.handshake.headers['user-agent']);
  const country = getRandomCountry();
  
  const userData = {
    id: 'user_' + Math.random().toString(36).substr(2, 8),
    username: `Stranger-${Math.floor(1000 + Math.random() * 9000)}`,
    country,
    isUsingVPN: Math.random() < 0.2, // 20% chance of "using VPN"
    isVirtualCam: Math.random() < 0.1, // 10% chance of "virtual cam"
    connectionTime: null,
    partner: null
  };
  
  users.set(socket.id, userData);
  socket.emit('user-data', userData);
  io.emit('user-count', fakeUserCount);

  console.log(`🟢 ${userData.id} connected from ${country.name}`);

  // Pairing logic
  if (waitingUser) {
    const partner = waitingUser;
    const partnerData = users.get(partner.id);
    
    userData.partner = partner;
    partnerData.partner = socket;
    userData.connectionTime = Date.now();
    partnerData.connectionTime = Date.now();
    
    waitingUser = null;

    socket.emit('paired', { 
      partner: {
        id: partnerData.id,
        country: partnerData.country,
        isUsingVPN: partnerData.isUsingVPN,
        isVirtualCam: partnerData.isVirtualCam
      }
    });
    
    partner.emit('paired', { 
      partner: {
        id: userData.id,
        country: userData.country,
        isUsingVPN: userData.isUsingVPN,
        isVirtualCam: userData.isVirtualCam
      }
    });

    console.log(`🔗 Paired ${userData.id} <--> ${partnerData.id}`);
  } else {
    waitingUser = socket;
    socket.emit('waiting');
    console.log(`⏳ ${userData.id} is waiting...`);
  }

  // Text chat
  socket.on('chat message', (msg) => {
    const user = users.get(socket.id);
    if (user.partner) {
      user.partner.emit('chat message', {
        text: msg,
        sender: user.id,
        timestamp: Date.now()
      });
    }
  });

  // Typing indicators
  socket.on('typing', () => {
    const user = users.get(socket.id);
    if (user.partner) {
      user.partner.emit('typing', user.id);
    }
  });

  socket.on('stop-typing', () => {
    const user = users.get(socket.id);
    if (user.partner) {
      user.partner.emit('stop-typing');
    }
  });

  // Find new stranger
  socket.on('find new', () => {
    const user = users.get(socket.id);
    console.log(`${user.id} is finding a new stranger.`);

    if (user.partner) {
      user.partner.emit('stranger disconnected');
      const partnerData = users.get(user.partner.id);
      partnerData.partner = null;
      user.partner = null;
    }

    if (waitingUser === null) {
      waitingUser = socket;
      socket.emit('waiting');
    } else if (waitingUser !== socket) {
      const partner = waitingUser;
      const partnerData = users.get(partner.id);
      
      waitingUser = null;
      user.partner = partner;
      partnerData.partner = socket;
      user.connectionTime = Date.now();
      partnerData.connectionTime = Date.now();

      socket.emit('paired', { 
        partner: {
          id: partnerData.id,
          country: partnerData.country,
          isUsingVPN: partnerData.isUsingVPN,
          isVirtualCam: partnerData.isVirtualCam
        }
      });
      
      partner.emit('paired', { 
        partner: {
          id: user.id,
          country: user.country,
          isUsingVPN: user.isUsingVPN,
          isVirtualCam: user.isVirtualCam
        }
      });

      console.log(`🔁 Repaired ${user.id} <--> ${partnerData.id}`);
    }
  });

  // WebRTC signaling
  const webrtcEvents = ['webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate'];
  webrtcEvents.forEach(event => {
    socket.on(event, (data) => {
      const user = users.get(socket.id);
      if (user.partner) {
        user.partner.emit(event, data);
      }
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;

    console.log(`🔴 ${user.id} disconnected`);

    if (waitingUser === socket) {
      waitingUser = null;
    }

    if (user.partner) {
      user.partner.emit('stranger disconnected');
      const partnerData = users.get(user.partner.id);
      if (partnerData) partnerData.partner = null;
    }

    users.delete(socket.id);
    io.emit('user-count', fakeUserCount);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});