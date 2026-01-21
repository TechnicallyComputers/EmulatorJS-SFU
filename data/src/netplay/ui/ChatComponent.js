/**
 * ChatComponent - In-game chat UI component
 *
 * Features:
 * - Docked/undocked chat interface
 * - Message formatting with sender continuation
 * - Emoji picker support
 * - Semi-transparent overlay
 * - Persistent chat when in rooms
 */

class ChatComponent {
  /**
   * @param {Object} emulator - The main emulator instance
   * @param {Object} netplayEngine - NetplayEngine instance
   * @param {Object} socketTransport - SocketTransport instance
   */
  constructor(emulator, netplayEngine, socketTransport) {
    this.emulator = emulator;
    this.netplayEngine = netplayEngine;
    this.socketTransport = socketTransport;

    // UI state
    this.isVisible = false;
    this.isDocked = true;
    this.isEmojiPickerVisible = false;

    // Message state
    this.messages = [];
    this.lastMessageSender = null;
    this.chatHistoryLoaded = false;

    // DOM elements
    this.chatTab = null;
    this.chatPanel = null;
    this.messagesContainer = null;
    this.inputField = null;
    this.sendButton = null;
    this.emojiButton = null;
    this.emojiPicker = null;
    this.undockButton = null;
    this.closeButton = null;

    // Drag state for undocked mode
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };

    // Resize state for undocked mode
    this.isResizing = false;
    this.resizeStart = { x: 0, y: 0, width: 0, height: 0 };

    // Bind methods
    this.handleMessage = this.handleMessage.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.toggleEmojiPicker = this.toggleEmojiPicker.bind(this);
    this.insertEmoji = this.insertEmoji.bind(this);
    this.toggleDock = this.toggleDock.bind(this);
    this.hide = this.hide.bind(this);
    this.handleKeyPress = this.handleKeyPress.bind(this);
    this.handleDragStart = this.handleDragStart.bind(this);
    this.handleDragMove = this.handleDragMove.bind(this);
    this.handleDragEnd = this.handleDragEnd.bind(this);
    this.handleResizeStart = this.handleResizeStart.bind(this);
    this.handleResizeMove = this.handleResizeMove.bind(this);
    this.handleResizeEnd = this.handleResizeEnd.bind(this);

    // Initialize UI
    this.createUI();

