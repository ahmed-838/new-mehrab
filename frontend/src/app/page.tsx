'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import VoiceRoom from './components/VoiceRoom';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Check for room ID in URL params
    const roomParam = searchParams.get('room');
    if (roomParam) {
      setRoomId(roomParam);
    }
    
    // Check for saved username
    const savedUsername = localStorage.getItem('voice-room-username');
    if (savedUsername) {
      setUsername(savedUsername);
    }
  }, [searchParams]);
  
  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!roomId.trim()) {
      setFormError('Please enter a room ID');
      return;
    }
    
    if (!username.trim()) {
      setFormError('Please enter your name');
      return;
    }
    
    // Save username for future use
    localStorage.setItem('voice-room-username', username);
    
    setFormError(null);
    setJoinedRoom(true);
  };
  
  const generateRandomRoomId = () => {
    const adjectives = ['happy', 'swift', 'clever', 'brave', 'mighty', 'gentle', 'wise', 'calm'];
    const nouns = ['tiger', 'ocean', 'mountain', 'river', 'forest', 'eagle', 'moon', 'star'];
    
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNum = Math.floor(Math.random() * 1000);
    
    const generatedRoomId = `${randomAdjective}-${randomNoun}-${randomNum}`;
    setRoomId(generatedRoomId);
  };
  
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 md:p-12">
      <div className="max-w-3xl w-full">
        <h1 className="page-title">Voice Room</h1>
        
        {!joinedRoom ? (
          <div className="join-card">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold mb-6">Join a Voice Room</h2>
              
              <div className="text-sm text-gray-400 flex flex-col items-end">
                <span>Real-time voice chat</span>
                <span>with MediaSoup</span>
              </div>
            </div>
            
            {formError && (
              <div className="error-message mb-6">
                <p className="text-red-500">{formError}</p>
              </div>
            )}
            
            <form onSubmit={handleJoinRoom} className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label htmlFor="roomId" className="block text-sm font-medium">
                    Room ID
                  </label>
                  <button 
                    type="button" 
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                    onClick={generateRandomRoomId}
                  >
                    Generate random room
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    id="roomId"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value.trim())}
                    className="input-field"
                    placeholder="Enter a room ID or create a new one"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="username" className="block text-sm font-medium mb-2">
                  Your Name
                </label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.trim())}
                  className="input-field"
                  placeholder="Enter your name"
                  required
                />
              </div>
              
              <button
                type="submit"
                className="button button-primary w-full py-3 mt-2"
              >
                Join Voice Room
              </button>
              
              <div className="pt-4 border-t border-gray-700 text-center text-sm text-gray-400">
                <p>By joining a room, you agree to our <a href="#" className="text-indigo-400 hover:underline">Terms of Service</a> and <a href="#" className="text-indigo-400 hover:underline">Privacy Policy</a>.</p>
              </div>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <button
                onClick={() => setJoinedRoom(false)}
                className="button button-outline"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"></path>
                </svg>
                Back to Lobby
              </button>
            </div>
            
            <VoiceRoom roomId={roomId} username={username} />
          </div>
        )}
      </div>
      
      <footer className="mt-12 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} MediaSoup Voice Room. All rights reserved.</p>
        <p className="mt-1">Using MediaSoup {process.env.NEXT_PUBLIC_MEDIASOUP_VERSION || '3.15.7'} for WebRTC communication.</p>
      </footer>
    </main>
  );
}
