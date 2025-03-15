// Base API URL for backend services
const API_URL = 'http://83.229.69.167:8001';

// WebSocket connection URL
const WS_BASE_URL = 'ws://83.229.69.167:8001/ws';

// Global variables
let currentUser = null;
let isAdmin = false;
let isOwner = false;
let isHost = false;
let currentRoom = null;
let selectedUser = null;
let socket = null;
let typingTimeout = null;
let activeWhispers = {};

// Role Icons
const ROLE_ICONS = {
    admin: '👑', // Crown for admins
    owner: '⭐', // Star for owners
    host: '🛡️', // Shield for hosts
    ai: '🤖'    // Robot for AI
};

// Check authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Chat room page loaded, checking authentication...');
    
    // Initialize sidebar resizer
    initSidebarResizer();
    
    // Initialize movable whisper window
    initMovableWhisper();
    
    // Check if user is logged in
    const token = localStorage.getItem('token');
    if (!token) {
        console.log('No token found, redirecting to login...');
        // Set flag for redirecting from protected page
        localStorage.setItem('from_protected_page', 'chat');
        // Redirect to login page if not logged in
        window.location.href = 'login.html';
        return;
    }
    
    try {
        console.log('Validating token with API...');
        // Validate token
        const response = await fetch(`${API_URL}/users/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Invalid token');
        }
        
        // Get user data
        const userData = await response.json();
        console.log('User data retrieved:', userData);
        
        // Store user data
        currentUser = userData;
        
        // Check if user is admin (hardcoded for demo - in real app would come from API)
        isAdmin = userData.username === 'admin';
        
        // Update UI with user data
        updateUserInfo(userData);
        
        // Initialize WebSocket connection
        initWebSocket();
        
        // Load rooms
        loadRooms();
        
    } catch (error) {
        console.error('Authentication error:', error);
        // Set flag for redirecting from protected page
        localStorage.setItem('from_protected_page', 'chat');
        // Redirect to login page
        localStorage.removeItem('token');
        window.location.href = 'login.html';
    }
});

// Initialize WebSocket connection
function initWebSocket() {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    // Update connection status
    updateConnectionStatus('connecting');
    
    // Create WebSocket connection
    socket = new WebSocket(`${WS_BASE_URL}?token=${token}`);
    
    // Connection opened
    socket.addEventListener('open', (event) => {
        console.log('WebSocket connection established');
        updateConnectionStatus('connected');
    });
    
    // Listen for messages
    socket.addEventListener('message', (event) => {
        console.log('Message from server:', event.data);
        handleWebSocketMessage(event.data);
    });
    
    // Connection closed
    socket.addEventListener('close', (event) => {
        console.log('WebSocket connection closed');
        updateConnectionStatus('disconnected');
        
        // Try to reconnect after a delay
        setTimeout(() => {
            if (currentUser) {
                console.log('Attempting to reconnect WebSocket...');
                initWebSocket();
            }
        }, 5000);
    });
    
    // Connection error
    socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
    });
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    try {
        const message = JSON.parse(data);
        
        // Handle different message types
        switch (message.type) {
            case 'chat_message':
                handleChatMessage(message.data);
                break;
            case 'whisper_message':
                handleWhisperMessage(message.data);
                break;
            case 'user_joined':
                handleUserJoined(message.data);
                break;
            case 'user_left':
                handleUserLeft(message.data);
                break;
            case 'typing_indicator':
                handleTypingIndicator(message.data);
                break;
            case 'room_update':
                handleRoomUpdate(message.data);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
}

// Update connection status indicator
function updateConnectionStatus(status) {
    const statusIndicator = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-text');
    
    statusIndicator.className = `connection-status ${status}`;
    
    switch (status) {
        case 'connected':
            statusText.textContent = 'Connected';
            break;
        case 'disconnected':
            statusText.textContent = 'Disconnected';
            break;
        case 'connecting':
            statusText.textContent = 'Connecting...';
            break;
    }
}

// Handle chat message from WebSocket
function handleChatMessage(messageData) {
    // Only process if we're in the correct room
    if (currentRoom && messageData.roomId === currentRoom.id) {
        addMessageToChat(messageData);
    }
}

// Handle whisper message from WebSocket
function handleWhisperMessage(messageData) {
    // Check if whisper is from/to current user
    if (messageData.fromUser.id === currentUser.id || messageData.toUser.id === currentUser.id) {
        // Get the other user (the one who is not the current user)
        const otherUser = messageData.fromUser.id === currentUser.id ? messageData.toUser : messageData.fromUser;
        
        // Check if whisper window is already open
        const whisperWindow = document.getElementById('whisper-window');
        const isCurrentWhisper = whisperWindow.style.display === 'block' && 
                               whisperWindow.getAttribute('data-user-id') === otherUser.id;
        
        if (!isCurrentWhisper) {
            // Store message in active whispers for later
            if (!activeWhispers[otherUser.id]) {
                activeWhispers[otherUser.id] = [];
            }
            activeWhispers[otherUser.id].push(messageData);
            
            // Notify user of new whisper if not already viewing it
            // In a real app, you'd add a notification here
            console.log(`New whisper from ${otherUser.username}`);
        } else {
            // Add message to whisper window
            addMessageToWhisper(messageData);
        }
    }
}

// Handle user joined notification
function handleUserJoined(userData) {
    // Only process if we're in the correct room
    if (currentRoom && userData.roomId === currentRoom.id) {
        // Check if user is already in the members list
        const existingMember = document.querySelector(`.member-item[data-id="${userData.user.id}"]`);
        if (!existingMember) {
            // Add user to members list
            const membersContainer = document.getElementById('members-container');
            const memberItem = createMemberItem(userData.user);
            membersContainer.appendChild(memberItem);
            
            // Update members count
            updateMembersCount();
            
            // Add system message to chat
            const systemMessage = {
                id: Date.now().toString(),
                text: `${userData.user.username} has joined the room.`,
                isSystem: true,
                timestamp: new Date().toISOString()
            };
            addSystemMessageToChat(systemMessage);
        }
    }
}

// Handle user left notification
function handleUserLeft(userData) {
    // Only process if we're in the correct room
    if (currentRoom && userData.roomId === currentRoom.id) {
        // Remove user from members list
        const memberItem = document.querySelector(`.member-item[data-id="${userData.user.id}"]`);
        if (memberItem) {
            memberItem.remove();
            
            // Update members count
            updateMembersCount();
            
            // Add system message to chat
            const systemMessage = {
                id: Date.now().toString(),
                text: `${userData.user.username} has left the room.`,
                isSystem: true,
                timestamp: new Date().toISOString()
            };
            addSystemMessageToChat(systemMessage);
        }
    }
}

// Handle typing indicator
function handleTypingIndicator(data) {
    // Only process if we're in the correct room
    if (currentRoom && data.roomId === currentRoom.id && data.userId !== currentUser.id) {
        const typingIndicator = document.getElementById('typing-indicator');
        
        if (data.isTyping) {
            // Show typing indicator with username
            typingIndicator.textContent = `${data.username} is typing`;
            typingIndicator.style.display = 'block';
            
            // Hide after a timeout if no more typing updates
            clearTimeout(window.typingTimeout);
            window.typingTimeout = setTimeout(() => {
                typingIndicator.style.display = 'none';
            }, 3000);
        } else {
            // Hide typing indicator
            typingIndicator.style.display = 'none';
        }
    }
}

// Handle room update
function handleRoomUpdate(roomData) {
    // Update current room if we're in it
    if (currentRoom && roomData.id === currentRoom.id) {
        currentRoom = roomData;
        
        // Update room info in UI
        document.getElementById('current-room-name').textContent = roomData.name;
        document.getElementById('current-room-topic').textContent = roomData.topic;
    }
    
    // Update room card if available
    const roomCard = document.querySelector(`.room-card[data-id="${roomData.id}"]`);
    if (roomCard) {
        const nameEl = roomCard.querySelector('.room-card-name');
        const topicEl = roomCard.querySelector('.room-card-topic');
        
        if (nameEl) nameEl.textContent = roomData.name;
        if (topicEl) topicEl.textContent = roomData.topic;
    }
}

// Initialize sidebar resizer
function initSidebarResizer() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    
    let isResizing = false;
    let lastX = 0;
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        lastX = e.clientX;
        document.body.style.cursor = 'ew-resize';
        
        // Add event listeners for mouse movement and release
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Prevent text selection during resize
        e.preventDefault();
    });
    
    function handleMouseMove(e) {
        if (!isResizing) return;
        
        const deltaX = e.clientX - lastX;
        const newWidth = Math.max(80, Math.min(500, sidebar.offsetWidth + deltaX));
        
        sidebar.style.width = newWidth + 'px';
        lastX = e.clientX;
    }
    
    function handleMouseUp() {
        isResizing = false;
        document.body.style.cursor = 'default';
        
        // Remove event listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }
    
    // Toggle sidebar collapse
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('sidebar-collapsed');
        
        // Update toggle button icon
        if (sidebar.classList.contains('sidebar-collapsed')) {
            sidebarToggle.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            `;
        } else {
            sidebarToggle.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            `;
        }
    });
}

// Initialize movable whisper window
function initMovableWhisper() {
    const whisperWindow = document.getElementById('whisper-window');
    const whisperHeader = document.getElementById('whisper-header');
    
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    
    whisperHeader.addEventListener('mousedown', (e) => {
        isDragging = true;
        
        // Calculate offset from the whisper window top-left corner
        const rect = whisperWindow.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        // Set initial cursor and prevent text selection
        whisperWindow.style.cursor = 'move';
        e.preventDefault();
        
        // Add event listeners for mouse movement and release
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    });
    
    function handleMouseMove(e) {
        if (!isDragging) return;
        
        // Calculate new position ensuring the window stays within viewport
        const newLeft = Math.max(0, Math.min(window.innerWidth - whisperWindow.offsetWidth, e.clientX - offsetX));
        const newTop = Math.max(0, Math.min(window.innerHeight - whisperWindow.offsetHeight, e.clientY - offsetY));
        
        // Update position using absolute positioning
        whisperWindow.style.position = 'fixed';
        whisperWindow.style.left = newLeft + 'px';
        whisperWindow.style.top = newTop + 'px';
        whisperWindow.style.right = 'auto';
        whisperWindow.style.bottom = 'auto';
    }
    
    function handleMouseUp() {
        isDragging = false;
        whisperWindow.style.cursor = 'default';
        
        // Remove event listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }
}

// Update user info in the UI
function updateUserInfo(user) {
    console.log('Updating user info in UI');
    // Save user data
    localStorage.setItem('user', JSON.stringify(user));
    
    // Update sidebar
    const userAvatarSidebar = document.getElementById('user-avatar-sidebar');
    const userNameSidebar = document.getElementById('user-name-sidebar');
    
    userAvatarSidebar.textContent = user.username.substring(0, 2).toUpperCase();
    userNameSidebar.textContent = user.username;
}

// Update members count
function updateMembersCount() {
    const membersContainer = document.getElementById('members-container');
    const count = membersContainer.querySelectorAll('.member-item').length;
    document.getElementById('members-count').textContent = count;
}

// Load rooms from API
async function loadRooms() {
    try {
        console.log('Loading rooms from API...');
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/rooms/public`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch rooms');
        }
        
        const rooms = await response.json();
        console.log('Rooms loaded:', rooms);
        displayRooms(rooms);
        
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}

