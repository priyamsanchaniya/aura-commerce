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
// ============================================================
// FEATURE 4: HYPERLOCAL REVIEWS + RENT-BEFORE-BUY
// ============================================================

// Haversine formula → real distance between two GPS points (km)
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Creates a coordinate X km away from a point (used to place demo neighbours around the viewer)
function offsetCoord(lat, lng, distKm, bearingDeg) {
    const R = 6371;
    const br = bearingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180, lng1 = lng * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distKm / R) +
                 Math.cos(lat1) * Math.sin(distKm / R) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(distKm / R) * Math.cos(lat1),
                 Math.cos(distKm / R) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

// Seeded community reviews (placed relative to whoever is viewing)
const seedReviews = [
    { id: 1, productId: 1, name: "Rahul M.",  rating: 5, comment: "Noise cancellation is unreal on my daily commute. Battery lasted my whole week.", distKm: 1.2,  bearing: 45,  verified: true,  daysAgo: 3 },
    { id: 2, productId: 1, name: "Sneha P.",  rating: 4, comment: "Sound is amazing but the case is bulky. Still worth it at this price.",           distKm: 3.4,  bearing: 210, verified: true,  daysAgo: 8 },
    { id: 3, productId: 1, name: "Karan D.",  rating: 5, comment: "Rented it for 3 days first, then bought it. Best decision — try before you buy!",  distKm: 4.6,  bearing: 300, verified: true,  daysAgo: 12 },
    { id: 4, productId: 1, name: "Aditi R.",  rating: 3, comment: "Good, but mic quality on calls is average.",                                       distKm: 18.5, bearing: 120, verified: true,  daysAgo: 20 },
    { id: 5, productId: 1, name: "Vikram S.", rating: 5, comment: "Delivered green route in 3 days. Zero complaints.",                                distKm: 47.0, bearing: 90,  verified: false, daysAgo: 25 },

    { id: 6, productId: 2, name: "Meera J.",  rating: 5, comment: "Charged fully on my terrace in one afternoon. Perfect for power cuts here.",       distKm: 0.9,  bearing: 15,  verified: true,  daysAgo: 5 },
    { id: 7, productId: 2, name: "Arjun T.",  rating: 4, comment: "Solar is slow in monsoon but USB-C fast charge saves it.",                         distKm: 2.7,  bearing: 260, verified: true,  daysAgo: 9 },
    { id: 8, productId: 2, name: "Nikhil B.", rating: 2, comment: "Mine heats up while charging two devices.",                                        distKm: 33.0, bearing: 180, verified: true,  daysAgo: 14 },

    { id: 9,  productId: 3, name: "Priya K.",  rating: 5, comment: "Back pain gone after 2 weeks of WFH. Bamboo finish looks premium.",               distKm: 2.1,  bearing: 75,  verified: true,  daysAgo: 6 },
    { id: 10, productId: 3, name: "Rohan V.",  rating: 4, comment: "Assembly took 40 mins alone. Very sturdy though.",                                distKm: 4.9,  bearing: 330, verified: true,  daysAgo: 11 },
    { id: 11, productId: 3, name: "Tanvi L.",  rating: 5, comment: "Lowest CO₂ chair I could find. Love the impact dashboard.",                       distKm: 25.0, bearing: 200, verified: true,  daysAgo: 18 }
];

const userReviews = [];  // real reviews submitted from the site
const rentals = [];      // active rentals

// GET reviews with real distance from the viewer
app.get('/api/reviews', (req, res) => {
    const productId = parseInt(req.query.productId);
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "Location required" });

    // Place demo neighbours around the current viewer
    const seeded = seedReviews.filter(r => r.productId === productId).map(r => {
        const c = offsetCoord(lat, lng, r.distKm, r.bearing);
        return {
            id: r.id, name: r.name, rating: r.rating, comment: r.comment,
            verified: r.verified, daysAgo: r.daysAgo,
            distanceKm: +haversineKm(lat, lng, c.lat, c.lng).toFixed(1)
        };
    });

    // Real submitted reviews measured with true Haversine
    const real = userReviews.filter(r => r.productId === productId).map(r => ({
        id: r.id, name: r.name, rating: r.rating, comment: r.comment,
        verified: true, daysAgo: 0,
        distanceKm: +haversineKm(lat, lng, r.lat, r.lng).toFixed(1)
    }));

    const all = [...real, ...seeded].sort((a, b) => a.distanceKm - b.distanceKm);
    const local = all.filter(r => r.distanceKm <= 5);

    res.json({
        reviews: all,
        localCount: local.length,
        totalCount: all.length,
        avgLocal: local.length ? +(local.reduce((s, r) => s + r.rating, 0) / local.length).toFixed(1) : 0,
        avgAll: all.length ? +(all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(1) : 0
    });
});

// POST a new review
app.post('/api/reviews', (req, res) => {
    const { productId, name, rating, comment, lat, lng } = req.body;
    if (!productId || !rating || !comment || lat == null || lng == null)
        return res.status(400).json({ error: "Missing fields" });

    const review = { id: Date.now(), productId: parseInt(productId), name: name || "Anonymous", rating: parseInt(rating), comment, lat, lng };
    userReviews.push(review);
    console.log(`⭐ New review for product ${productId} by ${review.name}`);
    res.json({ success: true, review });
});

// START a rental
app.post('/api/rentals', (req, res) => {
    const { email, productId, productName, price } = req.body;
    const fee = +(price * 0.08).toFixed(2); // 8% of price for 3 days
    const start = new Date();
    const end = new Date(Date.now() + 3 * 86400000);

    const rental = {
        id: Date.now(), email, productId: parseInt(productId), productName,
        fee, startDate: start.toISOString(), endDate: end.toISOString(), converted: false
    };
    rentals.push(rental);
    console.log(`📦 Rental started: ${productName} by ${email} for $${fee}`);
    res.json({ success: true, rental });
});

// CHECK for an active rental (valid for buy-credit within 7 days)
app.get('/api/rentals', (req, res) => {
    const { email, productId } = req.query;
    const active = rentals.find(r =>
        r.email === email &&
        r.productId === parseInt(productId) &&
        !r.converted &&
        (Date.now() - new Date(r.startDate).getTime()) < 7 * 86400000
    );
    res.json({ rental: active || null });
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