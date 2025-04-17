const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// MediaSoup settings
const mediasoupSettings = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
    ],
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: null, // This will be dynamically set based on client's connection
      },
    ],
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  },
};

// Stores
const workers = [];
const rooms = new Map();
const peers = new Map();
const transports = new Map();
const producers = new Map();
const consumers = new Map();
const users = new Map();

// Create MediaSoup workers
async function createWorkers() {
  const { numWorkers = 1 } = mediasoupSettings;
  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: mediasoupSettings.worker.logLevel,
      logTags: mediasoupSettings.worker.logTags,
      rtcMinPort: mediasoupSettings.worker.rtcMinPort,
      rtcMaxPort: mediasoupSettings.worker.rtcMaxPort,
    });

    worker.on('died', () => {
      console.error('MediaSoup worker died, exiting');
      process.exit(1);
    });

    workers.push(worker);
  }
}

// Create a room with a router
async function createRoom(roomId) {
  console.log(`Creating MediaSoup room with ID: ${roomId}`);
  
  if (!workers || workers.length === 0) {
    console.error('No MediaSoup workers available');
    throw new Error('No MediaSoup workers available');
  }
  
  const worker = workers[0];
  console.log('Using MediaSoup worker for room creation');
  
  // Create router with appropriate media codecs
  const router = await worker.createRouter({ mediaCodecs: mediasoupSettings.router.mediaCodecs });
  console.log(`Router created for room ${roomId}, Router ID: ${router.id}`);
  
  const room = {
    id: roomId,
    router,
    peers: new Map(),
    recordings: new Map(),
  };
  
  rooms.set(roomId, room);
  console.log(`Room ${roomId} created and stored`);
  
  return room;
}

// Handle recordings directory
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Create WebRTC transport
async function createWebRtcTransport(router, clientIp) {
  console.log('Creating WebRTC transport with router ID:', router.id);
  
  try {
    // Make a copy of the settings to modify for this specific client
    const transportSettings = { ...mediasoupSettings.webRtcTransport };
    
    // Use the client's IP if announcedIp is null
    if (transportSettings.listenIps[0].announcedIp === null) {
      transportSettings.listenIps[0].announcedIp = clientIp || '127.0.0.1';
    }
    
    console.log(`Using announcedIp: ${transportSettings.listenIps[0].announcedIp} for WebRTC transport`);
    
    const transport = await router.createWebRtcTransport(transportSettings);
    console.log('WebRTC transport created, ID:', transport.id);
    
    transport.on('dtlsstatechange', (dtlsState) => {
      console.log(`Transport ${transport.id} DTLS state changed to ${dtlsState}`);
      if (dtlsState === 'closed') {
        console.log(`Transport ${transport.id} closed due to DTLS state`);
        transport.close();
      }
    });

    transport.on('close', () => {
      console.log(`Transport ${transport.id} closed`);
    });

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  } catch (error) {
    console.error('Error creating WebRTC transport:', error);
    throw error;
  }
}

