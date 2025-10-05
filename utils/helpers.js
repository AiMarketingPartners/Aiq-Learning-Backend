// Common response helpers
const sendSuccess = (res, statusCode = 200, message, data = null) => {
    const response = { message };
    if (data) {
        response.data = data;
    }
    return res.status(statusCode).json(response);
};

const sendError = (res, statusCode = 500, message, error = null) => {
    const response = { message };
    if (error && process.env.NODE_ENV === 'development') {
        response.error = error;
    }
    return res.status(statusCode).json(response);
};

// Pagination helper
const getPagination = (page = 1, limit = 10) => {
    const skip = (page - 1) * limit;
    return {
        skip: parseInt(skip),
        limit: parseInt(limit),
        page: parseInt(page)
    };
};

// Format duration from seconds to readable format
const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
};

// Generate unique filename
const generateUniqueFilename = (originalname) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const extension = originalname.split('.').pop();
    return `${timestamp}_${random}.${extension}`;
};

// Validate MongoDB ObjectId
const isValidObjectId = (id) => {
    return /^[0-9a-fA-F]{24}$/.test(id);
};

// Calculate percentage
const calculatePercentage = (part, total) => {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
};

// Generate random string
const generateRandomString = (length = 10) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Sanitize text (remove HTML tags)
const sanitizeText = (text) => {
    return text.replace(/<[^>]*>/g, '');
};

// Validate email format
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Format price
const formatPrice = (price, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(price);
};

// Get file extension
const getFileExtension = (filename) => {
    return filename.split('.').pop().toLowerCase();
};

// Check if file type is allowed
const isAllowedFileType = (filename, allowedTypes = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx']) => {
    const extension = getFileExtension(filename);
    return allowedTypes.includes(extension);
};

// Generate course slug
const generateSlug = (title) => {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim('-');
};

// Calculate reading time (words per minute)
const calculateReadingTime = (text, wpm = 200) => {
    const words = text.trim().split(/\s+/).length;
    const minutes = Math.ceil(words / wpm);
    return `${minutes} min read`;
};

// Truncate text
const truncateText = (text, maxLength = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
};

// Convert bytes to human readable format
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Validate password strength
const isStrongPassword = (password) => {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.{8,})/;
    return strongRegex.test(password);
};

// Generate certificate ID
const generateCertificateId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CERT-${timestamp}-${random}`;
};

// Get time ago string
const getTimeAgo = (date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, seconds] of Object.entries(intervals)) {
        const interval = Math.floor(diffInSeconds / seconds);
        if (interval >= 1) {
            return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
        }
    }
    
    return 'just now';
};

module.exports = {
    sendSuccess,
    sendError,
    getPagination,
    formatDuration,
    generateUniqueFilename,
    isValidObjectId,
    calculatePercentage,
    generateRandomString,
    sanitizeText,
    isValidEmail,
    formatPrice,
    getFileExtension,
    isAllowedFileType,
    generateSlug,
    calculateReadingTime,
    truncateText,
    formatBytes,
    isStrongPassword,
    generateCertificateId,
    getTimeAgo
};