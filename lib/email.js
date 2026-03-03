const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendFeedbackEmail(performerEmail, performerName, skillName, feedbackText, reviewerName) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set, skipping email');
    return;
  }

  const appUrl = process.env.APP_URL || 'https://skillreelviewer-production.up.railway.app';
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@stuntlisting.com';

  const msg = {
    to: performerEmail,
    from: fromEmail,
    subject: `New feedback on your ${skillName} skill reel`,
    text: `Hi ${performerName},\n\n${reviewerName} left feedback on your ${skillName} skill reel:\n\n"${feedbackText}"\n\nView all feedback: ${appUrl}/my-reels\n\nBest,\nSkill Reel Rater`,
    html: `<p>Hi ${performerName},</p>
<p><strong>${reviewerName}</strong> left feedback on your <strong>${skillName}</strong> skill reel:</p>
<blockquote style="border-left: 3px solid #1f6feb; padding-left: 12px; color: #555;">${feedbackText}</blockquote>
<p><a href="${appUrl}/my-reels">View all feedback</a></p>
<p>Best,<br>Skill Reel Rater</p>`,
  };

  try {
    await sgMail.send(msg);
  } catch (err) {
    console.error('SendGrid email failed:', err.message);
  }
}

module.exports = { sendFeedbackEmail };
