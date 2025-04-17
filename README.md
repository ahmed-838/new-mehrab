# MediaSoup Voice Room

A real-time voice chat application with recording capabilities built using MediaSoup, featuring a modern and intuitive UI.

![Voice Room Screenshot](https://via.placeholder.com/800x450.png?text=Voice+Room+Screenshot)

## Features

- Real-time voice communication
- Voice recording functionality
- Multiple participants in a room
- Visual indicators for speaking users
- Modern, responsive UI with dark mode
- Random room generation
- Invite link sharing
- Persistent username storage
- User avatars with colorful identifiers

## Project Structure

This project consists of two main parts:

- **Backend**: Node.js server using Express, Socket.IO, and MediaSoup
- **Frontend**: Next.js application with React and TypeScript

## Prerequisites

- Node.js 16+ and npm
- A modern web browser that supports WebRTC

## Setup and Running

### Backend

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

The backend server will start on http://localhost:5000.

### Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file with:
   ```
   NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
   NEXT_PUBLIC_MEDIASOUP_VERSION=3.15.7
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

The frontend application will be available at http://localhost:3000.

### Run Both Together

For convenience, you can start both the frontend and backend together:

```bash
npm run dev
```

## Usage

1. Open the application in your browser
2. Enter a room ID (or use the "Generate random room" feature)
3. Enter your name (will be saved for future sessions)
4. Click "Join Voice Room"
5. Allow microphone access when prompted
6. Use the "Unmute/Mute" button to control your microphone
7. Share the room by clicking the "Invite" button
8. Your voice will be automatically recorded when you unmute

## UI Features

- **Dynamic User Avatars**: Each user gets a unique colored avatar with their initials
- **Speaking Indicators**: Green outline and dot indicator when users are speaking
- **Invite Sharing**: Quick copy of room invite URL
- **User Count**: Shows how many users are currently in the room
- **Loading State**: Visual feedback during connection
- **Error Handling**: Clear error messages when issues occur
- **Responsive Design**: Works well on mobile and desktop

## Configuration

### Backend

The backend server can be configured by modifying the following settings in `backend/index.js`:

- `mediasoupSettings`: MediaSoup configuration
- `PORT`: Server port (default: 5000)

### Frontend

Frontend configuration can be set through environment variables in `.env.local`:

- `NEXT_PUBLIC_SOCKET_URL`: URL of the backend server
- `NEXT_PUBLIC_MEDIASOUP_VERSION`: MediaSoup version for display purposes

## Implementation Details

- The application uses MediaSoup for WebRTC communication
- Socket.IO is used for signaling
- Voice recordings are saved on the server in WebM format
- The frontend uses React hooks for state management
- CSS variables for theming and consistent styling

## License

ISC 