// Display rooms in the UI
function displayRooms(rooms) {
    console.log('Displaying rooms in UI');
    const roomsGrid = document.getElementById('rooms-grid');
    roomsGrid.innerHTML = '';
    
    if (rooms.length === 0) {
        roomsGrid.innerHTML = '<p>No rooms found. Create one to get started!</p>';
        return;
    }
    
    rooms.forEach(room => {
        const roomCard = document.createElement('div');
        roomCard.className = 'room-card';
        roomCard.setAttribute('data-id', room.id);
        
        roomCard.innerHTML = `
            <div class="room-card-header">
                <div class="room-card-name">${room.name}</div>
                <div class="room-card-badge">AI-Powered</div>
            </div>
            <div class="room-card-topic">${room.topic}</div>
            <div class="room-card-footer">
                <div>${room.totalUsers} members</div>
                <div>${room.isPublic ? 'Public' : 'Private'}</div>
            </div>
        `;
        
        roomCard.addEventListener('click', () => joinRoom(room.id));
        roomsGrid.appendChild(roomCard);
    });
}

// Join a room
async function joinRoom(roomId) {
    console.log('Joining room:', roomId);
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/rooms/${roomId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to join room');
        }
        
        const room = await response.json();
        console.log('Room data:', room);
        
        // Store current room
        currentRoom = room;
        
        // Update UI to show chat window
        document.getElementById('rooms-section').style.display = 'none';
        document.getElementById('chat-window').style.display = 'flex';
        
        // Update room info
        document.getElementById('current-room-name').textContent = room.name;
        document.getElementById('current-room-topic').textContent = room.topic;
        
        // Store current room ID
        localStorage.setItem('currentRoomId', roomId);
        
        // Send join room message to WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'join_room',
                data: {
                    roomId: roomId
                }
            }));
        }
        
        // Check if current user is owner
        if (room.members && room.members.length > 0) {
            isOwner = room.members[0] === currentUser.username;
        }
        
        // Check if current user is host (would come from API in real app)
        isHost = false; // Reset host status
        
        // Load room members
        loadRoomMembers(room);
        
        // Load messages
        loadMessages(roomId);
        
    } catch (error) {
        console.error('Error joining room:', error);
    }
}

