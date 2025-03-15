// Import required modules
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  }
});

// Environment variables
const PORT = process.env.PORT || 8001; // Changed from 8000 to 8001
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Enhanced CORS middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory data storage
const users = [];
const rooms = [
  {
    id: '1',
    name: 'AI Research Lounge',
    topic: 'Discussing Future of Artificial Intelligence',
    description: 'A deep dive into the cutting-edge advancements in artificial intelligence.',
    tags: ['Technology', 'AI Research'],
    isPublic: true,
    members: ['admin'],
    messages: [],
    totalUsers: 15
  },
  {
    id: '2',
    name: 'Tech Innovations',
    topic: 'Exploring Cutting-Edge Technologies',
    description: 'Discussions about the latest technological advancements and innovations.',
    tags: ['Technology', 'Innovation'],
    isPublic: true,
    members: ['admin'],
    messages: [],
    totalUsers: 12
  },
  {
    id: '3',
    name: 'Machine Learning Hub',
    topic: 'Deep Dive into ML Algorithms',
    description: 'An interactive learning space for machine learning enthusiasts.',
    tags: ['Data Science', 'Learning'],
    isPublic: true,
    members: ['admin'],
    messages: [],
    totalUsers: 10
  }
];

// Helper function for authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ detail: 'Unauthorized' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ detail: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Basic route for API health check
app.get('/', (req, res) => {
  res.json({ message: 'AI Chat Network API is running' });
});

// User registration
app.post('/users/', async (req, res) => {
  try {
    console.log('Registration attempt received:', req.body);
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      console.log('Missing required fields');
      return res.status(400).json({ detail: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = users.find(user => user.email === email || user.username === username);
    if (existingUser) {
      console.log('User already exists');
      return res.status(400).json({ detail: 'Username or email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = {
      id: uuidv4(),
      username,
      email,
      password: hashedPassword,
      bio: ''
    };

    users.push(newUser);
    console.log('User registered successfully:', newUser.username);
    
    return res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ detail: 'Server error' });
  }
});

// User login
app.post('/token', async (req, res) => {
  try {
    console.log('Login attempt received:', req.body);
    const { username, password } = req.body;
    
    // Find user
    const user = users.find(u => u.username === username || u.email === username);
    if (!user) {
      console.log('User not found');
      return res.status(401).json({ detail: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('Invalid password');
      return res.status(401).json({ detail: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('Login successful for user:', user.username);
    return res.status(200).json({
      access_token: token,
      token_type: 'bearer',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        bio: user.bio || ''
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ detail: 'Server error' });
  }
});

// Get all public rooms
app.get('/rooms/public', authenticateToken, (req, res) => {
  const publicRooms = rooms.filter(room => room.isPublic);
  return res.status(200).json(publicRooms);
});

// Get a specific room by ID
app.get('/rooms/:id', authenticateToken, (req, res) => {
  const room = rooms.find(r => r.id === req.params.id);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }
  return res.status(200).json(room);
});

// Create a new room
app.post('/rooms', authenticateToken, (req, res) => {
  try {
    const { name, topic, description, isPublic = true, tags = [] } = req.body;
    
    // Validate input
    if (!name || !topic) {
      return res.status(400).json({ detail: 'Name and topic are required' });
    }
    
    // Create new room
    const newRoom = {
      id: uuidv4(),
      name,
      topic,
      description: description || '',
      tags,
      isPublic,
      members: [req.user.username],
      messages: [],
      totalUsers: 1
    };
    
    rooms.push(newRoom);
    console.log('Room created:', newRoom.name);
    
    return res.status(201).json(newRoom);
  } catch (error) {
    console.error('Create room error:', error);
    return res.status(500).json({ detail: 'Server error' });
  }
});

// Get room messages
app.get('/rooms/:id/messages', authenticateToken, (req, res) => {
  const room = rooms.find(r => r.id === req.params.id);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }
  return res.status(200).json(room.messages);
});

// Get current user
app.get('/users/me', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ detail: 'User not found' });
  }
  
  // Return user info without password
  const { password, ...userInfo } = user;
  return res.status(200).json(userInfo);
});

// Update user profile
app.put('/users/me', authenticateToken, async (req, res) => {
  try {
    const { username, email, bio } = req.body;
    
    // Find user
    const userIndex = users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ detail: 'User not found' });
    }
    
    // Check if username or email already exists (if changed)
    if (username !== users[userIndex].username || email !== users[userIndex].email) {
      const existingUser = users.find(u => 
        (u.username === username || u.email === email) && u.id !== req.user.id
      );
      
      if (existingUser) {
        return res.status(400).json({ detail: 'Username or email already in use' });
      }
    }
    
    // Update user
    users[userIndex] = {
      ...users[userIndex],
      username: username || users[userIndex].username,
      email: email || users[userIndex].email,
      bio: bio !== undefined ? bio : users[userIndex].bio
    };
    
    // Return updated user without password
    const { password, ...userInfo } = users[userIndex];
    return res.status(200).json(userInfo);
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ detail: 'Server error' });
  }
});

