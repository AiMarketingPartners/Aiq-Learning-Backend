const mongoose = require('mongoose');
const Category = require('../models/Category');
require('dotenv').config();

const categories = [
    {
        name: "web development",
        description: "Learn to build websites and web applications using modern technologies like HTML, CSS, JavaScript, React, Node.js, and more.",
        icon: "💻",
        isActive: true
    },
    {
        name: "mobile development",
        description: "Create mobile applications for iOS and Android using React Native, Flutter, Swift, Kotlin, and other mobile technologies.",
        icon: "📱",
        isActive: true
    },
    {
        name: "data science",
        description: "Master data analysis, machine learning, statistics, and visualization using Python, R, SQL, and advanced analytics tools.",
        icon: "📊",
        isActive: true
    },
    {
        name: "artificial intelligence",
        description: "Explore AI, machine learning, deep learning, neural networks, and natural language processing technologies.",
        icon: "🤖",
        isActive: true
    },
    {
        name: "cybersecurity",
        description: "Learn information security, ethical hacking, network security, and cybersecurity best practices.",
        icon: "🔒",
        isActive: true
    },
    {
        name: "cloud computing",
        description: "Master cloud platforms like AWS, Azure, Google Cloud, and learn about DevOps, containerization, and microservices.",
        icon: "☁️",
        isActive: true
    },
    {
        name: "design",
        description: "Learn UI/UX design, graphic design, product design, and design thinking methodologies.",
        icon: "🎨",
        isActive: true
    },
    {
        name: "business",
        description: "Develop business skills including marketing, management, entrepreneurship, and business strategy.",
        icon: "💼",
        isActive: true
    },
    {
        name: "programming languages",
        description: "Master programming languages like Python, JavaScript, Java, C++, Go, Rust, and more.",
        icon: "⌨️",
        isActive: true
    },
    {
        name: "databases",
        description: "Learn database design, SQL, NoSQL, database administration, and data modeling techniques.",
        icon: "🗄️",
        isActive: true
    }
];

async function seedCategories() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        // Clear existing categories
        await Category.deleteMany({});
        console.log('Cleared existing categories');

        // Insert new categories
        const insertedCategories = await Category.insertMany(categories);
        console.log(`Inserted ${insertedCategories.length} categories:`);
        
        insertedCategories.forEach(cat => {
            console.log(`- ${cat.name} (ID: ${cat._id})`);
        });

        console.log('Categories seeded successfully!');
        
    } catch (error) {
        console.error('Error seeding categories:', error);
    } finally {
        // Close the connection
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
}

// Run the seeder
seedCategories();