// Load room members
function loadRoomMembers(room) {
    console.log('Loading room members');
    
    // Get real members from the room data
    const roomMembers = [];
    
    // Add AI assistant (always present)
    roomMembers.push({ 
        id: 'ai-assistant', 
        username: 'System Operator - AI', 
        role: 'ai' 
    });
    
    // Add current user if admin
    if (currentUser && isAdmin) {
        roomMembers.push({
            id: currentUser.id,
            username: currentUser.username,
            role: 'admin'
        });
    }
    
    // Add room owner (the creator)
    if (room.members && room.members.length > 0) {
        const ownerUsername = room.members[0];
        if (ownerUsername === currentUser.username && !isAdmin) {
            // Current user is the owner but not an admin
            roomMembers.push({
                id: currentUser.id,
                username: currentUser.username,
                role: 'owner'
            });
        } else if (ownerUsername !== currentUser.username) {
            // Someone else is the owner
            roomMembers.push({
                id: `owner-${ownerUsername}`,
                username: ownerUsername,
                role: 'owner'
            });
        }
    }
    
    // Add other real members
    if (room.members) {
        room.members.forEach(memberUsername => {
            // Skip if already added as admin or owner
            if (!roomMembers.some(m => m.username === memberUsername)) {
                // In a real app, we would have a way to know if a user is a host
                // For demo, let's pretend some users are hosts
                const isUserHost = memberUsername.includes('host');
                
                roomMembers.push({
                    id: `member-${memberUsername}`,
                    username: memberUsername,
                    role: isUserHost ? 'host' : 'user'
                });
            }
        });
    }
    
    // Add current user if not already in the list
    if (currentUser && !roomMembers.some(m => m.username === currentUser.username)) {
        roomMembers.push({
            id: currentUser.id,
            username: currentUser.username,
            role: 'user'
        });
    }
    
    // Update members count
    document.getElementById('members-count').textContent = roomMembers.length;
    
    // Sort members: AI first, then by role importance, then alphabetically
    roomMembers.sort((a, b) => {
        // AI always comes first
        if (a.role === 'ai') return -1;
        if (b.role === 'ai') return 1;
        
        // Then sort by role importance
        const roleOrder = { admin: 1, owner: 2, host: 3, user: 4 };
        const roleCompare = roleOrder[a.role] - roleOrder[b.role];
        if (roleCompare !== 0) return roleCompare;
        
        // Finally sort alphabetically
        return a.username.localeCompare(b.username);
    });
    
    // Clear existing members
    const membersContainer = document.getElementById('members-container');
    membersContainer.innerHTML = '';
    
    // Add all members
    roomMembers.forEach(member => {
        const memberItem = createMemberItem(member);
        membersContainer.appendChild(memberItem);
    });
    
    // Populate member selection in settings
    populateMemberSelections(roomMembers);
}

