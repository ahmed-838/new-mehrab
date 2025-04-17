'use client';

interface UserAvatarProps {
  username: string;
  isSpeaking: boolean;
  isCurrentUser: boolean;
}

const UserAvatar: React.FC<UserAvatarProps> = ({ 
  username, 
  isSpeaking, 
  isCurrentUser 
}) => {
  // Get initials from username
  const initials = username
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
  
  // Generate a semi-random color based on username (unless it's the current user)
  const generateColor = () => {
    if (isCurrentUser) return ""; // Using primary color from CSS for current user
    
    // Fixed set of pleasant colors for avatars
    const colors = [
      "#8b5cf6", // Purple
      "#ec4899", // Pink
      "#f59e0b", // Amber
      "#06b6d4", // Cyan
      "#10b981", // Emerald
      "#6366f1", // Indigo
      "#ef4444", // Red
      "#3b82f6", // Blue
    ];
    
    // Use simple hash of username to pick a color
    const hash = username.split("").reduce(
      (acc, char) => char.charCodeAt(0) + acc, 0
    );
    
    return colors[hash % colors.length];
  };
  
  const avatarStyle = isCurrentUser 
    ? {} 
    : { backgroundColor: generateColor() };
  
  return (
    <div className="avatar-container">
      <div 
        className={`user-avatar ${isSpeaking ? 'speaking' : ''} ${
          isCurrentUser ? 'current-user' : ''
        }`}
        style={avatarStyle}
      >
        {isSpeaking && (
          <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></span>
        )}
        {initials}
      </div>
      
      {/* Sound wave animation effect when speaking */}
      {isSpeaking && (
        <div className="sound-waves">
          <span className="wave wave-1"></span>
          <span className="wave wave-2"></span>
          <span className="wave wave-3"></span>
          <span className="wave wave-4"></span>
        </div>
      )}
    </div>
  );
};

export default UserAvatar; 