// Socket.io connection handling
io.on('connection', async (socket) => {
  const { roomId, peerId } = socket.handshake.query;
  console.log('New connection', peerId, 'in room', roomId);
  
  // Get client IP address
  const clientIp = socket.handshake.headers['x-forwarded-for'] || 
                   socket.handshake.address ||
                   '127.0.0.1';
                   
  console.log(`Client connected from IP: ${clientIp}`);

  socket.roomId = roomId;
  socket.peerId = peerId;
  socket.clientIp = clientIp;

  // Get or create room
  let room = rooms.get(roomId);
  if (!room) {
    room = await createRoom(roomId);
    console.log(`Created new room: ${roomId}`);
  } else {
    console.log(`Joined existing room: ${roomId}`);
  }
  
  // Join the room
  socket.join(roomId);
  
  const peer = {
    id: peerId,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    socket,
    clientIp
  };
  
  // Add peer to room
  room.peers.set(peerId, peer);
  peers.set(socket.id, peer);
  console.log(`Peer ${peerId} added to room ${roomId}, total peers: ${room.peers.size}`);

  // Handle router RTP capabilities request immediately
  socket.on('getRouterRtpCapabilities', (data, callback) => {
    try {
      console.log(`Peer ${peerId} requesting router capabilities`);
      
      if (!room || !room.router) {
        throw new Error('Room or router not initialized');
      }
      const capabilities = room.router.rtpCapabilities;
      console.log('Sending router capabilities to peer', peerId);
      callback(capabilities);
    } catch (error) {
      console.error('Error getting router capabilities:', error);
      callback({ error: error.message });
    }
  });

  // Handle socket events
  socket.on('joinRoom', ({ userId, username, roomId }) => {
    console.log(`User ${username} (${userId}) joined room ${roomId}`);
    const user = {
      id: userId,
      name: username,
      isSpeaking: false
    };
    
    // Store user info
    users.set(userId, user);
    
    // Inform other users about the new user
    socket.to(roomId).emit('userJoined', user);
    
    // Send current users in the room to the new user
    const roomUsers = Array.from(users.values())
      .filter(user => room.peers.has(user.id));
    
    console.log(`Sending ${roomUsers.length} users to new user ${userId}`);
    socket.emit('users', roomUsers);
  });

  // Handle speaking status updates
  socket.on('speaking', ({ roomId, peerId, speaking }) => {
    console.log(`User ${peerId} speaking status: ${speaking}`);
    // Update user speaking status
    const user = users.get(peerId);
    if (user) {
      user.isSpeaking = speaking;
      users.set(peerId, user);
    }
    
    // Broadcast speaking status to all clients in the room
    socket.to(roomId).emit('userSpeaking', peerId, speaking);
  });

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    try {
      console.log(`Creating WebRTC transport for peer ${peerId}, sender: ${sender}`);
      const { transport, params } = await createWebRtcTransport(room.router, peer.clientIp);
      
      // Store transport
      const transportId = transport.id;
      peer.transports.set(transportId, transport);
      transports.set(transportId, transport);
      
      console.log(`Transport ${transportId} created for peer ${peerId}`);
      
      // Return transport parameters
      callback({
        transportId,
        params,
      });
    } catch (error) {
      console.error('Error creating transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('connectWebRtcTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      const transport = transports.get(transportId);
      
      if (!transport) {
        throw new Error(`Transport ${transportId} not found`);
      }
      
      await transport.connect({ dtlsParameters });
      callback({ success: true });
    } catch (error) {
      console.error('Error connecting transport:', error);
      callback({ error: error.message });
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      console.log(`Peer ${peerId} producing ${kind} on transport ${transportId}`);
      const transport = transports.get(transportId);
      
      if (!transport) {
        throw new Error(`Transport ${transportId} not found`);
      }
      
      const producer = await transport.produce({ kind, rtpParameters });
      
      // Store producer
      peer.producers.set(producer.id, producer);
      producers.set(producer.id, producer);
      
      console.log(`Producer ${producer.id} created by peer ${peerId} (${kind})`);
      
      // Inform other peers in the room
      socket.to(roomId).emit('newProducer', {
        peerId,
        producerId: producer.id,
        kind,
      });
      
      console.log(`Notified room ${roomId} about new producer ${producer.id} from peer ${peerId}`);
      
      // Return producer ID
      callback({ id: producer.id });
      
      // Start recording if it's audio
      if (kind === 'audio') {
        startRecording(room, producer, peerId);
      }
    } catch (error) {
      console.error('Error producing:', error);
      callback({ error: error.message });
    }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    try {
      console.log(`Peer ${peerId} wants to consume producer ${producerId}`);
      const producer = producers.get(producerId);
      
      if (!producer) {
        throw new Error(`Producer ${producerId} not found`);
      }
      
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error(`Router cannot consume producer ${producerId} with provided RTP capabilities`);
      }
      
      // Create consumer transport if necessary
      let consumerTransport;
      for (const [, transport] of peer.transports) {
        consumerTransport = transport;
        break;
      }
      
      if (!consumerTransport) {
        throw new Error('No transport available for consuming');
      }
      
      console.log(`Using transport ${consumerTransport.id} for consuming`);
      
      const consumer = await consumerTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });
      
      // Store consumer
      peer.consumers.set(consumer.id, consumer);
      consumers.set(consumer.id, consumer);
      
      console.log(`Consumer ${consumer.id} created for peer ${peerId} consuming producer ${producerId}`);
      
      // Return consumer parameters
      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error) {
      console.error('Error consuming:', error);
      callback({ error: error.message });
    }
  });

  socket.on('resumeConsumer', async ({ consumerId }, callback) => {
    try {
      console.log(`Resuming consumer ${consumerId} for peer ${peerId}`);
      const consumer = consumers.get(consumerId);
      
      if (!consumer) {
        throw new Error(`Consumer ${consumerId} not found`);
      }
      
      await consumer.resume();
      console.log(`Consumer ${consumerId} resumed successfully`);
      callback({ success: true });
    } catch (error) {
      console.error('Error resuming consumer:', error);
      callback({ error: error.message });
    }
  });

  socket.on('stopRecording', async ({ producerId }, callback) => {
    try {
      const recording = room.recordings.get(producerId);
      
      if (recording) {
        recording.stop();
        room.recordings.delete(producerId);
        callback({ success: true });
      } else {
        callback({ error: 'Recording not found' });
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      callback({ error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Peer disconnected:', peerId);
    
    // Clean up peer resources
    if (peer) {
      // Close transports
      for (const [, transport] of peer.transports) {
        transport.close();
      }
      
      // Inform other peers
      socket.to(roomId).emit('peerDisconnected', { peerId });
      socket.to(roomId).emit('userLeft', peerId);
      
      // Remove peer from room
      room.peers.delete(peerId);
      peers.delete(socket.id);
      
      // Remove user info
      users.delete(peerId);
      
      // Clean up room if empty
      if (room.peers.size === 0) {
        rooms.delete(roomId);
      }
    }
  });
});

// Start recording function
function startRecording(room, producer, peerId) {
  // This is a simple implementation. For production, consider a more robust approach
  const recordingPath = path.join(recordingsDir, `${room.id}_${peerId}_${Date.now()}.webm`);
  const fileStream = fs.createWriteStream(recordingPath);
  
  // Store recording info
  room.recordings.set(producer.id, {
    path: recordingPath,
    stream: fileStream,
    stop: () => {
      fileStream.end();
      console.log(`Recording saved: ${recordingPath}`);
    }
  });

  // In a real implementation, you would pipe the RTP stream to the file
  // This is a placeholder for demonstration
  console.log(`Started recording for ${peerId} in room ${room.id}`);
}

// Add API endpoints for status checks
app.get('/status', (req, res) => {
  const status = {
    server: 'running',
    rooms: Array.from(rooms.keys()),
    roomCount: rooms.size,
    peerCount: peers.size,
    workerCount: workers.length
  };
  
  res.json(status);
});

app.get('/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const roomData = {
    id: room.id,
    peerCount: room.peers.size,
    peers: Array.from(room.peers.keys()),
    recordingCount: room.recordings.size
  };
  
  res.json(roomData);
});

// Start server
async function start() {
  try {
    await createWorkers();
    
    const PORT = process.env.PORT || 5000;
    // Use 0.0.0.0 to listen on all network interfaces
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT} and listening on all interfaces`);
      console.log('MediaSoup server ready to accept connections');
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

start(); 