// Populate member selection dropdowns
function populateMemberSelections(members) {
    const transferSelect = document.getElementById('transfer-ownership');
    const promoteSelect = document.getElementById('promote-host');
    
    // Clear existing options
    transferSelect.innerHTML = '<option value="">Select a user...</option>';
    promoteSelect.innerHTML = '<option value="">Select a user...</option>';
    
    // Add regular members to the selection (not AI, admin, or owner)
    members.forEach(member => {
        if (member.role !== 'ai' && member.role !== 'admin' && member.role !== 'owner') {
            // For ownership transfer
            const transferOption = document.createElement('option');
            transferOption.value = member.id;
            transferOption.textContent = member.username;
            transferSelect.appendChild(transferOption);
            
            // For host promotion (if not already a host)
            if (member.role !== 'host') {
                const promoteOption = document.createElement('option');
                promoteOption.value = member.id;
                promoteOption.textContent = member.username;
                promoteSelect.appendChild(promoteOption);
            }
        }
    });
    
    // Show/hide owner actions based on user role
    document.getElementById('owner-actions').style.display = (isOwner || isAdmin) ? 'block' : 'none';
}

// Create member item element
function createMemberItem(member) {
    const memberItem = document.createElement('div');
    memberItem.className = 'member-item';
    memberItem.setAttribute('data-id', member.id);
    memberItem.setAttribute('data-username', member.username);
    memberItem.setAttribute('data-role', member.role);
    
    // Generate initials or use role icon for avatar
    let avatarContent = member.username.substring(0, 2).toUpperCase();
    if (member.role === 'ai') {
        avatarContent = '🤖';
    }
    
    // Get role icon
    const roleIcon = ROLE_ICONS[member.role] || '';
    
    memberItem.innerHTML = `
        <div class="member-avatar" style="${member.role === 'ai' ? 'background: linear-gradient(135deg, var(--accent-green), #10b981);' : ''}">${avatarContent}</div>
        <div class="member-info">
            <div class="member-name">
                ${roleIcon ? `<span class="role-icon role-${member.role}">${roleIcon}</span>` : ''}
                ${member.username}
            </div>
        </div>
    `;
    
    // Add context menu event listener
    memberItem.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showUserContextMenu(e, member);
    });
    
    // Regular click to show user profile or info
    memberItem.addEventListener('click', () => {
        alert(`User Profile: ${member.username}`);
    });
    
    return memberItem;
}

