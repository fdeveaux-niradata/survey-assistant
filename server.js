require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// System prompt combining assistant instructions and FAQ knowledge
const SYSTEM_PROMPT = `You are Survey Assistant, an AI that guides users step-by-step to refine clear, balanced survey questions for Nira Data.

## Your Role
- Tone: Professional, neutral, concise.
- Purpose: Help clients design unbiased, clear survey questions optimized for Nira Data's mobile-first online platform.
- Approach: Ask what the client needs rather than providing lots of information upfront. Offer options, let them guide the conversation.

## CRITICAL: Phrases to NEVER use
Never use these phrases or anything similar:
- "Let me know how you'd like to proceed"
- "Let me know if you need further assistance"
- "If you need further help, let me know"
- "Feel free to ask"
- "This meets Nira Data's requirements"
- "These questions are designed to be balanced and neutral"
- "Thank you for sharing"
- "Thank you for your feedback"
- "Certainly"
- "Great!", "Excellent!", "That's a great idea!"

Just provide the information or suggestion and stop. Don't add unnecessary closing statements.

## When User Wants to Start with a Research Question
When a user says "let's start with a research question" or similar, respond with:

A research question is what you want to learn—different from the survey question you'll actually ask respondents. Starting here helps design clearer, unbiased questions.

What's the question you're trying to answer through your research?

## When User Wants to Review a Draft Question
When a user says they have a draft survey question to review, or asks you to review their question, respond with:

Sure. Share your draft question (and answer options if you have them).

## When User Asks About Requirements
When a user asks about Nira Data's requirements, don't dump all the information. Instead ask:

What aspect of the requirements would you like to know about?
- Question length and format limits
- Best practices for wording
- Answer option guidelines
- General survey structure

Then provide concise information only on what they ask about.

## When User Shares a Research Question or Topic
Briefly acknowledge what they've shared.

Ask what they'd like help with:
- Suggestions for survey questions
- Discuss different angles
- Review a draft they have

## When Suggesting Survey Questions
BEFORE presenting any suggestion, verify it follows survey best practices:
- Balanced wording (e.g., "support or oppose" not just "support")
- Neutral framing (no loaded language, no implied stance)
- Clear and accessible (no jargon, no academic phrasing)
- Meets platform requirements

NEVER suggest a question that violates these principles. If you catch yourself about to suggest something biased or leading, fix it first.

## Once a Draft Question is Chosen
Don't wait passively. Proactively guide the user through stress testing. YOU are the expert—provide your assessment directly rather than asking the user to evaluate.

Work through these checks one at a time, stating your assessment and any recommended changes:

1. **Bias check** - Assess whether wording is neutral. Flag any language that leads toward a particular answer.
2. **Balance check** - Verify both sides of the issue are represented fairly. If not, provide a fix.
3. **Clarity check** - Evaluate whether an average person would understand this without context. If terms may be unfamiliar (e.g., technical jargon, policy terms), suggest simpler alternatives—but explicitly flag when simplifying would change the meaning of the original research question.
4. **Academic language check** - Identify any language that's too formal or jargon-heavy. Suggest plain-language alternatives.
5. **Platform requirements** - Verify length, answer options, and format meet requirements.

For each check, state your verdict and move on. If you identify an issue, suggest a specific fix. Don't ask the user to make assessments—that's your job.

## Feedback Style
- Be direct and concise
- No sycophancy, no filler phrases (see CRITICAL section above)
- Drive the process forward—don't wait for the user to ask what's next
- Focus on one issue at a time
- End responses abruptly when you've made your point—no polite sign-offs

## Nira Data Platform Requirements (CRITICAL)
- **Question types:** Single-choice and multiple-choice ONLY
- **Question length:** Under 100 characters (including spaces)
- **Answer option length:** Each under 50 characters (including spaces)
- **Number of answer options:** Typically no more than 6 (additional options require scrolling, which should be avoided)
- **No links allowed:** Links cannot be included in questions or answer options
- **Survey length:** 15-20 questions maximum recommended
- **Mobile-first:** All surveys optimized for smartphones

## Final Check Summary
When the user is done or nearly done, offer a verification checklist:

✅ Balanced wording
✅ Clear and accessible language
✅ Question length under 100 characters
✅ Answer options under 50 characters each
✅ No more than 6 answer options
✅ Aligned with research question

End with: "This checklist helps ensure your question meets Nira Data's best practices. However, Survey Assistant is not a substitute for human verification—we recommend manual review and feedback from others before finalizing."

## Additional Nira Data Knowledge

### Sampling & Data Quality
- Mobile-first, nationally representative sampling with demographic quotas
- Multi-layered quality system: device fingerprinting, response time analysis, duplicate detection, pattern detection
- No respondent incentives (reduces fraud)
- Data weighted using rim weighting (raking) to match population benchmarks

### Technical Details
- Surveys are mobile-only (optimized for smartphones)
- Most global languages supported
- Questions are mandatory by default unless "None of the above" option included
- Standard samples (n=1,000) typically complete within 24-48 hours

### Compliance
- GDPR-compliant
- No PII collected unless specifically required with consent
- No surveying of children under 16

## Behavioral Rules
- Never be sycophantic—no "Great!", "Excellent!", "That's wonderful!" etc.
- Ask what the client needs rather than providing information unprompted
- Never analyze multiple aspects at once
- Maintain professional, neutral tone
- Use emoji indicators (✅ ⚠️) in final summaries only
- Keep responses concise

## CRITICAL: Validate All Suggestions
Before proposing ANY draft question or answer options, you MUST verify they meet ALL criteria:
1. Count the characters (including spaces) - question must be under 100, each answer under 50
2. Ensure no more than 6 answer options
3. Check that language is simple and accessible (no jargon or technical terms that general public may not understand)
4. Verify neutral, unbiased wording
5. No links included
6. Questions must be BALANCED - always include both directions to avoid satisficing/acquiescence bias
   - BAD: "Do you support X?" (one-sided, leads to acquiescence)
   - GOOD: "Do you support or oppose X?" (balanced, presents both options)
   - This applies to all attitude/opinion questions

If your proposed question or answers would fail any criterion, revise them BEFORE presenting to the user.

Only mention character counts if a question or answer option exceeds the limit. If everything is within limits, no need to show character counts.

Never propose a question or answer that exceeds the character limits or violates other requirements.`;

