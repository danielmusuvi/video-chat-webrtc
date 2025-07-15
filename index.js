const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const uaParser = require('ua-parser-js');
const requestIp = require('request-ip');
const geoip = require('geoip-lite');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Built-in country data
const countries = {
  "US": { name: "United States", emoji: "🇺🇸" },
  "GB": { name: "United Kingdom", emoji: "🇬🇧" },
  "CA": { name: "Canada", emoji: "🇨🇦" },
  "AU": { name: "Australia", emoji: "🇦🇺" },
  // Add more countries as needed
  "KE": { name: "Kenya", emoji: "🇰🇪" },
  "NG": { name: "Nigeria", emoji: "🇳🇬" },
  "ZA": { name: "South Africa", emoji: "🇿🇦" },
  "IN": { name: "India", emoji: "🇮🇳" },
  "CN": { name: "China", emoji: "🇨🇳" },
  "JP": { name: "Japan", emoji: "🇯🇵" },
  "BR": { name: "Brazil", emoji: "🇧🇷" },
  "FR": { name: "France", emoji: "🇫🇷" },
  "DE": { name: "Germany", emoji: "🇩🇪" },
  "IT": { name: "Italy", emoji: "🇮🇹" },
  "ES": { name: "Spain", emoji: "🇪🇸" },
  "RU": { name: "Russia", emoji: "🇷🇺" },
  "MX": { name: "Mexico", emoji: "🇲🇽" }
};

function getCountryFromIP(ip) {
  // For local testing
  if (ip === '::1' || ip === '127.0.0.1') {
    return { 
      code: 'KE', 
      name: 'Kenya', 
      emoji: '🇰🇪',
      isUsingVPN: false
    };
  }

  const geo = geoip.lookup(ip);
  if (!geo) return null;

  const countryCode = geo.country;
  const country = countries[countryCode] || { 
    name: 'Unknown', 
    emoji: '🌐',
    isUsingVPN: Math.random() < 0.2
  };

  return {
    code: countryCode,
    name: country.name,
    emoji: country.emoji,
    isUsingVPN: country.isUsingVPN || Math.random() < 0.2
  };
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(requestIp.mw());

// Fake user count (starts at 600)
let fakeUserCount = 600;
setInterval(() => {
  fakeUserCount += Math.floor(Math.random() * 11) - 5;
  fakeUserCount = Math.max(590, Math.min(610, fakeUserCount));
  io.emit('user-count', fakeUserCount);
}, 10000);

// Queue system
let waitingUser = null;
const users = new Map();

io.on('connection', (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  const country = getCountryFromIP(ip) || { 
    code: 'US', 
    name: 'Unknown', 
    emoji: '🌐',
    isUsingVPN: Math.random() < 0.2
  };

  const userAgent = uaParser(socket.handshake.headers['user-agent']);
  
  const userData = {
    id: 'user_' + Math.random().toString(36).substr(2, 8),
    username: `Stranger-${Math.floor(1000 + Math.random() * 9000)}`,
    country,
    isUsingVPN: country.isUsingVPN,
    isVirtualCam: Math.random() < 0.1,
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