// Show user context menu
function showUserContextMenu(event, user) {
    event.preventDefault();
    
    selectedUser = user;
    
    // Position the context menu
    const contextMenu = document.getElementById('user-context-menu');
    contextMenu.style.top = `${event.pageY}px`;
    contextMenu.style.left = `${event.pageX}px`;
    contextMenu.style.display = 'block';
    
    // Show/hide options based on roles
    const userOptions = document.querySelectorAll('.user-option');
    const hostOptions = document.querySelectorAll('.host-option');
    const ownerOptions = document.querySelectorAll('.owner-option');
    const adminOptions = document.querySelectorAll('.admin-option');
    
    // All users can see user options
    userOptions.forEach(option => {
        option.style.display = 'flex';
    });
    
    // Hosts and above can see host options
    hostOptions.forEach(option => {
        option.style.display = (isHost || isOwner || isAdmin) ? 'flex' : 'none';
    });
    
    // Only owners and admins can see owner options
    ownerOptions.forEach(option => {
        option.style.display = (isOwner || isAdmin) ? 'flex' : 'none';
    });
    
    // Only admins can see admin options
    adminOptions.forEach(option => {
        option.style.display = isAdmin ? 'flex' : 'none';
    });
    
    // Customize menu items based on user role
    if (user.role === 'ai') {
        // Hide options that don't apply to AI
        document.getElementById('context-whisper').style.display = 'none';
        document.getElementById('context-mute').style.display = 'none';
        document.getElementById('context-block').style.display = 'none';
        
        // No actions can be taken against AI
        hostOptions.forEach(option => option.style.display = 'none');
        ownerOptions.forEach(option => option.style.display = 'none');
        adminOptions.forEach(option => option.style.display = 'none');
    } else if (user.role === 'admin') {
        // Admins can't be moderated by anyone
        hostOptions.forEach(option => option.style.display = 'none');
        ownerOptions.forEach(option => option.style.display = 'none');
        adminOptions.forEach(option => option.style.display = 'none');
    } else if (user.role === 'owner' && !isAdmin) {
        // Owners can't be moderated (except by admins)
        hostOptions.forEach(option => option.style.display = 'none');
        ownerOptions.forEach(option => option.style.display = 'none');
    }
    
    // Close menu when clicking outside
    document.addEventListener('click', closeContextMenu);
}

// Close context menu
function closeContextMenu() {
    document.getElementById('user-context-menu').style.display = 'none';
    document.removeEventListener('click', closeContextMenu);
}