    // Load dock state from localStorage
    this.loadDockState();
  }

  /**
   * Create the chat UI elements
   */
  createUI() {
    // Create chat tab (right edge)
    this.chatTab = document.createElement('div');
    this.chatTab.className = 'ejs-chat-tab';
    this.chatTab.innerHTML = '💬';
    this.chatTab.title = 'Toggle Chat';
    this.chatTab.addEventListener('click', () => this.toggle());

    // Create chat panel
    this.chatPanel = document.createElement('div');
    this.chatPanel.className = 'ejs-chat-panel ejs-chat-docked';

    // Header with controls
    const header = document.createElement('div');
    header.className = 'ejs-chat-header';

    const title = document.createElement('div');
    title.className = 'ejs-chat-title';
    title.textContent = 'Room Chat';
    header.appendChild(title);

    this.undockButton = document.createElement('button');
    this.undockButton.className = 'ejs-chat-button ejs-chat-undock-btn';
    this.undockButton.innerHTML = '↗';
    this.undockButton.title = 'Undock Chat';
    this.undockButton.addEventListener('click', this.toggleDock);
    header.appendChild(this.undockButton);

    this.closeButton = document.createElement('button');
    this.closeButton.className = 'ejs-chat-button ejs-chat-close-btn';
    this.closeButton.innerHTML = '×';
    this.closeButton.title = 'Close Chat';
    this.closeButton.addEventListener('click', this.hide);
    header.appendChild(this.closeButton);

    this.chatPanel.appendChild(header);

    // Messages container
    this.messagesContainer = document.createElement('div');
    this.messagesContainer.className = 'ejs-chat-messages';
    this.chatPanel.appendChild(this.messagesContainer);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'ejs-chat-input-area';

    this.emojiButton = document.createElement('button');
    this.emojiButton.className = 'ejs-chat-button ejs-chat-emoji-btn';
    this.emojiButton.innerHTML = '😀';
    this.emojiButton.title = 'Emoji Picker';
    this.emojiButton.addEventListener('click', this.toggleEmojiPicker);
    inputArea.appendChild(this.emojiButton);

    this.inputField = document.createElement('input');
    this.inputField.className = 'ejs-chat-input';
    this.inputField.type = 'text';
    this.inputField.placeholder = 'Type a message...';
    this.inputField.maxLength = 500;
    this.inputField.addEventListener('keypress', this.handleKeyPress);
    inputArea.appendChild(this.inputField);

    this.sendButton = document.createElement('button');
    this.sendButton.className = 'ejs-chat-button ejs-chat-send-btn';
    this.sendButton.innerHTML = 'Send';
    this.sendButton.addEventListener('click', this.sendMessage);
    inputArea.appendChild(this.sendButton);

    this.chatPanel.appendChild(inputArea);

    // Create emoji picker
    this.createEmojiPicker();

    // Add drag handles for undocked mode
    this.createDragHandles();

    // Initially hide everything
    this.chatTab.style.display = 'none';
    this.chatPanel.style.display = 'none';
    this.emojiPicker.style.display = 'none';

    // Add to document
    document.body.appendChild(this.chatTab);
    document.body.appendChild(this.chatPanel);
    document.body.appendChild(this.emojiPicker);
  }

  /**
   * Create the emoji picker component
   */
  createEmojiPicker() {
    this.emojiPicker = document.createElement('div');
    this.emojiPicker.className = 'ejs-emoji-picker';

    // Common emojis for gaming/netplay
    const emojis = [
      '😀', '😂', '😊', '😉', '😎', '🤔', '😮', '😢', '😭', '😤',
      '👍', '👎', '👌', '✌️', '🤞', '👏', '🙌', '🤝', '💪', '🙏',
      '❤️', '💔', '💯', '🔥', '⭐', '⚡', '💎', '🎮', '🎯', '🏆',
      '🎉', '🎊', '🎈', '🎁', '🏠', '🚀', '⚽', '🏀', '🎾', '🎲'
    ];

    emojis.forEach(emoji => {
      const emojiBtn = document.createElement('button');
      emojiBtn.className = 'ejs-emoji-button';
      emojiBtn.textContent = emoji;
      emojiBtn.addEventListener('click', () => this.insertEmoji(emoji));
      this.emojiPicker.appendChild(emojiBtn);
    });
  }

  /**
   * Create drag handles for undocked mode
   */
  createDragHandles() {
    // Drag handle for moving the undocked panel
    const dragHandle = document.createElement('div');
    dragHandle.className = 'ejs-chat-drag-handle';
    dragHandle.addEventListener('mousedown', this.handleDragStart);

    // Resize handle for bottom-right corner
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'ejs-chat-resize-handle';
    resizeHandle.addEventListener('mousedown', this.handleResizeStart);

    this.chatPanel.appendChild(dragHandle);
    this.chatPanel.appendChild(resizeHandle);
  }

  /**
   * Show the chat interface
   */
  show() {
    if (this.isVisible) return;

    this.isVisible = true;
    this.chatTab.style.display = 'block';
    this.chatPanel.style.display = 'block';

    // Auto-open the panel when shown
    setTimeout(() => this.openPanel(), 100);

    // Focus input field
    setTimeout(() => this.inputField.focus(), 200);

    console.log('[ChatComponent] Chat shown');
  }

  /**
   * Hide the chat interface
   */
  hide() {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.closePanel();

    // Hide after animation
    setTimeout(() => {
      this.chatTab.style.display = 'none';
      this.chatPanel.style.display = 'none';
    }, 300);

    console.log('[ChatComponent] Chat hidden');
  }

  /**
   * Toggle chat panel visibility
   */
  toggle() {
    if (this.chatPanel.classList.contains('ejs-chat-open')) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  /**
   * Open the chat panel
   */
  openPanel() {
    this.chatPanel.classList.add('ejs-chat-open');
    setTimeout(() => this.inputField.focus(), 200);
  }

  /**
   * Close the chat panel
   */
  closePanel() {
    this.chatPanel.classList.remove('ejs-chat-open');
    this.emojiPicker.style.display = 'none';
    this.isEmojiPickerVisible = false;
  }

  /**
   * Toggle docked/undocked state
   */
  toggleDock() {
    this.isDocked = !this.isDocked;

    if (this.isDocked) {
      // Switch to docked mode
      this.chatPanel.classList.remove('ejs-chat-undocked');
      this.chatPanel.classList.add('ejs-chat-docked');
      this.undockButton.innerHTML = '↗';
      this.undockButton.title = 'Undock Chat';
    } else {
      // Switch to undocked mode
      this.chatPanel.classList.remove('ejs-chat-docked');
      this.chatPanel.classList.add('ejs-chat-undocked');
      this.undockButton.innerHTML = '↙';
      this.undockButton.title = 'Dock Chat';

      // Set initial undocked position if not set
      if (!this.chatPanel.style.left && !this.chatPanel.style.top) {
        this.chatPanel.style.left = '50px';
        this.chatPanel.style.top = '50px';
        this.chatPanel.style.width = '400px';
        this.chatPanel.style.height = '300px';
      }
    }

    // Save dock state
    this.saveDockState();

    console.log(`[ChatComponent] Chat ${this.isDocked ? 'docked' : 'undocked'}`);
  }

  /**
   * Toggle emoji picker visibility
   */
  toggleEmojiPicker() {
    this.isEmojiPickerVisible = !this.isEmojiPickerVisible;
    this.emojiPicker.style.display = this.isEmojiPickerVisible ? 'block' : 'none';

    if (this.isEmojiPickerVisible) {
      // Position emoji picker below emoji button
      const buttonRect = this.emojiButton.getBoundingClientRect();
      this.emojiPicker.style.left = buttonRect.left + 'px';
      this.emojiPicker.style.bottom = (window.innerHeight - buttonRect.top + 10) + 'px';
    }
  }

  /**
   * Insert emoji at cursor position in input field
   */
  insertEmoji(emoji) {
    const start = this.inputField.selectionStart;
    const end = this.inputField.selectionEnd;
    const text = this.inputField.value;
    const before = text.substring(0, start);
    const after = text.substring(end);

    this.inputField.value = before + emoji + after;
    this.inputField.selectionStart = this.inputField.selectionEnd = start + emoji.length;
    this.inputField.focus();

    // Hide emoji picker after selection
    this.toggleEmojiPicker();
  }

  /**
   * Handle incoming chat messages
   */
  handleMessage(message) {
    console.log('[ChatComponent] Received message:', message);

    // Add message to local history
    this.messages.push(message);

    // Limit local message history
    if (this.messages.length > 100) {
      this.messages = this.messages.slice(-100);
    }

    // Add to UI
    this.addMessageToUI(message);

    // Auto-scroll to bottom if panel is open
    if (this.chatPanel.classList.contains('ejs-chat-open')) {
      setTimeout(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }, 100);
    }
  }

  /**
   * Add a message to the UI
   */
  addMessageToUI(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'ejs-chat-message';
    messageDiv.setAttribute('data-userid', message.userid);
    messageDiv.setAttribute('data-message-id', message.messageId);

    // Check if this is a continuation (same sender as previous message)
    const isContinuation = this.lastMessageSender === message.userid;

    if (!isContinuation) {
      // New sender - show name
      const senderSpan = document.createElement('span');
      senderSpan.className = 'ejs-chat-sender';
      senderSpan.textContent = message.playerName + ': ';
      messageDiv.appendChild(senderSpan);
    }

    // Add message text
    const textSpan = document.createElement('span');
    textSpan.className = 'ejs-chat-text';
    textSpan.textContent = message.message;
    messageDiv.appendChild(textSpan);

    // Add timestamp (optional, could be shown on hover)
    messageDiv.title = new Date(message.timestamp).toLocaleTimeString();

    this.messagesContainer.appendChild(messageDiv);

    // Update last sender for continuation logic
    this.lastMessageSender = message.userid;

    // Limit DOM nodes for performance
    while (this.messagesContainer.children.length > 100) {
      this.messagesContainer.removeChild(this.messagesContainer.firstChild);
    }
  }

  /**
   * Send a message
   */
  sendMessage() {
    const message = this.inputField.value.trim();
    if (!message) return;

    if (this.socketTransport && this.socketTransport.socket && this.socketTransport.socket.connected) {
      console.log('[ChatComponent] Sending message:', message);

      this.socketTransport.socket.emit('chat-message', {
        message: message
      });

      // Clear input
      this.inputField.value = '';
      this.inputField.focus();
    } else {
      console.warn('[ChatComponent] Cannot send message: socket not connected');
    }
  }

  /**
   * Handle key press in input field
   */
  handleKeyPress(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.sendMessage();
    } else if (event.key === 'Escape') {
      this.toggleEmojiPicker(); // Close emoji picker if open
    }
  }

  /**
   * Handle drag start for undocked panel
   */
  handleDragStart(event) {
    if (this.isDocked) return;

    this.isDragging = true;
    const rect = this.chatPanel.getBoundingClientRect();
    this.dragOffset.x = event.clientX - rect.left;
    this.dragOffset.y = event.clientY - rect.top;

    document.addEventListener('mousemove', this.handleDragMove);
    document.addEventListener('mouseup', this.handleDragEnd);

    event.preventDefault();
  }

  /**
   * Handle drag move
   */
  handleDragMove(event) {
    if (!this.isDragging) return;

    const newLeft = event.clientX - this.dragOffset.x;
    const newTop = event.clientY - this.dragOffset.y;

    // Constrain to viewport
    const rect = this.chatPanel.getBoundingClientRect();
    const constrainedLeft = Math.max(0, Math.min(window.innerWidth - rect.width, newLeft));
    const constrainedTop = Math.max(0, Math.min(window.innerHeight - rect.height, newTop));

    this.chatPanel.style.left = constrainedLeft + 'px';
    this.chatPanel.style.top = constrainedTop + 'px';
  }

  /**
   * Handle drag end
   */
  handleDragEnd() {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
    this.saveDockState();
  }

  /**
   * Handle resize start
   */
  handleResizeStart(event) {
    if (this.isDocked) return;

    this.isResizing = true;
    const rect = this.chatPanel.getBoundingClientRect();
    this.resizeStart.x = event.clientX;
    this.resizeStart.y = event.clientY;
    this.resizeStart.width = rect.width;
    this.resizeStart.height = rect.height;

    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);

    event.preventDefault();
  }

  /**
   * Handle resize move
   */
  handleResizeMove(event) {
    if (!this.isResizing) return;

    const deltaX = event.clientX - this.resizeStart.x;
    const deltaY = event.clientY - this.resizeStart.y;

    const newWidth = Math.max(300, this.resizeStart.width + deltaX);
    const newHeight = Math.max(200, this.resizeStart.height + deltaY);

    this.chatPanel.style.width = newWidth + 'px';
    this.chatPanel.style.height = newHeight + 'px';
  }

  /**
   * Handle resize end
   */
  handleResizeEnd() {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    this.saveDockState();
  }

  /**
   * Save dock state to localStorage
   */
  saveDockState() {
    const state = {
      isDocked: this.isDocked,
      left: this.chatPanel.style.left,
      top: this.chatPanel.style.top,
      width: this.chatPanel.style.width,
      height: this.chatPanel.style.height
    };
    localStorage.setItem('ejs-chat-dock-state', JSON.stringify(state));
  }

  /**
   * Load dock state from localStorage
   */
  loadDockState() {
    try {
      const state = JSON.parse(localStorage.getItem('ejs-chat-dock-state'));
      if (state) {
        this.isDocked = state.isDocked !== false; // Default to docked
        if (!this.isDocked && state.left && state.top) {
          this.chatPanel.style.left = state.left;
          this.chatPanel.style.top = state.top;
          this.chatPanel.style.width = state.width || '400px';
          this.chatPanel.style.height = state.height || '300px';
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }

  /**
   * Clear all messages (for room changes)
   */
  clearMessages() {
    this.messages = [];
    this.lastMessageSender = null;
    this.messagesContainer.innerHTML = '';
  }

  /**
   * Cleanup and destroy the component
   */
  destroy() {
    this.hide();

    // Remove event listeners
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);

    // Remove DOM elements
    if (this.chatTab && this.chatTab.parentNode) {
      this.chatTab.parentNode.removeChild(this.chatTab);
    }
    if (this.chatPanel && this.chatPanel.parentNode) {
      this.chatPanel.parentNode.removeChild(this.chatPanel);
    }
    if (this.emojiPicker && this.emojiPicker.parentNode) {
      this.emojiPicker.parentNode.removeChild(this.emojiPicker);
    }

    console.log('[ChatComponent] Destroyed');
  }
}