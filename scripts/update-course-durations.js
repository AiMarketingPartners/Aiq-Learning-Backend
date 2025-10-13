const mongoose = require('mongoose');
const Course = require('../models/Course');
require('dotenv').config();

async function updateCourseDurations() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URL);
        
        console.log('Finding all courses...');
        const courses = await Course.find({});
        
        for (const course of courses) {
            console.log(`\nUpdating durations for course: ${course.title}`);
            let updated = false;
            let totalDuration = 0;
            let totalLectures = 0;
            
            if (course.sections && course.sections.length > 0) {
                course.sections.forEach((section, sectionIndex) => {
                    if (section.lectures && section.lectures.length > 0) {
                        section.lectures.forEach((lecture, lectureIndex) => {
                            totalLectures++;
                            
                            // Update lecture durations with more realistic values
                            let newDuration = lecture.duration;
                            
                            if (lecture.type === 'video') {
                                // Video lectures: 5-20 minutes (300-1200 seconds)
                                if (lecture.duration < 300) {
                                    newDuration = Math.floor(Math.random() * (1200 - 300 + 1)) + 300;
                                    updated = true;
                                }
                                
                                // Also update video.duration if it exists
                                if (lecture.video) {
                                    lecture.video.duration = newDuration;
                                }
                            } else if (lecture.type === 'quiz') {
                                // Quiz lectures: 2-10 minutes (120-600 seconds)
                                if (lecture.duration < 120) {
                                    newDuration = Math.floor(Math.random() * (600 - 120 + 1)) + 120;
                                    updated = true;
                                }
                            } else if (lecture.type === 'note') {
                                // Reading lectures: 3-8 minutes (180-480 seconds)
                                if (lecture.duration < 180) {
                                    newDuration = Math.floor(Math.random() * (480 - 180 + 1)) + 180;
                                    updated = true;
                                }
                            }
                            
                            lecture.duration = newDuration;
                            totalDuration += newDuration;
                        });
                    }
                });
            }
            
            // Update course totals
            course.totalDuration = totalDuration;
            course.totalLectures = totalLectures;
            
            if (updated || course.totalDuration === 0) {
                await course.save();
                console.log(`  - Updated! Total Duration: ${totalDuration} seconds (${Math.floor(totalDuration/60)} minutes)`);
                console.log(`  - Total Lectures: ${totalLectures}`);
            } else {
                console.log(`  - No changes needed. Total Duration: ${totalDuration} seconds`);
            }
        }
        
        console.log('\n✅ Course durations updated successfully!');
        
    } catch (error) {
        console.error('❌ Error updating course durations:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

updateCourseDurations();

//node scripts/update-course-durations.js