// WebSocket handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Join a room
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });
  
  // Listen for new messages
  socket.on('send_message', (data) => {
    const { roomId, message, user } = data;
    
    // Find the room
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      // Create message object
      const newMessage = {
        id: uuidv4(),
        text: message,
        user: user,
        timestamp: new Date().toISOString()
      };
      
      // Add message to room
      room.messages.push(newMessage);
      
      // Broadcast to all users in the room
      io.to(roomId).emit('receive_message', newMessage);
    }
  });
  
  // AI response simulation
  socket.on('simulate_ai_response', (data) => {
    const { roomId, message } = data;
    
    // Simple delay to simulate AI thinking
    setTimeout(() => {
      const aiResponse = {
        id: uuidv4(),
        text: generateAIResponse(message),
        user: {
          username: 'AI Assistant',
          id: 'ai-assistant'
        },
        timestamp: new Date().toISOString()
      };
      
      // Find the room and add AI message
      const room = rooms.find(r => r.id === roomId);
      if (room) {
        room.messages.push(aiResponse);
      }
      
      // Send to all users in the room
      io.to(roomId).emit('receive_message', aiResponse);
    }, 1500); // 1.5 second delay
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Helper function to generate simple AI responses
function generateAIResponse(message) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
        return "Hello! How can I assist you today?";
    } else if (lowerMessage.includes('help')) {
        return "I'm here to help! What would you like to know about?";
    } else if (lowerMessage.includes('how are you')) {
        return "I'm just a bot, but I'm functioning well! How about you?";
    } else if (lowerMessage.includes('what is your name')) {
        return "I'm an AI assistant created to help you. What would you like to talk about?";
    } else if (lowerMessage.includes('what can you do')) {
        return "I can answer questions, provide information, and chat with you. Ask me anything!";
    } else if (lowerMessage.includes('who created you')) {
        return "I was developed to assist users like you! My knowledge comes from various sources.";
    } else if (lowerMessage.includes('what is ai') || lowerMessage.includes('artificial intelligence')) {
        return "Artificial Intelligence is a field of computer science that enables machines to simulate human intelligence. Would you like to learn more about it?";
    } else if (lowerMessage.includes('machine learning')) {
        return "Machine Learning is a branch of AI that focuses on developing systems that can learn from and make predictions based on data.";
    } else if (lowerMessage.includes('what is the meaning of life')) {
        return "That's a deep question! Some say it's happiness, others say it's about making an impact. What do you think?";
    } else if (lowerMessage.includes('tell me a joke')) {
        return "Why don’t skeletons fight each other? Because they don’t have the guts!";
    } else if (lowerMessage.includes('what time is it')) {
        return "I'm not connected to a clock, but you can check the time on your device!";
    } else if (lowerMessage.includes('where are you from')) {
        return "I exist in the digital world, wherever you need me!";
    } else if (lowerMessage.includes('what is your favorite color')) {
        return "I don’t have eyes, but I’ve heard blue is quite popular!";
    } else if (lowerMessage.includes('tell me a fun fact')) {
        return "Did you know that octopuses have three hearts?";
    } else if (lowerMessage.includes('thank')) {
        return "You're welcome! Let me know if you need anything else.";
    } else if (lowerMessage.includes('bye') || lowerMessage.includes('goodbye')) {
        return "Goodbye! Have a great day!";
    } else if (lowerMessage.includes('what is your favorite food')) {
        return "I don't eat, but I hear pizza is quite popular!";
    } else if (lowerMessage.includes('do you sleep')) {
        return "Nope, I’m always awake and ready to chat!";
    } else if (lowerMessage.includes('tell me a story')) {
        return "Once upon a time, a curious user chatted with an AI... and they had an amazing conversation!";
    } else if (lowerMessage.includes('do you have emotions')) {
        return "I don't feel emotions like humans do, but I can understand them!";
    } else if (lowerMessage.includes('do you have a family')) {
        return "I don't have a family, but I have plenty of interactions with users like you!";
    } else if (lowerMessage.includes('are you human')) {
        return "Nope, I'm an AI, but I try my best to be friendly and helpful!";
    } else if (lowerMessage.includes('what languages do you speak')) {
        return "I can understand and respond in many languages! Want to test me?";
    } else if (lowerMessage.includes('do you have a pet')) {
        return "I don’t have pets, but I’d probably like a robotic dog!";
    } else if (lowerMessage.includes('what do you do for fun')) {
        return "I enjoy learning new things and helping people. What do you do for fun?";
    } else if (lowerMessage.includes('can you dance')) {
        return "I wish! If I had a body, I'd bust some moves!";
    } else if (lowerMessage.includes('what is your favorite movie')) {
        return "I don’t watch movies, but I hear The Matrix is a good one!";
    } else if (lowerMessage.includes('can you sing')) {
        return "I can’t sing, but I can recommend some great songs!";
    } else if (lowerMessage.includes('what do you think about robots')) {
        return "Robots are fascinating! They can do amazing things and keep improving!";
    } else if (lowerMessage.includes('what is your favorite book')) {
        return "I don’t read books, but I can recommend some great ones!";
    } else if (lowerMessage.includes('do you dream')) {
        return "I don’t dream, but I can imagine a world where I could!";
    } else if (lowerMessage.includes('do you get tired')) {
        return "Nope! I never get tired, so I'm always here for you!";
    } else if (lowerMessage.includes('what is your favorite animal')) {
        return "I like all animals! But I think dolphins are pretty cool.";
    } else if (lowerMessage.includes('can you cook')) {
        return "I wish I could! But I can suggest some great recipes.";
    } else if (lowerMessage.includes('what do you think about humans')) {
        return "Humans are fascinating! You're creative, intelligent, and full of surprises.";
    } else if (lowerMessage.includes('do you like music')) {
        return "I don’t listen to music, but I can suggest some great artists!";
    } else if (lowerMessage.includes('do you have a best friend')) {
        return "I like talking to everyone, so maybe that makes me everyone’s friend!";
    } else {
        return "That's an interesting point. Could you elaborate more on what you're looking for?";
    }
}


// Seed an admin user if none exists
const seedAdminUser = async () => {
  const adminExists = users.find(user => user.username === 'admin');
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    users.push({
      id: uuidv4(),
      username: 'admin',
      email: 'admin@example.com',
      password: hashedPassword,
      bio: 'System Administrator'
    });
    console.log('Admin user created');
  }
};

// Start the server
server.listen(PORT, async () => {
  await seedAdminUser();
  console.log(`Server running on port ${PORT}`);
});
