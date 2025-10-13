const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
require('dotenv').config();

async function updateInstructorStats() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URL);
        
        console.log('Finding all instructors...');
        const instructors = await User.find({ role: 'instructor' });
        
        for (const instructor of instructors) {
            console.log(`\nUpdating stats for instructor: ${instructor.name}`);
            
            // Count courses by this instructor
            const courseCount = await Course.countDocuments({ 
                instructor: instructor._id,
                status: 'published'
            });
            
            // Count total students enrolled in instructor's courses
            const instructorCourses = await Course.find({ 
                instructor: instructor._id 
            }).select('_id');
            
            const courseIds = instructorCourses.map(course => course._id);
            
            const studentCount = await Enrollment.countDocuments({
                course: { $in: courseIds },
                isActive: true
            });
            
            // Calculate average rating (placeholder for now)
            const publishedCourses = await Course.find({ 
                instructor: instructor._id,
                status: 'published'
            });
            
            let averageRating = 0;
            if (publishedCourses.length > 0) {
                const totalRating = publishedCourses.reduce((sum, course) => {
                    return sum + (course.ratings?.average || 0);
                }, 0);
                averageRating = totalRating / publishedCourses.length;
            }
            
            // Update instructor stats
            await User.findByIdAndUpdate(instructor._id, {
                'instructor.totalCourses': courseCount,
                'instructor.totalStudents': studentCount,
                'instructor.rating': parseFloat(averageRating.toFixed(1))
            });
            
            console.log(`  - Total Courses: ${courseCount}`);
            console.log(`  - Total Students: ${studentCount}`);
            console.log(`  - Average Rating: ${averageRating.toFixed(1)}`);
        }
        
        console.log('\n✅ Instructor stats updated successfully!');
        
    } catch (error) {
        console.error('❌ Error updating instructor stats:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

updateInstructorStats();

//node scripts/update-instructor-stats.js