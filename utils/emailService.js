const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = null;
        this.setupTransporter();
    }

    setupTransporter() {
        // Configure your email service here
        // For development, you can use services like SendGrid, Mailgun, or Gmail
        this.transporter = nodemailer.createTransporter({
            service: 'gmail', // Change as needed
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    async sendWelcomeEmail(user) {
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'noreply@elearning.com',
            to: user.email,
            subject: 'Welcome to E-Learning Platform!',
            html: `
                <h1>Welcome, ${user.name}!</h1>
                <p>Thank you for joining our E-Learning platform.</p>
                ${user.role === 'instructor' ? 
                    '<p>Your instructor account is pending verification. You will be notified once approved.</p>' :
                    '<p>You can now browse and enroll in courses.</p>'
                }
                <p>Happy Learning!</p>
            `
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log('Welcome email sent to:', user.email);
        } catch (error) {
            console.error('Error sending welcome email:', error);
        }
    }

    async sendInstructorApprovalEmail(instructor) {
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'noreply@elearning.com',
            to: instructor.email,
            subject: 'Instructor Account Approved!',
            html: `
                <h1>Congratulations, ${instructor.name}!</h1>
                <p>Your instructor account has been approved.</p>
                <p>You can now create and publish courses on our platform.</p>
                <p>Start building amazing learning experiences!</p>
            `
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log('Approval email sent to:', instructor.email);
        } catch (error) {
            console.error('Error sending approval email:', error);
        }
    }

    async sendCertificateEmail(user, course, certificate) {
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'noreply@elearning.com',
            to: user.email,
            subject: `Certificate for ${course.title}`,
            html: `
                <h1>Congratulations, ${user.name}!</h1>
                <p>You have successfully completed <strong>${course.title}</strong>!</p>
                <p>Certificate ID: ${certificate.certificateId}</p>
                <p>You can verify this certificate using the ID above.</p>
                <p>Keep learning and growing!</p>
            `
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log('Certificate email sent to:', user.email);
        } catch (error) {
            console.error('Error sending certificate email:', error);
        }
    }
}

module.exports = new EmailService();