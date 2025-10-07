const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Category = require('../models/Category');
const Course = require('../models/Course');
require('dotenv').config();

const seedData = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        // Clear existing data
        await User.deleteMany({});
        await Category.deleteMany({});
        await Course.deleteMany({});
        console.log('Cleared existing data');

        // Create admin user
        const adminPassword = await bcrypt.hash('admin123', 10);
        const admin = new User({
            name: 'Admin User',
            email: 'admin@elearning.com',
            password: adminPassword,
            role: 'admin',
            isVerified: true
        });
        await admin.save();
        console.log('✓ Admin user created');

        // Create sample categories
        const categories = [
            {
                name: 'web development',
                description: 'Learn modern web development technologies including HTML, CSS, JavaScript, React, Node.js and more',
                icon: '🌐'
            },
            {
                name: 'mobile development',
                description: 'Build native and cross-platform mobile applications for iOS and Android',
                icon: '📱'
            },
            {
                name: 'data science',
                description: 'Master data analysis, machine learning, and artificial intelligence',
                icon: '📊'
            },
            {
                name: 'design',
                description: 'Learn UI/UX design, graphic design, and design thinking principles',
                icon: '🎨'
            },
            {
                name: 'business',
                description: 'Develop business skills including marketing, management, and entrepreneurship',
                icon: '💼'
            }
        ];

        const createdCategories = await Category.insertMany(categories);
        console.log('✓ Sample categories created');

        // Create verified instructor
        const instructorPassword = await bcrypt.hash('instructor123', 10);
        const instructor = new User({
            name: 'John Instructor',
            email: 'instructor@elearning.com',
            password: instructorPassword,
            role: 'instructor',
            isVerified: true,
            instructor: {
                expertise: ['JavaScript', 'React', 'Node.js', 'Web Development'],
                experience: 'Senior Full Stack Developer with 8+ years of experience in building scalable web applications. Previously worked at major tech companies including Google and Microsoft.',
                qualifications: 'BS Computer Science, Certified React Developer, AWS Solutions Architect',
                verificationStatus: 'approved',
                verifiedAt: new Date(),
                verifiedBy: admin._id
            }
        });
        await instructor.save();
        console.log('✓ Verified instructor created');

        // Create pending instructor
        const pendingInstructorPassword = await bcrypt.hash('pending123', 10);
        const pendingInstructor = new User({
            name: 'Jane Pending',
            email: 'pending@elearning.com',
            password: pendingInstructorPassword,
            role: 'instructor',
            isVerified: false,
            instructor: {
                expertise: ['Python', 'Data Science', 'Machine Learning'],
                experience: 'Data Scientist with 5 years of experience in ML and AI. Worked on various projects involving predictive modeling and data analysis.',
                qualifications: 'MS Data Science, Certified Python Developer, Google Cloud ML Engineer',
                verificationStatus: 'pending'
            }
        });
        await pendingInstructor.save();
        console.log('✓ Pending instructor created');

        // Create sample learners
        const learners = [];
        for (let i = 1; i <= 5; i++) {
            const learnerPassword = await bcrypt.hash(`learner${i}123`, 10);
            const learner = new User({
                name: `Learner ${i}`,
                email: `learner${i}@elearning.com`,
                password: learnerPassword,
                role: 'learner',
                isVerified: true,
                profile: {
                    bio: `I'm a passionate learner interested in technology and personal development.`,
                    country: ['USA', 'Canada', 'UK', 'Australia', 'India'][i - 1]
                }
            });
            learners.push(learner);
        }
        await User.insertMany(learners);
        console.log('✓ Sample learners created');

        // Create sample course
        const webDevCategory = createdCategories.find(cat => cat.name === 'web development');
        const sampleCourse = new Course({
            title: 'Complete JavaScript Mastery',
            description: 'Master JavaScript from fundamentals to advanced concepts. Learn ES6+, DOM manipulation, async programming, and build real-world projects. Perfect for beginners and intermediate developers who want to strengthen their JavaScript skills.',
            shortDescription: 'Master JavaScript from beginner to advanced level with hands-on projects',
            instructor: instructor._id,
            category: webDevCategory._id,
            level: 'beginner',
            price: 89.99,
            originalPrice: 129.99,
            thumbnail: 'https://example.com/javascript-course.jpg',
            whatYouWillLearn: [
                'JavaScript fundamentals and ES6+ features',
                'DOM manipulation and event handling',
                'Asynchronous programming with promises and async/await',
                'Working with APIs and fetch requests',
                'Object-oriented programming in JavaScript',
                'Functional programming concepts',
                'Error handling and debugging techniques',
                'Building real-world JavaScript projects'
            ],
            requirements: [
                'Basic computer literacy',
                'A modern web browser',
                'Text editor (VS Code recommended)',
                'No prior programming experience required'
            ],
            tags: ['javascript', 'programming', 'web-development', 'frontend'],
            language: 'English',
            sections: [
                {
                    title: 'JavaScript Fundamentals',
                    description: 'Learn the basic concepts of JavaScript programming',
                    order: 1,
                    lessons: [
                        {
                            title: 'Introduction to JavaScript',
                            description: 'What is JavaScript and why learn it?',
                            order: 1,
                            videoDuration: 600,
                            isPreview: true,
                            resources: [
                                {
                                    name: 'Course Introduction PDF',
                                    url: 'https://example.com/intro.pdf',
                                    type: 'pdf'
                                }
                            ]
                        },
                        {
                            title: 'Variables and Data Types',
                            description: 'Understanding JavaScript variables and data types',
                            order: 2,
                            videoDuration: 900,
                            isPreview: false
                        },
                        {
                            title: 'Functions and Scope',
                            description: 'Learn about functions and variable scope',
                            order: 3,
                            videoDuration: 1200,
                            isPreview: false
                        }
                    ]
                },
                {
                    title: 'DOM Manipulation',
                    description: 'Learn to manipulate HTML elements with JavaScript',
                    order: 2,
                    lessons: [
                        {
                            title: 'Selecting DOM Elements',
                            description: 'How to select and target HTML elements',
                            order: 1,
                            videoDuration: 800,
                            isPreview: false
                        },
                        {
                            title: 'Modifying Element Properties',
                            description: 'Change text, attributes, and styles dynamically',
                            order: 2,
                            videoDuration: 1000,
                            isPreview: false
                        }
                    ]
                }
            ],
            isPublished: true,
            publishedAt: new Date()
        });

        await sampleCourse.save();
        console.log('✓ Sample course created');

        console.log('\n🎉 Seed data created successfully!');
        console.log('\nLogin Credentials:');
        console.log('Admin: admin@elearning.com / admin123');
        console.log('Instructor: instructor@elearning.com / instructor123');
        console.log('Pending Instructor: pending@elearning.com / pending123');
        console.log('Learners: learner1@elearning.com / learner1123 (up to learner5)');

    } catch (error) {
        console.error('Error seeding data:', error);
    } finally {
        mongoose.connection.close();
    }
};

// Run seeder if called directly
if (require.main === module) {
    seedData();
}

module.exports = seedData;