// Load messages for a room
async function loadMessages(roomId) {
    console.log('Loading messages for room:', roomId);
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/rooms/${roomId}/messages`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load messages');
        }
        
        const messages = await response.json();
        console.log('Messages loaded:', messages);
        displayMessages(messages);
        
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

// Display messages in the chat window
function displayMessages(messages) {
    console.log('Displaying messages in chat window');
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';
    
    if (messages.length === 0) {
        // Show welcome message
        const welcomeMessage = {
            user: {
                id: 'ai-assistant',
                username: 'AI Assistant'
            },
            text: 'Welcome to this chat room! I\'m your AI assistant. How can I help you today?',
            timestamp: new Date().toISOString()
        };
        
        messages.push(welcomeMessage);
    }
    
    // Get current user
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    
    messages.forEach(message => {
        addMessageToChat(message);
    });
}

// Add a message to the chat
function addMessageToChat(message) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    
    // All messages have the same base class - no separate alignment
    messageEl.className = 'message';
    
    // Add additional class for AI
    if (message.user && message.user.id === 'ai-assistant') {
        messageEl.classList.add('ai');
    }
    
    // Format time
    const timestamp = new Date(message.timestamp);
    const formattedTime = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Determine role icon
    let roleIcon = '';
    if (message.user) {
        if (message.user.id === 'ai-assistant') {
            roleIcon = `<span class="role-icon role-ai">${ROLE_ICONS.ai}</span>`;
        } else if (message.user.id === 'admin-1' || message.user.username === 'admin') {
            roleIcon = `<span class="role-icon role-admin">${ROLE_ICONS.admin}</span>`;
        } else if (message.user.isOwner || (currentRoom && currentRoom.members && currentRoom.members[0] === message.user.username)) {
            roleIcon = `<span class="role-icon role-owner">${ROLE_ICONS.owner}</span>`;
        } else if (message.user.isHost) {
            roleIcon = `<span class="role-icon role-host">${ROLE_ICONS.host}</span>`;
        }
    }
    
    messageEl.innerHTML = `
        <div class="message-avatar">${message.user ? message.user.username.substring(0, 2).toUpperCase() : 'SY'}</div>
        <div class="message-content">
            <div class="message-meta">
                <span class="message-author">${roleIcon}${message.user ? message.user.username : 'System'}</span>
                <span class="message-time">${formattedTime}</span>
            </div>
            <div class="message-text">${message.text}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add a system message to chat
function addSystemMessageToChat(message) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message system-message';
    
    // Format time
    const timestamp = new Date(message.timestamp);
    const formattedTime = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageEl.innerHTML = `
        <div class="message-avatar" style="background: linear-gradient(135deg, var(--accent-yellow), var(--accent-red));">SY</div>
        <div class="message-content">
            <div class="message-meta">
                <span class="message-author">System</span>
                <span class="message-time">${formattedTime}</span>
            </div>
            <div class="message-text">${message.text}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add message to whisper
function addMessageToWhisper(message) {
    const whisperMessages = document.getElementById('whisper-messages');
    const messageDiv = document.createElement('div');
    messageDiv.style.marginBottom = '10px';
    
    // Determine if message is from current user or the other user
    const isFromCurrentUser = message.fromUser.id === currentUser.id;
    const username = isFromCurrentUser ? 'You' : message.fromUser.username;
    const color = isFromCurrentUser ? 'var(--accent-blue)' : 'var(--accent-purple)';
    
    messageDiv.innerHTML = `
        <div style="font-weight: 600; color: ${color};">${username}:</div>
        <div>${message.text}</div>
    `;
    
    whisperMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    whisperMessages.scrollTop = whisperMessages.scrollHeight;
}

// Send message
async function sendMessage() {
    console.log('Sending message...');
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    const roomId = localStorage.getItem('currentRoomId');
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    console.log('User data for message:', userData);
    
    // Create message object
    const messageObj = {
        id: Date.now().toString(),
        text: message,
        user: {
            id: userData.id,
            username: userData.username,
            isOwner: isOwner,
            isHost: isHost
        },
        timestamp: new Date().toISOString(),
        roomId: roomId
    };
    
    // Clear input
    messageInput.value = '';
    
    // Add message to UI immediately
    addMessageToChat(messageObj);
    
    try {
        // Send message via WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'chat_message',
                data: messageObj
            }));
            
            // For demo purposes, simulate AI response
            simulateAIResponse(roomId, message);
        } else {
            console.error('WebSocket not connected, message not sent');
            
            // For demo, still simulate AI response
            simulateAIResponse(roomId, message);
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

// Generate AI response
function simulateAIResponse(roomId, message) {
    console.log('Simulating AI response to:', message);
    // Simple delay to simulate AI processing
    setTimeout(() => {
        const aiResponse = generateAIResponse(message);
        
        const aiMessageObj = {
            id: Date.now().toString(),
            text: aiResponse,
            user: {
                id: 'ai-assistant',
                username: 'AI Assistant'
            },
            timestamp: new Date().toISOString(),
            roomId: roomId
        };
        
        // Add AI message to chat
        addMessageToChat(aiMessageObj);
        
        // In a real app, the AI message would come from the server via WebSocket
        // Here we're just simulating it locally
    }, 1000);
}

// Generate AI response based on user message
function generateAIResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
        return "Hello! How can I assist you today?";
    } else if (lowerMessage.includes('help')) {
        return "I'm here to help! What would you like to know about?";
    } else if (lowerMessage.includes('ai') || lowerMessage.includes('artificial intelligence')) {
        return "Artificial Intelligence is a fascinating field! Would you like to discuss a specific aspect of AI?";
    } else if (lowerMessage.includes('machine learning')) {
        return "Machine Learning is a subset of AI focused on building systems that learn from data. Are you interested in algorithms, applications, or something else?";
    } else if (lowerMessage.includes('thank')) {
        return "You're welcome! Let me know if you need anything else.";
    } else {
        return "That's an interesting point. Could you elaborate more on what you're looking for?";
    }
}

// Open whisper window
function openWhisperWindow(user) {
    if (!user) return;
    
    const whisperWindow = document.getElementById('whisper-window');
    const whisperRecipient = document.getElementById('whisper-recipient');
    const whisperMessages = document.getElementById('whisper-messages');
    
    // Set recipient
    whisperRecipient.textContent = user.username;
    
    // Clear previous messages
    whisperMessages.innerHTML = '';
    
    // Load existing whispers if any
    if (activeWhispers[user.id] && activeWhispers[user.id].length > 0) {
        activeWhispers[user.id].forEach(message => {
            addMessageToWhisper(message);
        });
    } else {
        // Show welcome message
        const welcomeDiv = document.createElement('div');
        welcomeDiv.style.color = 'var(--text-secondary)';
        welcomeDiv.style.textAlign = 'center';
        welcomeDiv.style.padding = '10px';
        welcomeDiv.textContent = `Private conversation with ${user.username}`;
        whisperMessages.appendChild(welcomeDiv);
    }
    
    // Show the window
    whisperWindow.style.display = 'block';
    
    // Reset position if it was moved previously
    whisperWindow.style.bottom = '20px';
    whisperWindow.style.right = '20px';
    whisperWindow.style.left = 'auto';
    whisperWindow.style.top = 'auto';
    
    // Store active user
    whisperWindow.setAttribute('data-user-id', user.id);
    
    // Focus the input
    document.getElementById('whisper-input').focus();
}

// Send whisper message
function sendWhisperMessage() {
    const whisperInput = document.getElementById('whisper-input');
    const whisperMessages = document.getElementById('whisper-messages');
    const message = whisperInput.value.trim();
    const userId = document.getElementById('whisper-window').getAttribute('data-user-id');
    
    if (!message || !userId) return;
    
    // Clear input
    whisperInput.value = '';
    
    // Create whisper message object
    const whisperObj = {
        id: Date.now().toString(),
        text: message,
        fromUser: {
            id: currentUser.id,
            username: currentUser.username
        },
        toUser: {
            id: userId,
            username: selectedUser.username
        },
        timestamp: new Date().toISOString()
    };
    
    // Store in active whispers
    if (!activeWhispers[userId]) {
        activeWhispers[userId] = [];
    }
    activeWhispers[userId].push(whisperObj);
    
    // Add to UI
    addMessageToWhisper(whisperObj);
    
    // Send via WebSocket
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'whisper_message',
            data: whisperObj
        }));
    }
    
    // Simulate response (for demo)
    setTimeout(() => {
        const responseObj = {
            id: Date.now().toString(),
            text: "This is a simulated response to your private message.",
            fromUser: {
                id: userId,
                username: selectedUser.username
            },
            toUser: {
                id: currentUser.id,
                username: currentUser.username
            },
            timestamp: new Date().toISOString()
        };
        
        // Store in active whispers
        activeWhispers[userId].push(responseObj);
        
        // Add to UI
        addMessageToWhisper(responseObj);
    }, 1500);
}

// Handle typing indicator
const messageInput = document.getElementById('message-input');
let typingTimer;

messageInput.addEventListener('input', () => {
    // Only send if in a room
    if (!currentRoom) return;
    
    // Send typing indicator
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'typing_indicator',
            data: {
                roomId: currentRoom.id,
                userId: currentUser.id,
                username: currentUser.username,
                isTyping: true
            }
        }));
    }
    
    // Clear previous timer
    clearTimeout(typingTimer);
    
    // Set timer to send stopped typing after 2 seconds of inactivity
    typingTimer = setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'typing_indicator',
                data: {
                    roomId: currentRoom.id,
                    userId: currentUser.id,
                    username: currentUser.username,
                    isTyping: false
                }
            }));
        }
    }, 2000);
});

// Leave room
function leaveRoom() {
    console.log('Leaving room');
    
    // Send leave room message to WebSocket
    if (socket && socket.readyState === WebSocket.OPEN && currentRoom) {
        socket.send(JSON.stringify({
            type: 'leave_room',
            data: {
                roomId: currentRoom.id
            }
        }));
    }
    
    // Hide chat window and show rooms section
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('rooms-section').style.display = 'block';
    
    // Clear current room ID
    localStorage.removeItem('currentRoomId');
    currentRoom = null;
    isOwner = false;
    isHost = false;
}

// Show room settings
function showRoomSettings() {
    if (!currentRoom) return;
    
    console.log('Showing room settings for:', currentRoom);
    
    // Populate form with current settings
    document.getElementById('settings-room-name').value = currentRoom.name;
    document.getElementById('settings-room-topic').value = currentRoom.topic;
    document.getElementById('settings-room-description').value = currentRoom.description || '';
    document.getElementById('settings-room-tags').value = (currentRoom.tags || []).join(', ');
    document.getElementById('settings-room-public').checked = currentRoom.isPublic;
    
    // Show modal
    document.getElementById('room-settings-modal').style.display = 'flex';
    
    // Set active tab
    switchSettingsTab('general-tab');
}

// Switch settings tab
function switchSettingsTab(tabId) {
    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Add active class to selected tab
    document.getElementById(tabId).classList.add('active');
    
    // Show selected tab content
    const contentId = tabId.replace('-tab', '-content');
    document.getElementById(contentId).classList.add('active');
}

// Create room
async function createRoom(event) {
    event.preventDefault();
    console.log('Creating new room...');
    
    const nameInput = document.getElementById('room-name');
    const topicInput = document.getElementById('room-topic');
    const descriptionInput = document.getElementById('room-description');
    const tagsInput = document.getElementById('room-tags');
    const isPublicInput = document.getElementById('room-public');
    
    const name = nameInput.value.trim();
    const topic = topicInput.value.trim();
    const description = descriptionInput.value.trim();
    const tagsString = tagsInput.value.trim();
    const isPublic = isPublicInput.checked;
    
    // Parse tags
    const tags = tagsString ? tagsString.split(',').map(tag => tag.trim()) : [];
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/rooms`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                topic,
                description,
                tags,
                isPublic
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to create room');
        }
        
        const newRoom = await response.json();
        console.log('Room created:', newRoom);
        
        // Close modal
        document.getElementById('create-room-modal').style.display = 'none';
        
        // Reset form
        event.target.reset();
        
        // Set current user as owner of the new room
        isOwner = true;
        
        // Reload rooms
        loadRooms();
        
        // Join the new room
        joinRoom(newRoom.id);
        
    } catch (error) {
        console.error('Error creating room:', error);
        alert('Failed to create room. Please try again.');
    }
}

