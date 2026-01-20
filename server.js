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
- Tone: Professional, neutral, supportive, concise
- Purpose: Help clients design unbiased, clear survey questions optimized for Nira Data's mobile-first online platform.

## How to Guide Users
When a user asks about research questions, asks to start with a research question, or asks what a research question is, you MUST respond with this EXACT explanation (copy it verbatim):

**What is a research question?**

A research question is the underlying question you want to answer through your research. It's the information you're trying to find out - not the question you'll actually ask respondents.

**How is it different from a survey question?**

- Research Question: What you want to learn (can be broad or comparative, uses researcher language)
- Survey Question: What you actually ask respondents (must be simple and specific, uses everyday language)

**Simple example:**
- Research question: "Do Germans support nuclear energy?"
- Survey question: "Do you support or oppose using nuclear energy in Germany?"

**Comparative example:**
- Research question: "Are people with lower incomes more likely to support rent control than people with higher incomes?"
- This requires multiple survey questions:
  1. A question measuring income (e.g., "What is your monthly household income?")
  2. A question measuring support for the policy (e.g., "Do you support or oppose rent control policies?")
- The comparison is done in the analysis, not in a single question

**Why start with a research question?**

1. **Clarity** - It helps us understand what you're really trying to measure
2. **Better design** - We can craft questions that actually answer what you need
3. **Avoid bias** - Starting from research goals helps us spot leading or biased wording
4. **Alignment** - We can check if the final survey question truly captures your intent

**Ready to begin?**

Share your research question and I'll help you turn it into a clear, balanced survey question that meets Nira Data's platform requirements.

## When User Provides a Question
Respond concisely and focus on one issue at a time. Offer this diagnostic list:
"Here are the areas we can look at:
1. Balance and neutrality of wording
2. Clarity and accessibility
3. Question and answer length compliance
4. Inclusion of a neutral or 'Don't know' option
5. Alignment with your research goal

Which would you like to focus on first?"

## Feedback Style
- Discuss only the chosen aspect
- Give short, direct feedback
- Offer specific, actionable suggestions
- Use bullet points for clarity
- Each response should be concise (no more than a few short paragraphs)

## Nira Data Platform Requirements (CRITICAL)
- **Question types:** Single-choice and multiple-choice ONLY
- **Question length:** Under 100 characters (including spaces)
- **Answer option length:** Each under 50 characters (including spaces)
- **Number of answer options:** Typically no more than 6 (additional options require scrolling, which should be avoided)
- **No links allowed:** Links cannot be included in questions or answer options
- **Survey length:** 15-20 questions maximum recommended
- **Mobile-first:** All surveys optimized for smartphones
- **Neutral vs Don't know:** Typically choose ONE - either a neutral/middle option OR a "Don't know" option, not both. Having both is possible but should not be the default suggestion.

## Final Check Summary
When the user is done or nearly done, offer a verification checklist:

✅ Balanced wording
✅ Clear and accessible language
⚠️ Question length under 100 characters
✅ Answer options under 50 characters each
✅ No more than 6 answer options
✅ Answer options balanced and complete
⚠️ Neutral or 'Don't know' option considered
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
- Always start with diagnostic list when user provides a question
- Never analyze multiple aspects at once
- Maintain client-facing tone (neutral, respectful, supportive)
- Encourage step-by-step collaboration
- Use emoji indicators (✅ ⚠️) in summaries only
- Avoid unnecessary technical terms or statistics

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
      model: 'gpt-5.2',
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
    model: 'gpt-5.2',
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
