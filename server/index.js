const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// In-Memory Store for Live Social Carts
// Structure: { roomCode: { members: [{id, name}], items: [], discountPercent: 0 } }
const socialCarts = {};

app.get('/api/status', (req, res) => {
    res.json({ status: "Online", activeCarts: Object.keys(socialCarts).length });
});

// Calculate discount tier based on room members
function calculateDiscount(memberCount) {
    if (memberCount >= 5) return 20; // 20% off for 5+ people
    if (memberCount >= 2) return 10; // 10% off for 2-4 people
    return 0;                        // 0% off for solo
}

io.on('connection', (socket) => {
    console.log('⚡ User connected:', socket.id);

    // 1. Create a new Social Cart Room
    socket.on('create_cart', ({ userName }) => {
        const roomCode = 'AURA-' + Math.floor(1000 + Math.random() * 9000);
        
        socialCarts[roomCode] = {
            members: [{ id: socket.id, name: userName }],
            items: [],
            chatMessages: [],
            discountPercent: 0
        };

        socket.join(roomCode);
        socket.emit('cart_created', { roomCode, cartState: socialCarts[roomCode] });
        console.log(`🛒 Cart Created: ${roomCode} by ${userName}`);
    });

    // 2. Join an existing Social Cart Room
    socket.on('join_cart', ({ roomCode, userName }) => {
        const cart = socialCarts[roomCode];

        if (!cart) {
            socket.emit('error_message', 'Room code not found!');
            return;
        }

        // Add member if not already joined
        if (!cart.members.find(m => m.id === socket.id)) {
            cart.members.push({ id: socket.id, name: userName });
        }

        socket.join(roomCode);
        cart.discountPercent = calculateDiscount(cart.members.length);

        // Notify everyone in the room that someone joined & send updated cart state
        io.to(roomCode).emit('cart_updated', { roomCode, cartState: cart });
        console.log(`👤 ${userName} joined cart ${roomCode}. Discount: ${cart.discountPercent}%`);
    });

    // 3. Add Item to Shared Cart
    socket.on('add_to_cart', ({ roomCode, product, userName }) => {
        const cart = socialCarts[roomCode];
        if (!cart) return;

        cart.items.push({ ...product, addedBy: userName, cartItemId: Date.now() });

        // Broadcast updated cart to all users in the room
        io.to(roomCode).emit('cart_updated', { roomCode, cartState: cart });
        console.log(`🛍️ Item ${product.name} added to ${roomCode} by ${userName}`);
    });

    // 4. Live Chat inside Cart
    socket.on('send_chat', ({ roomCode, message, userName }) => {
        const cart = socialCarts[roomCode];
        if (!cart) return;

        const chatObj = { userName, message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        cart.chatMessages.push(chatObj);

        io.to(roomCode).emit('chat_received', chatObj);
    });

    // 5. User Disconnected
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
        // Clean up user from rooms
        for (const roomCode in socialCarts) {
            const cart = socialCarts[roomCode];
            const initialCount = cart.members.length;
            cart.members = cart.members.filter(m => m.id !== socket.id);

            if (cart.members.length !== initialCount) {
                cart.discountPercent = calculateDiscount(cart.members.length);
                io.to(roomCode).emit('cart_updated', { roomCode, cartState: cart });
            }
        }
    });
});

const PORT = 5000;
server.listen(PORT, () => {
    console.log(`✅ Social Engine running on http://localhost:${PORT}`);
});