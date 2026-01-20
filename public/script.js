// Generate unique session ID
const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const homeBtn = document.getElementById('homeBtn');
const exportBtn = document.getElementById('exportBtn');
const exportMenu = document.getElementById('exportMenu');
const exportSummaryWord = document.getElementById('exportSummaryWord');
const exportSummaryPdf = document.getElementById('exportSummaryPdf');
const exportTranscriptWord = document.getElementById('exportTranscriptWord');
const exportTranscriptPdf = document.getElementById('exportTranscriptPdf');

let welcomeMessageVisible = true;

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
  sendBtn.disabled = !messageInput.value.trim();
});

// Send message on Enter (Shift+Enter for new line)
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (messageInput.value.trim()) {
      sendMessage();
    }
  }
});

// Send button click
sendBtn.addEventListener('click', sendMessage);

// Starter prompts
document.querySelectorAll('.starter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    messageInput.value = btn.dataset.prompt;
    sendMessage();
  });
});

// Home button - return to welcome screen
homeBtn.addEventListener('click', async () => {
  await fetch('/api/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  location.reload();
});

// Export dropdown
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('show');
});

document.addEventListener('click', () => {
  exportMenu.classList.remove('show');
});

exportSummaryWord.addEventListener('click', () => exportConversation('summary', 'word'));
exportSummaryPdf.addEventListener('click', () => exportConversation('summary', 'pdf'));
exportTranscriptWord.addEventListener('click', () => exportConversation('transcript', 'word'));
exportTranscriptPdf.addEventListener('click', () => exportConversation('transcript', 'pdf'));

// Functions
async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Remove welcome message if visible
  if (welcomeMessageVisible) {
    const welcome = chatContainer.querySelector('.welcome-message');
    if (welcome) welcome.remove();
    welcomeMessageVisible = false;
  }

  // Add user message to chat
  addMessage(message, 'user');
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Show typing indicator
  const typingId = showTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId })
    });

    const data = await response.json();
    removeTyping(typingId);

    if (data.error) {
      addMessage('Sorry, something went wrong. Please try again.', 'assistant');
    } else {
      addMessage(data.message, 'assistant');
    }
  } catch (error) {
    removeTyping(typingId);
    addMessage('Sorry, there was a connection error. Please try again.', 'assistant');
  }
}

async function exportConversation(type, format) {
  try {
    const response = await fetch(`/api/export/${type}/${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Export failed');
      return;
    }

    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = type === 'summary' ? 'survey-assistant-summary' : 'survey-assistant-transcript';
    a.download = `${filename}.${format === 'word' ? 'docx' : 'pdf'}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (error) {
    alert('Export failed. Please try again.');
  }
}

function addMessage(content, role) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'You' : 'SA';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = formatMessage(content);

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  chatContainer.appendChild(messageDiv);

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function formatMessage(content) {
  // Escape HTML first
  let text = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Split into lines for processing
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headers
    if (line.startsWith('### ')) {
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<h3>${line.slice(4)}</h3>`;
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<h2>${line.slice(3)}</h2>`;
      continue;
    }
    if (line.startsWith('# ')) {
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<h1>${line.slice(2)}</h1>`;
      continue;
    }

    // Unordered list items
    if (line.match(/^[\-\*]\s/)) {
      if (!inList || listType !== 'ul') {
        if (inList) html += `</${listType}>`;
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      line = line.replace(/^[\-\*]\s/, '');
      html += `<li>${formatInline(line)}</li>`;
      continue;
    }

    // Ordered list items
    if (line.match(/^\d+\.\s/)) {
      if (!inList || listType !== 'ol') {
        if (inList) html += `</${listType}>`;
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      line = line.replace(/^\d+\.\s/, '');
      html += `<li>${formatInline(line)}</li>`;
      continue;
    }

    // Close list if we hit a non-list line
    if (inList && line.trim() !== '') {
      html += `</${listType}>`;
      inList = false;
    }

    // Empty line
    if (line.trim() === '') {
      continue;
    }

    // Regular paragraph
    html += `<p>${formatInline(line)}</p>`;
  }

  // Close any open list
  if (inList) {
    html += `</${listType}>`;
  }

  return html;
}

function formatInline(text) {
  return text
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

function showTyping() {
  const id = 'typing_' + Date.now();
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message assistant';
  typingDiv.id = id;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'SA';

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';

  typingDiv.appendChild(avatar);
  typingDiv.appendChild(indicator);
  chatContainer.appendChild(typingDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  return id;
}

function removeTyping(id) {
  const typing = document.getElementById(id);
  if (typing) typing.remove();
}