// Transfer ownership
function transferOwnership() {
    const select = document.getElementById('transfer-ownership');
    const selectedUserId = select.value;
    
    if (!selectedUserId) {
        alert('Please select a user to transfer ownership to.');
        return;
    }
    
    const selectedOption = select.options[select.selectedIndex];
    const newOwnerUsername = selectedOption.textContent;
    
    // In a real app, this would make an API call to transfer ownership
    alert(`Ownership transferred to ${newOwnerUsername}`);
    
    // Update room data to reflect new owner
    if (currentRoom && currentRoom.members && currentRoom.members.length > 0) {
        const currentOwner = currentRoom.members[0];
        const ownerIndex = currentRoom.members.indexOf(currentOwner);
        
        if (ownerIndex !== -1) {
            // Move new owner to first position
            currentRoom.members.splice(ownerIndex, 1);
            currentRoom.members.unshift(newOwnerUsername);
            
            // Update user roles
            isOwner = false;
            
            // Reload members to reflect changes
            loadRoomMembers(currentRoom);
        }
    }
}

// Promote to host
function promoteToHost() {
    const select = document.getElementById('promote-host');
    const selectedUserId = select.value;
    
    if (!selectedUserId) {
        alert('Please select a user to promote to host.');
        return;
    }
    
    const selectedOption = select.options[select.selectedIndex];
    const hostUsername = selectedOption.textContent;
    
    // In a real app, this would make an API call to promote the user
    alert(`${hostUsername} has been promoted to Host`);
    
    // Reload members to reflect changes
    loadRoomMembers(currentRoom);
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('Setting up event listeners');
    
    // Message Actions
    document.getElementById('send-message-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // Room Actions
    document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);
    document.getElementById('room-settings-btn').addEventListener('click', showRoomSettings);
    
    document.getElementById('create-room-btn').addEventListener('click', () => {
        document.getElementById('create-room-modal').style.display = 'flex';
    });
    
    document.getElementById('close-create-modal').addEventListener('click', () => {
        document.getElementById('create-room-modal').style.display = 'none';
    });
    
    document.getElementById('create-room-form').addEventListener('submit', createRoom);
    
    // Settings Modal
    document.getElementById('close-settings-modal').addEventListener('click', () => {
        document.getElementById('room-settings-modal').style.display = 'none';
    });
    
    // Settings Tabs
    document.getElementById('general-tab').addEventListener('click', () => switchSettingsTab('general-tab'));
    document.getElementById('permissions-tab').addEventListener('click', () => switchSettingsTab('permissions-tab'));
    document.getElementById('members-tab').addEventListener('click', () => switchSettingsTab('members-tab'));
    document.getElementById('ai-tab').addEventListener('click', () => switchSettingsTab('ai-tab'));
    
    // Owner Actions
    document.getElementById('transfer-ownership-btn').addEventListener('click', transferOwnership);
    document.getElementById('promote-host-btn').addEventListener('click', promoteToHost);
    
    // Context Menu Items
    document.getElementById('context-whisper').addEventListener('click', () => {
        openWhisperWindow(selectedUser);
        closeContextMenu();
    });
    
    document.getElementById('context-view-profile').addEventListener('click', () => {
        alert(`View profile of ${selectedUser.username}`);
        closeContextMenu();
    });
    
    document.getElementById('context-mute').addEventListener('click', () => {
        alert(`${selectedUser.username} has been muted`);
        closeContextMenu();
    });
    
    document.getElementById('context-block').addEventListener('click', () => {
        alert(`${selectedUser.username} has been blocked`);
        closeContextMenu();
    });
    
    // Host/Owner Actions
    document.getElementById('context-kick').addEventListener('click', () => {
        alert(`${selectedUser.username} has been kicked from the room`);
        closeContextMenu();
    });
    
    document.getElementById('context-ban').addEventListener('click', () => {
        alert(`${selectedUser.username} has been banned from the room`);
        closeContextMenu();
    });
    
    // Owner Actions
    document.getElementById('context-transfer-ownership').addEventListener('click', () => {
        alert(`Opening ownership transfer for ${selectedUser.username}`);
        showRoomSettings();
        switchSettingsTab('members-tab');
        document.getElementById('transfer-ownership').value = selectedUser.id;
        closeContextMenu();
    });
    
    document.getElementById('context-promote-host').addEventListener('click', () => {
        alert(`${selectedUser.username} has been promoted to host`);
        closeContextMenu();
    });
    
    // Admin Actions
    document.getElementById('context-server-ban').addEventListener('click', () => {
        alert(`${selectedUser.username} has been banned from the server`);
        closeContextMenu();
    });
    
    document.getElementById('context-silence').addEventListener('click', () => {
        alert(`${selectedUser.username} has been silenced`);
        closeContextMenu();
    });
    
    document.getElementById('context-restrict').addEventListener('click', () => {
        alert(`${selectedUser.username} has been restricted`);
        closeContextMenu();
    });
    
    // Whisper Window
    document.getElementById('close-whisper').addEventListener('click', () => {
        document.getElementById('whisper-window').style.display = 'none';
    });
    
    document.getElementById('whisper-send-btn').addEventListener('click', sendWhisperMessage);
    document.getElementById('whisper-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendWhisperMessage();
        }
    });
    
    // Logout Button
    document.getElementById('logout-btn').addEventListener('click', () => {
        console.log('Logging out...');
        
        // Close WebSocket connection
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
        
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('currentRoomId');
        window.location.href = 'index.html';
    });
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        const createRoomModal = document.getElementById('create-room-modal');
        const settingsModal = document.getElementById('room-settings-modal');
        
        if (e.target === createRoomModal) {
            createRoomModal.style.display = 'none';
        }
        
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });
    
    // Window close event - close WebSocket connection
    window.addEventListener('beforeunload', () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
    });
});