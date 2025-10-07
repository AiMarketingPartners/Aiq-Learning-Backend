const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Trust proxy in production (for rate limiting and IP detection)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());

// Rate limiting with different rules for development and production
const limiter = rateLimit({
    windowMs: process.env.NODE_ENV === 'production' ? 15 * 60 * 1000 : 60 * 1000, // 15 minutes in prod, 1 minute in dev
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // 100 requests per 15min in prod, 1000 per minute in dev
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: process.env.NODE_ENV === 'production' ? '15 minutes' : '1 minute'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // Production proxy configuration
    trustProxy: process.env.NODE_ENV === 'production',
    // Add more detailed logging
    onLimitReached: (req) => {
        console.error(`🚫 Rate limit exceeded for IP: ${req.ip} - ${req.method} ${req.path}`);
        console.error(`🚫 Rate limit details: ${req.rateLimit ? `${req.rateLimit.used}/${req.rateLimit.limit} requests` : 'unknown'}`);
    },
    // Skip rate limiting for certain routes
    skip: (req) => {
        // Always skip rate limiting for health checks
        if (req.path === '/health' || req.path === '/api/health') {
            return true;
        }
        
        if (process.env.NODE_ENV !== 'production') {
            // Skip rate limiting for static files in development
            return req.path.includes('/static') || req.path.includes('/favicon');
        }
        return false;
    }
});
app.use(limiter);

// Request logging and tracking middleware
let requestCount = {};
app.use((req, res, next) => {
    const clientId = req.ip;
    const now = Date.now();
    
    // Clean up old entries (older than 5 minutes)
    if (requestCount[clientId]) {
        requestCount[clientId] = requestCount[clientId].filter(timestamp => now - timestamp < 5 * 60 * 1000);
    } else {
        requestCount[clientId] = [];
    }
    
    requestCount[clientId].push(now);
    
    // Log requests with frequency info
    const recentRequests = requestCount[clientId].length;
    const logLevel = recentRequests > 50 ? '🔥' : recentRequests > 20 ? '⚠️' : '📝';
    
    console.log(`${logLevel} ${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'} - Recent requests: ${recentRequests}`);
    
    // Add rate limit info to response headers for debugging
    res.set('X-Debug-Request-Count', recentRequests.toString());
    
    next();
});

// CORS configuration - BYPASS FOR COURSES ROUTES
const allowedOrigins = [
    'http://localhost:9002', // Your frontend development origin
    'http://localhost:3000', // Common Next.js dev port
    'http://localhost:3001', // Alternative dev port
    'https://aiq-learning-frontend.vercel.app', // Production frontend domain
    '*' // Allow all origins (courses routes handle their own CORS)
];

// Add production origins
if (process.env.NODE_ENV === 'production') {
    // Add common production patterns
    if (process.env.FRONTEND_URL) {
        allowedOrigins.push(process.env.FRONTEND_URL);
    }
    // Add additional production origins from environment variables
    if (process.env.ALLOWED_ORIGINS) {
        const additionalOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
        allowedOrigins.push(...additionalOrigins);
    }
}
    
const corsOptions = {
    origin: function (origin, callback) {
        // Debug logging
        console.log(`🔍 CORS check - Origin: ${origin || 'none'}, Environment: ${process.env.NODE_ENV}`);
        console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
        
        // ALWAYS ALLOW ALL ORIGINS - COMPLETE BYPASS
        console.log(`✅ CORS BYPASS - All origins allowed`);
        return callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
};

// Global CORS bypass for courses API - Handle preflight requests
app.use('/api/courses', (req, res, next) => {
    // Set permissive CORS headers for ALL courses requests
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'false'); // Set to false when using wildcard origin
    
    // Handle preflight OPTIONS requests immediately
    if (req.method === 'OPTIONS') {
        console.log(`🔧 GLOBAL OPTIONS preflight handled for: ${req.path}`);
        return res.status(200).send();
    }
    
    console.log(`🌐 Global CORS bypass applied for courses: ${req.method} ${req.path}`);
    next();
});

app.use(cors(corsOptions));

// Body parsing middleware  
app.use(express.json({ limit: '5gb' }));
app.use(express.urlencoded({ extended: true, limit: '5gb' }));

// Serve static files from uploads directory with CORS headers
app.use('/uploads', cors({
    origin: true, // Allow all origins for development
    credentials: false,
    methods: ['GET'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept']
}), express.static('uploads'));

// Database connection
mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
    });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/enrollments', require('./routes/enrollments'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/wishlist', require('./routes/wishlist'));

// Health check endpoints (excluded from rate limiting)
app.get('/health', (req, res) => {
    const clientId = req.ip;
    const recentRequests = requestCount[clientId] ? requestCount[clientId].length : 0;
    
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        rateLimitInfo: {
            recentRequests: recentRequests,
            maxRequestsInDev: 1000,
            maxRequestsInProd: 100
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Development-only endpoint to reset rate limits
if (process.env.NODE_ENV !== 'production') {
    app.post('/api/dev/reset-rate-limits', (req, res) => {
        requestCount = {};
        console.log('🔄 Rate limit counters reset');
        res.json({ 
            message: 'Rate limit counters reset', 
            timestamp: new Date().toISOString() 
        });
    });
}

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        message: 'Something went wrong!',
        ...(process.env.NODE_ENV === 'development' && { error: err.message })
    });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});