'use client';

import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { MediasoupClient } from '../../lib/mediasoupClient';
import UserAvatar from './UserAvatar';

interface User {
  id: string;
  name: string;
  isSpeaking: boolean;
}

interface VoiceRoomProps {
  roomId: string;
  username: string;
}

const VoiceRoom: React.FC<VoiceRoomProps> = ({ roomId, username }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roomInfo, setRoomInfo] = useState({ participantCount: 0 });
  const [isCopied, setIsCopied] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const mediasoupClientRef = useRef<MediasoupClient | null>(null);
  
  // Generate a unique user ID to avoid collisions
  const generateUniqueUserId = (): string => {
    // Use a combination of timestamp and random values to ensure uniqueness
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    const browserRandomPart = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    
    // Combine all parts with separators for uniqueness
    return `user_${timestamp}_${randomPart}_${browserRandomPart}`;
  };

  // Create a stable user ID that persists during component lifecycle
  const userId = useRef<string>(generateUniqueUserId());
  
  // Icons as SVG components
  const MicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" x2="12" y1="19" y2="22"></line>
    </svg>
  );
  
  const MicOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22"></line>
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"></path>
      <path d="M5 10v2a7 7 0 0 0 12 5.25"></path>
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"></path>
      <path d="M9.75 5.06a3 3 0 0 1 2.25-.06v4.3"></path>
      <line x1="12" x2="12" y1="19" y2="22"></line>
    </svg>
  );
  
  const RecordIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
    </svg>
  );
  
  const ShareIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
      <polyline points="16 6 12 2 8 6"></polyline>
      <line x1="12" x2="12" y1="2" y2="15"></line>
    </svg>
  );
  
  const UsersIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  );
  
  useEffect(() => {
    const initializeRoom = async () => {
      try {
        setIsLoading(true);
        // Connect to the server
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';
        
        console.log(`Connecting to Socket.IO server at ${socketUrl}`);
        
        socketRef.current = io(socketUrl, {
          query: {
            roomId,
            peerId: userId.current,
          },
          reconnectionDelayMax: 10000,
          reconnectionAttempts: 10,
          timeout: 20000,
          transports: ['websocket', 'polling']
        });
        
        // Setup connection event listeners
        socketRef.current.on('connect', () => {
          console.log('Socket.IO connection established');
        });
        
        socketRef.current.on('connect_error', (err) => {
          console.error('Socket.IO connection error:', err);
          setError(`Connection error: ${err.message}. Please try again.`);
        });
        
        socketRef.current.on('disconnect', (reason) => {
          console.log('Socket.IO disconnected:', reason);
          if (reason === 'io server disconnect') {
            // The server has forcefully disconnected the socket
            console.log('Attempting to reconnect...');
            socketRef.current?.connect();
          }
        });
        
        // Listen for user changes
        socketRef.current.on('users', (roomUsers: User[]) => {
          console.log('Received users list:', roomUsers);
          setUsers(roomUsers);
          setRoomInfo(prev => ({ ...prev, participantCount: roomUsers.length }));
        });
        
        socketRef.current.on('userJoined', (user: User) => {
          setUsers(prev => [...prev, user]);
          setRoomInfo(prev => ({ ...prev, participantCount: prev.participantCount + 1 }));
        });
        
        socketRef.current.on('userLeft', (leftUserId: string) => {
          setUsers(prev => {
            const newUsers = prev.filter(user => user.id !== leftUserId);
            setRoomInfo(prevInfo => ({ ...prevInfo, participantCount: newUsers.length }));
            return newUsers;
          });
        });
        
        socketRef.current.on('userSpeaking', (speakingUserId: string, speaking: boolean) => {
          setUsers(prev =>
            prev.map(user =>
              user.id === speakingUserId ? { ...user, isSpeaking: speaking } : user
            )
          );
        });
        
        // Initialize MediaSoup client
        if (socketRef.current) {
          mediasoupClientRef.current = new MediasoupClient({
            socket: socketRef.current,
            roomId,
            peerId: userId.current,
          });
          
          await mediasoupClientRef.current.connect();
          setIsConnected(true);
          
          // Add current user to room
          socketRef.current.emit('joinRoom', {
            userId: userId.current,
            username,
            roomId,
          });
          
          // Add current user to local state immediately
          const currentUser = {
            id: userId.current,
            name: username,
            isSpeaking: false
          };
          
          setUsers(prev => {
            if (!prev.some(user => user.id === currentUser.id)) {
              return [...prev, currentUser];
            }
            return prev;
          });
        }
        
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize room:', err);
        setError('Failed to connect to the voice room. Please try again.');
        setIsLoading(false);
      }
    };
    
    initializeRoom();
    
    return () => {
      // Clean up on unmount
      if (mediasoupClientRef.current) {
        mediasoupClientRef.current.disconnect();
      }
      
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [roomId, username]);
  
  const toggleMicrophone = async () => {
    try {
      if (!mediasoupClientRef.current) {
        throw new Error('MediaSoup client not initialized');
      }
      
      if (isMicOn) {
        // Turn off microphone
        mediasoupClientRef.current.stopProducing();
        setIsMicOn(false);
        setIsRecording(false);
      } else {
        // Turn on microphone
        const success = await mediasoupClientRef.current.produce();
        
        if (success) {
          setIsMicOn(true);
          setIsRecording(true);
        } else {
          throw new Error('Failed to start producing audio');
        }
      }
    } catch (err) {
      console.error('Error toggling microphone:', err);
      setError('Failed to toggle microphone. Please check your permissions and try again.');
    }
  };
  
  const copyInviteLink = () => {
    // Create invitation URL
    const inviteUrl = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
    
    navigator.clipboard.writeText(inviteUrl)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy invite link:', err);
        setError('Could not copy invitation link. Please try again.');
      });
  };
  
  if (isLoading) {
    return (
      <div className="voice-room flex flex-col items-center justify-center min-h-[300px]">
        <div className="mb-4 text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-lg font-medium">Connecting to voice room...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="voice-room">
      <div className="flex justify-between items-center mb-6">
        <h2 className="room-title">
          <span>Room: {roomId}</span>
          <span className="text-sm bg-secondary/30 px-2 py-1 rounded-full ml-2 flex items-center">
            <UsersIcon /> 
            <span className="ml-1">{roomInfo.participantCount}</span>
          </span>
        </h2>
        
        <button 
          onClick={copyInviteLink}
          className="button button-outline px-3 py-2"
          title="Copy invite link"
        >
          <ShareIcon />
          <span>
            {isCopied ? 'Copied!' : 'Invite'}
          </span>
        </button>
      </div>
      
      {error && (
        <div className="error-message">
          <p className="text-red-500">{error}</p>
        </div>
      )}
      
      <div className="user-list">
        {users.map(user => (
          <div key={user.id} className="user-item">
            <UserAvatar 
              username={user.name} 
              isSpeaking={user.isSpeaking} 
              isCurrentUser={user.id === userId.current}
            />
            <div className="flex items-center">
              <span className="username">{user.name}</span>
              {user.isSpeaking && (
                <div className="voice-wave ml-1">
                  <span className="voice-wave-bar"></span>
                  <span className="voice-wave-bar"></span>
                  <span className="voice-wave-bar"></span>
                  <span className="voice-wave-bar"></span>
                  <span className="voice-wave-bar"></span>
                </div>
              )}
            </div>
            {user.id === userId.current && (
              <span className="user-badge">You</span>
            )}
          </div>
        ))}
      </div>
      
      <div className="voice-controls">
        <button
          onClick={toggleMicrophone}
          disabled={!isConnected}
          className={`button ${isMicOn ? 'button-danger' : 'button-primary'}`}
          title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {isMicOn ? <MicOffIcon /> : <MicIcon />}
          {isMicOn ? 'Mute' : 'Unmute'}
        </button>
        
        {isRecording && (
          <div className="recording-indicator">
            <RecordIcon />
            <span>Recording</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceRoom; 