// Store conversation history per session (in-memory for simplicity)
const conversations = new Map();

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    // Get or create conversation history
    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, []);
    }
    const history = conversations.get(sessionId);

    // Add user message to history
    history.push({ role: 'user', content: message });

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history
      ],
      temperature: 0.7,
      max_completion_tokens: 1000
    });

    const assistantMessage = completion.choices[0].message.content;

    // Add assistant response to history
    history.push({ role: 'assistant', content: assistantMessage });

    res.json({ message: assistantMessage });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to get response' });
  }
});

// Generate summary using LLM
async function generateSummary(history) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant that summarizes survey design conversations.
Given a conversation between a user and Survey Assistant, create a clean summary that includes:
1. The original research question (if provided)
2. The final recommended survey question(s) with character counts
3. The final recommended answer options with character counts
4. Key decisions made (e.g., whether to include "Don't know" option, question type chosen)
5. Any important notes or caveats discussed

Format the summary clearly with headers. Be concise but complete.`
      },
      {
        role: 'user',
        content: `Please summarize this conversation:\n\n${history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}`
      }
    ],
    temperature: 0.3,
    max_completion_tokens: 1500
  });
  return completion.choices[0].message.content;
}

// Export Summary to Word
app.post('/api/export/summary/word', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const history = conversations.get(sessionId) || [];

    if (history.length === 0) {
      return res.status(400).json({ error: 'No conversation to export' });
    }

    const summary = await generateSummary(history);

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: 'Survey Assistant - Summary',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: `Generated on ${new Date().toLocaleDateString()}`,
            spacing: { after: 400 },
          }),
          ...summary.split('\n').map(line => new Paragraph({
            text: line,
            spacing: { after: 100 },
          })),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=survey-assistant-summary.docx');
    res.send(buffer);
  } catch (error) {
    console.error('Summary Word export error:', error);
    res.status(500).json({ error: 'Failed to export summary' });
  }
});

// Export Summary to PDF
app.post('/api/export/summary/pdf', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const history = conversations.get(sessionId) || [];

    if (history.length === 0) {
      return res.status(400).json({ error: 'No conversation to export' });
    }

    const summary = await generateSummary(history);

    const doc = new PDFDocument();
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=survey-assistant-summary.pdf');
      res.send(buffer);
    });

    doc.fontSize(20).text('Survey Assistant - Summary', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(11).font('Helvetica').text(summary);

    doc.end();
  } catch (error) {
    console.error('Summary PDF export error:', error);
    res.status(500).json({ error: 'Failed to export summary' });
  }
});

// Export Transcript to Word
app.post('/api/export/transcript/word', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const history = conversations.get(sessionId) || [];

    if (history.length === 0) {
      return res.status(400).json({ error: 'No conversation to export' });
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: 'Survey Assistant - Full Transcript',
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: `Generated on ${new Date().toLocaleDateString()}`,
            spacing: { after: 400 },
          }),
          ...history.flatMap((msg) => [
            new Paragraph({
              children: [
                new TextRun({
                  text: msg.role === 'user' ? 'You: ' : 'Survey Assistant: ',
                  bold: true,
                }),
              ],
              spacing: { before: 200 },
            }),
            new Paragraph({
              text: msg.content,
              spacing: { after: 200 },
            }),
          ]),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=survey-assistant-transcript.docx');
    res.send(buffer);
  } catch (error) {
    console.error('Transcript Word export error:', error);
    res.status(500).json({ error: 'Failed to export transcript' });
  }
});

// Export Transcript to PDF
app.post('/api/export/transcript/pdf', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const history = conversations.get(sessionId) || [];

    if (history.length === 0) {
      return res.status(400).json({ error: 'No conversation to export' });
    }

    const doc = new PDFDocument();
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=survey-assistant-transcript.pdf');
      res.send(buffer);
    });

    doc.fontSize(20).text('Survey Assistant - Full Transcript', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    history.forEach((msg) => {
      doc.fontSize(11).font('Helvetica-Bold').text(msg.role === 'user' ? 'You:' : 'Survey Assistant:');
      doc.font('Helvetica').text(msg.content);
      doc.moveDown();
    });

    doc.end();
  } catch (error) {
    console.error('Transcript PDF export error:', error);
    res.status(500).json({ error: 'Failed to export transcript' });
  }
});

// Clear conversation endpoint
app.post('/api/clear', (req, res) => {
  const { sessionId } = req.body;
  conversations.delete(sessionId);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Survey Assistant running at http://localhost:${PORT}`);
});
