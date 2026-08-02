const chatList = document.getElementById("chat-list");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

const DEFAULT_USERNAME = "you";

function formatChatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderMessages(messages) {
  if (!chatList) return;

  if (!messages.length) {
    chatList.innerHTML = `<li class="chat-empty">No messages yet.</li>`;
    return;
  }

  const shouldStickToBottom =
    chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 48;

  chatList.innerHTML = messages
    .map((message) => {
      const isYou = message.username.toLowerCase() === DEFAULT_USERNAME;
      return `
        <li class="chat-message${isYou ? " chat-message--you" : ""}" data-id="${message.id}">
          <div class="chat-message__meta">
            <span class="chat-message__user">${escapeHtml(message.username)}</span>
            <time class="chat-message__time">${formatChatTime(message.timestamp)}</time>
          </div>
          <p class="chat-message__text">${escapeHtml(message.message)}</p>
        </li>
      `;
    })
    .join("");

  if (shouldStickToBottom) {
    chatList.scrollTop = chatList.scrollHeight;
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function refreshChat() {
  const response = await fetch("/api/chat/recent?limit=60");
  if (!response.ok) return;
  const data = await response.json();
  renderMessages(data.messages ?? []);
}

async function sendMessage(message) {
  const response = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to send message");
  }

  await refreshChat();
}

export function initChatPanel() {
  if (!chatForm || !chatInput) return;

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;

    chatInput.value = "";

    try {
      await sendMessage(message);
      chatInput.focus();
    } catch (error) {
      chatInput.value = message;
      console.error(error);
    }
  });

  void refreshChat();
  setInterval(() => {
    void refreshChat();
  }, 2000);
}
