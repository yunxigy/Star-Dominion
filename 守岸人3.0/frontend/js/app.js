/**
 * 守岸人 2.0 - 主入口
 * 依赖: auth.js, api.js, storage.js, toast.js
 */

// ==================== 状态 ====================
const state = {
  characters: [],
  currentCharacter: null,
  currentSessionId: null,
  chatVersion: 1,
  branches: [],
  checkpoints: [],
  isSending: false,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  initParticles();
  initInputHandlers();
  await loadCharacters();
  await loadSettings();
});

// ==================== 角色卡管理 ====================
async function loadCharacters() {
  try {
    state.characters = await API.get('/api/characters');
    renderCharacterList();
    // 自动选择第一个角色
    if (state.characters.length > 0 && !state.currentCharacter) {
      await selectCharacter(state.characters[0].id);
    }
  } catch (e) {
    console.error('加载角色列表失败:', e);
  }
}

function renderCharacterList() {
  const list = document.getElementById('character-list');
  list.innerHTML = state.characters.map(c => `
    <div class="char-card ${state.currentCharacter?.id === c.id ? 'active' : ''}"
         onclick="selectCharacter('${escapeAttr(c.id)}')">
      <img src="${c.avatar || c.avatar_url ? `/avatars/${escapeAttr(c.avatar || c.avatar_url.replace('/avatars/', ''))}` : '/static/守岸人头像.jpg'}"
           onerror="this.src='/static/守岸人头像.jpg'">
      <div class="char-info">
        <div class="char-name">${escapeHtml(c.name)}</div>
        <div class="char-desc">${escapeHtml(c.description || c.personality || '')}</div>
      </div>
    </div>
  `).join('');
}

async function selectCharacter(charId) {
  try {
    const data = await API.post(`/api/chat/characters/${charId}/select`);
    state.currentCharacter = data.character;
    state.currentSessionId = data.session_id;
    renderCharacterList();
    updateTopBar();
    await loadChatHistory();
    // 播放首条消息
    if (state.currentCharacter.first_mes && state.currentCharacter.first_mes.trim()) {
      addMessage('ai', state.currentCharacter.first_mes);
    }
  } catch (e) {
    console.error('切换角色失败:', e);
  }
}

function updateTopBar() {
  const c = state.currentCharacter;
  if (!c) return;
  document.getElementById('top-char-name').textContent = c.name;
  document.getElementById('top-char-avatar').src = c.avatar ? `/avatars/${c.avatar}` : '/static/default-avatar.png';
}

// ==================== 对话 ====================
async function loadChatHistory() {
  try {
    const params = state.currentSessionId
      ? `?session_id=${encodeURIComponent(state.currentSessionId)}`
      : '';
    const history = await API.get(`/api/chat/history${params}`);
    const container = document.getElementById('chat-container');
    container.innerHTML = '';
    history.forEach(msg => {
      addMessage(
        msg.role === 'user' ? 'user' : 'ai',
        msg.content,
        false,
        msg.id,
        msg.swipes,
        msg.swipe_id,
        {
          branch_id: msg.branch_id,
          parent_message_id: msg.parent_message_id,
          created_at: msg.created_at,
          edited_at: msg.edited_at,
        },
      );
    });
    await refreshChatTools();
    scrollToBottom();
  } catch (e) {
    console.error('加载对话历史失败:', e);
  }
}

function addMessage(role, text, animate = true, messageId = null, swipes = null, swipeId = 0, metadata = {}) {
  const container = document.getElementById('chat-container');
  const welcome = document.getElementById('welcome-screen');
  if (welcome) welcome.style.display = 'none';

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';
  if (messageId) row.dataset.messageId = messageId;
  if (metadata.branch_id) row.dataset.branchId = metadata.branch_id;
  if (metadata.parent_message_id) row.dataset.parentMessageId = metadata.parent_message_id;

  const c = state.currentCharacter;
  const avatarSrc = role === 'ai' && c?.avatar ? `/avatars/${c.avatar}` : '/static/守岸人头像.jpg';

  const img = document.createElement('img');
  img.src = avatarSrc;
  img.alt = role === 'ai' ? (c?.name || '守岸人') : '';
  img.className = `avatar ${role === 'ai' ? 'ai-avatar' : 'user-avatar'}`;
  img.onerror = function() { this.src = '/static/default-avatar.png'; };

  // 气泡容器
  const bubbleWrap = document.createElement('div');
  bubbleWrap.className = 'bubble-wrap';

  const bubble = document.createElement('div');
  bubble.className = `bubble-content ${role}`;
  renderBubbleContent(bubble, text, role);

  bubbleWrap.appendChild(bubble);

  if (messageId) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.setAttribute('aria-label', '消息操作');
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = '编辑';
    editButton.onclick = () => editChatMessage(messageId);
    const checkpointButton = document.createElement('button');
    checkpointButton.type = 'button';
    checkpointButton.textContent = '检查点';
    checkpointButton.onclick = () => createChatCheckpoint(messageId);
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '删除后续';
    deleteButton.onclick = () => deleteChatMessage(messageId);
    actions.append(editButton, checkpointButton, deleteButton);
    bubbleWrap.appendChild(actions);
  }

  // AI 消息加滑动控件
  if (role === 'ai' && messageId) {
    const swipeData = swipes || [text];
    const currentId = Number.isInteger(Number(swipeId)) ? Number(swipeId) : 0;

    const swipeNav = document.createElement('div');
    swipeNav.className = 'swipe-nav';
    swipeNav.innerHTML = `
      <button class="swipe-btn swipe-prev" onclick="swipeMessage('${messageId}', -1)" ${currentId <= 0 ? 'disabled' : ''}>◀</button>
      <span class="swipe-counter">${currentId + 1}/${swipeData.length}</span>
      <button class="swipe-btn swipe-next" onclick="swipeMessage('${messageId}', 1)">▶</button>
      <button class="swipe-btn swipe-regen" onclick="regenerateMessage('${messageId}')" title="重新生成">🔄</button>
    `;
    bubbleWrap.appendChild(swipeNav);

    // 存储 swipe 数据
    row.dataset.swipes = JSON.stringify(swipeData);
    row.dataset.swipeId = currentId;
  }

  if (role === 'ai') row.appendChild(img);
  row.appendChild(bubbleWrap);

  container.appendChild(row);
  scrollToBottom();
  return row;
}

function renderBubbleContent(bubble, text, role) {
  if (role === 'ai' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    bubble.innerHTML = DOMPurify.sanitize(marked.parse(text));
  } else {
    bubble.textContent = text;
  }
}

async function swipeMessage(messageId, direction) {
  const row = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!row) return;

  const swipes = JSON.parse(row.dataset.swipes || '[]');
  let currentId = parseInt(row.dataset.swipeId || '0');
  const newId = currentId + direction;

  if (newId < 0) return;
  if (newId >= swipes.length) {
    // 需要生成新的 swipe
    await regenerateMessage(messageId);
    return;
  }

  // 切换显示
  const bubble = row.querySelector('.bubble-content');
  renderBubbleContent(bubble, swipes[newId], 'ai');
  row.dataset.swipeId = newId;

  // 更新计数器
  const counter = row.querySelector('.swipe-counter');
  if (counter) counter.textContent = `${newId + 1}/${swipes.length}`;

  // 更新按钮状态
  const prevBtn = row.querySelector('.swipe-prev');
  if (prevBtn) prevBtn.disabled = newId <= 0;

  // 同步到后端
  const formData = new FormData();
  formData.append('message_id', messageId);
  formData.append('swipe_id', newId);
  await API.putForm('/api/chat/swipe', formData);
}

async function regenerateMessage(messageId) {
  const row = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!row) return;

  const formData = new FormData();
  formData.append('version', String(state.chatVersion));

  const regenBtn = row.querySelector('.swipe-regen');
  if (regenBtn) regenBtn.disabled = true;

  try {
    const data = await API.postForm(`/api/chat/messages/${encodeURIComponent(messageId)}/regenerate`, formData);
    if (data) {
      const swipes = data.swipes || [];
      row.dataset.swipes = JSON.stringify(swipes);
      row.dataset.swipeId = data.swipe_id;

      const bubble = row.querySelector('.bubble-content');
      renderBubbleContent(bubble, data.content, 'ai');

      const counter = row.querySelector('.swipe-counter');
      if (counter) counter.textContent = `${data.swipe_id + 1}/${swipes.length}`;

      const prevBtn = row.querySelector('.swipe-prev');
      if (prevBtn) prevBtn.disabled = false;
    }
  } catch (e) {
    await handleChatMutationError(e, '重新生成失败');
  } finally {
    if (regenBtn) regenBtn.disabled = false;
  }
}

const chatChannel = 'BroadcastChannel' in window
  ? new BroadcastChannel('shouanren-chat-updates')
  : null;

if (chatChannel) {
  chatChannel.addEventListener('message', async (event) => {
    if (event.data?.sessionId !== state.currentSessionId) return;
    Toast.show('对话已在其他页面更新，正在重新加载');
    await loadChatHistory();
  });
}

function notifyChatUpdated() {
  chatChannel?.postMessage({ sessionId: state.currentSessionId });
}

async function handleChatMutationError(error, label = '操作失败') {
  if (error.status === 409) {
    Toast.show('对话已在其他页面更新，正在重新加载');
    await loadChatHistory();
    return;
  }
  Toast.error(`${label}: ${error.message}`);
}

async function refreshChatTools() {
  const branchSelect = document.getElementById('branch-select');
  const checkpointList = document.getElementById('checkpoint-list');
  if (!state.currentSessionId) {
    if (branchSelect) branchSelect.innerHTML = '';
    if (checkpointList) checkpointList.innerHTML = '';
    return;
  }
  try {
    const sessionId = encodeURIComponent(state.currentSessionId);
    const [branchData, checkpointData] = await Promise.all([
      API.get(`/api/chat/sessions/${sessionId}/branches`),
      API.get(`/api/chat/sessions/${sessionId}/checkpoints`),
    ]);
    state.branches = branchData.items || [];
    state.checkpoints = checkpointData.items || [];
    state.chatVersion = Math.max(branchData.version || 1, checkpointData.version || 1);
    if (branchSelect) {
      branchSelect.innerHTML = '';
      state.branches.forEach((branch) => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name || '未命名分支';
        option.selected = Boolean(branch.is_active);
        branchSelect.appendChild(option);
      });
    }
    renderCheckpointList();
  } catch (error) {
    console.error('加载对话管理信息失败:', error);
  }
}

function renderCheckpointList() {
  const list = document.getElementById('checkpoint-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.checkpoints.length) {
    list.textContent = '还没有检查点';
    return;
  }
  state.checkpoints.forEach((checkpoint) => {
    const item = document.createElement('div');
    item.className = 'checkpoint-item';
    const label = document.createElement('span');
    label.textContent = checkpoint.name;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = '恢复';
    restore.onclick = () => restoreChatCheckpoint(checkpoint.id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.onclick = () => deleteChatCheckpoint(checkpoint.id);
    item.append(label, restore, remove);
    list.appendChild(item);
  });
}

async function editChatMessage(messageId) {
  const row = document.querySelector(`[data-message-id="${messageId}"]`);
  const current = row?.querySelector('.bubble-content')?.textContent?.trim() || '';
  const content = prompt('编辑消息（原内容会保留在旧分支）', current);
  if (content === null || !content.trim()) return;
  try {
    const data = await API.patch(`/api/chat/messages/${encodeURIComponent(messageId)}`, {
      content: content.trim(),
      version: state.chatVersion,
    });
    state.chatVersion = data.version;
    notifyChatUpdated();
    await loadChatHistory();
  } catch (error) {
    await handleChatMutationError(error, '编辑失败');
  }
}

async function deleteChatMessage(messageId) {
  if (!confirm('从这条消息开始移出当前分支？原分支仍可恢复。')) return;
  try {
    const data = await API.del(`/api/chat/messages/${encodeURIComponent(messageId)}`, {
      version: state.chatVersion,
    });
    state.chatVersion = data.version;
    notifyChatUpdated();
    await loadChatHistory();
  } catch (error) {
    await handleChatMutationError(error, '删除失败');
  }
}

async function activateChatBranch(branchId) {
  if (!branchId || !state.currentSessionId) return;
  try {
    const data = await API.post(
      `/api/chat/sessions/${encodeURIComponent(state.currentSessionId)}/branches/${encodeURIComponent(branchId)}/activate`,
      { version: state.chatVersion },
    );
    state.chatVersion = data.version;
    notifyChatUpdated();
    await loadChatHistory();
  } catch (error) {
    await handleChatMutationError(error, '切换分支失败');
  }
}

async function createChatCheckpoint(messageId = null) {
  if (!state.currentSessionId) return;
  const name = prompt('检查点名称', '新的检查点');
  if (name === null || !name.trim()) return;
  try {
    const data = await API.post(
      `/api/chat/sessions/${encodeURIComponent(state.currentSessionId)}/checkpoints`,
      { name: name.trim(), message_id: messageId, version: state.chatVersion },
    );
    state.chatVersion = data.version;
    notifyChatUpdated();
    await refreshChatTools();
  } catch (error) {
    await handleChatMutationError(error, '创建检查点失败');
  }
}

async function restoreChatCheckpoint(checkpointId) {
  try {
    const data = await API.post(
      `/api/chat/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
      { version: state.chatVersion },
    );
    state.chatVersion = data.version;
    notifyChatUpdated();
    await loadChatHistory();
  } catch (error) {
    await handleChatMutationError(error, '恢复检查点失败');
  }
}

async function deleteChatCheckpoint(checkpointId) {
  if (!confirm('删除这个检查点？')) return;
  try {
    const data = await API.del(`/api/chat/checkpoints/${encodeURIComponent(checkpointId)}`, {
      version: state.chatVersion,
    });
    state.chatVersion = data.version;
    notifyChatUpdated();
    await refreshChatTools();
  } catch (error) {
    await handleChatMutationError(error, '删除检查点失败');
  }
}

async function searchChats() {
  const input = document.getElementById('chat-search-input');
  const results = document.getElementById('chat-search-results');
  const query = input?.value.trim();
  if (!query || !results) return;
  try {
    const data = await API.get(`/api/chat/search?q=${encodeURIComponent(query)}`);
    results.innerHTML = '';
    if (!data.items.length) {
      results.textContent = '没有匹配消息';
      return;
    }
    data.items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';
      button.textContent = item.snippet;
      button.onclick = async () => {
        state.currentSessionId = item.session_id;
        await loadChatHistory();
      };
      results.appendChild(button);
    });
  } catch (error) {
    Toast.error(`搜索失败: ${error.message}`);
  }
}

async function exportChatBackup() {
  if (!state.currentSessionId) return;
  try {
    const payload = await API.get(`/api/chat/sessions/${encodeURIComponent(state.currentSessionId)}/backup`);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `shouanren-${state.currentSessionId.slice(0, 8)}-backup.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    Toast.error(`备份导出失败: ${error.message}`);
  }
}

async function importChatBackup(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  try {
    const data = await API.postForm('/api/chat/backup/import', body);
    state.currentSessionId = data.session_id;
    await loadChatHistory();
    Toast.show('完整备份已导入');
  } catch (error) {
    Toast.error(`备份导入失败: ${error.message}`);
  } finally {
    input.value = '';
  }
}

function addLoadingMessage() {
  const container = document.getElementById('chat-container');
  const row = document.createElement('div');
  row.className = 'message-row ai';
  row.id = 'loading-msg';
  const c = state.currentCharacter;
  row.innerHTML = `
    <img class="avatar ai-avatar" src="${c?.avatar ? `/avatars/${c.avatar}` : '/static/守岸人头像.jpg'}" onerror="this.src='/static/default-avatar.png'">
    <div class="bubble-content ai">
      <span class="loading">守岸人正在连接泰提斯系统...</span>
    </div>
  `;
  container.appendChild(row);
  scrollToBottom();
}

function removeLoadingMessage() {
  const el = document.getElementById('loading-msg');
  if (el) el.remove();
}

// ========== 斜杠命令 ==========

async function handleSlashCommand(text) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].slice(1).toLowerCase();
  const args = parts.slice(1).join(' ');

  // 本地命令快速响应
  const localCommands = {
    'help': '可用命令：\n`/help` - 显示帮助\n`/clear` - 清空对话\n`/export` - 导出对话\n`/character` - 角色信息\n`/swipe` - 重新生成\n`/backend` - 切换后端',
    '帮助': '输入 `/help` 查看所有命令',
  };

  if (localCommands[cmd]) {
    addMessage('user', text);
    addMessage('ai', localCommands[cmd]);
    return;
  }

  // clear 命令本地执行
  if (cmd === 'clear' || cmd === '清空') {
    addMessage('user', text);
    await clearChatHistory();
    addMessage('ai', '对话历史已清空');
    return;
  }

  // swipe 命令 - 重新生成最后一条 AI 消息
  if (cmd === 'swipe' || cmd === '重写' || cmd === 'regen') {
    const lastAiMsg = document.querySelector('.message-row.ai:last-of-type');
    if (lastAiMsg?.dataset.messageId) {
      await regenerateMessage(lastAiMsg.dataset.messageId);
    }
    return;
  }

  // 其他命令发送到后端
  addMessage('user', text);
  try {
    const formData = new FormData();
    formData.append('command', text);
    formData.append('session_id', state.currentSessionId || '');
    formData.append('character_name', state.currentCharacter?.name || '');
    const data = await API.postForm('/api/commands/execute', formData);
    if (data.result) {
      addMessage('ai', data.result);
    } else if (data.error) {
      addMessage('ai', `❌ ${data.error}`);
    }
  } catch (e) {
    addMessage('ai', `命令执行失败: ${e.message}`);
  }
}

async function sendMessage(text) {
  if (state.isSending || !text.trim()) return;

  // 斜杠命令处理
  if (text.startsWith('/')) {
    await handleSlashCommand(text);
    return;
  }

  if (!state.currentCharacter) { alert('请先选择一个角色'); return; }

  state.isSending = true;
  document.getElementById('send-btn').disabled = true;
  addMessage('user', text);
  addLoadingMessage();

  try {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('tts_mode', 'async');
    if (state.currentSessionId) {
      formData.append('session_id', state.currentSessionId);
    } else if (state.currentCharacter?.id) {
      formData.append('character_id', state.currentCharacter.id);
    }

    const data = await API.postForm('/api/chat', formData);

    removeLoadingMessage();
    state.currentSessionId = data.session_id || state.currentSessionId;
    await loadChatHistory();
    const row = document.querySelector(`[data-message-id="${data.message_id}"]`);

    if (row && data.audio_url) {
      addAudioButton(row, data.audio_url, false);
    } else if (row && data.tts_task_id) {
      addTTSStatusButton(row, data.tts_task_id);
    }
  } catch (e) {
    removeLoadingMessage();
    addMessage('ai', `发送失败: ${e.message}`);
  } finally {
    state.isSending = false;
    document.getElementById('send-btn').disabled = false;
  }
}

async function sendAudio(audioBlob) {
  if (state.isSending) return;
  if (!state.currentCharacter) { alert('请先选择一个角色'); return; }

  state.isSending = true;
  document.getElementById('send-btn').disabled = true;
  addLoadingMessage();

  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('tts_mode', 'async');
    if (state.currentSessionId) {
      formData.append('session_id', state.currentSessionId);
    } else if (state.currentCharacter?.id) {
      formData.append('character_id', state.currentCharacter.id);
    }

    const data = await API.postForm('/api/chat', formData);

    removeLoadingMessage();
    state.currentSessionId = data.session_id || state.currentSessionId;
    await loadChatHistory();
    const row = document.querySelector(`[data-message-id="${data.message_id}"]`);
    if (row && data.audio_url) addAudioButton(row, data.audio_url, false);
    else if (row && data.tts_task_id) addTTSStatusButton(row, data.tts_task_id);
  } catch (e) {
    removeLoadingMessage();
    addMessage('ai', `发送失败: ${e.message}`);
  } finally {
    state.isSending = false;
    document.getElementById('send-btn').disabled = false;
  }
}

async function clearChatHistory() {
  if (!confirm('确定要清空对话历史吗？')) return;

  try {
    let params = '';
    if (state.currentSessionId) {
      params = `?session_id=${state.currentSessionId}`;
    } else if (state.currentCharacter?.id) {
      params = `?character_id=${state.currentCharacter.id}`;
    }

    const data = await API.del(`/api/chat/history${params}`, {
      version: state.chatVersion,
    });
    state.chatVersion = data.version;
    notifyChatUpdated();
    await loadChatHistory();

    if (state.currentCharacter?.first_mes) {
      setTimeout(() => {
        addMessage('ai', state.currentCharacter.first_mes);
      }, 300);
    }
  } catch (e) {
    Toast.error('清空失败: ' + e.message);
  }
}

function addAudioButton(messageRow, audioUrl, autoPlay = true) {
  const bubble = messageRow.querySelector('.bubble-content');

  const player = document.createElement('div');
  player.className = 'audio-player';

  const btn = document.createElement('button');
  btn.className = 'audio-btn';
  btn.innerHTML = '▶';
  btn.title = '播放语音';

  const label = document.createElement('span');
  label.className = 'audio-text';
  label.innerText = '播放语音';

  let audio = null;
  let isPlaying = false;

  btn.addEventListener('click', () => {
    if (isPlaying && audio) {
      audio.pause();
      btn.innerHTML = '▶';
      btn.classList.remove('playing');
      isPlaying = false;
    } else {
      if (!audio) {
        audio = new Audio(audioUrl);
        audio.addEventListener('ended', () => {
          btn.innerHTML = '▶';
          btn.classList.remove('playing');
          isPlaying = false;
        });
      }
      audio.play();
      btn.innerHTML = '⏸';
      btn.classList.add('playing');
      isPlaying = true;
    }
  });

  player.appendChild(btn);
  player.appendChild(label);
  bubble.appendChild(player);

  // 自动播放（仅同步模式）
  if (autoPlay) {
    setTimeout(() => {
      audio = new Audio(audioUrl);
      audio.play().catch(() => {});
      btn.innerHTML = '⏸';
      btn.classList.add('playing');
      isPlaying = true;
      audio.addEventListener('ended', () => {
        btn.innerHTML = '▶';
        btn.classList.remove('playing');
        isPlaying = false;
      });
    }, 300);
  }
}

// TTS 异步状态按钮
function addTTSStatusButton(messageRow, taskId) {
  const bubble = messageRow.querySelector('.bubble-content');

  const player = document.createElement('div');
  player.className = 'audio-player';
  player.id = `tts-player-${taskId}`;

  const btn = document.createElement('button');
  btn.className = 'audio-btn';
  btn.innerHTML = '⏳';
  btn.title = '音频准备中';
  btn.disabled = true;

  const label = document.createElement('span');
  label.className = 'audio-text tts-pending';
  label.innerText = '音频准备中...';

  player.appendChild(btn);
  player.appendChild(label);
  bubble.appendChild(player);

  // 开始轮询
  pollTTSStatus(taskId, messageRow);
}

// 轮询 TTS 状态
async function pollTTSStatus(taskId, messageRow) {
  const maxAttempts = 60; // 最多轮询60次
  let attempts = 0;

  const poll = async () => {
    if (attempts >= maxAttempts) {
      updateTTSStatus(taskId, 'failed', null, '音频生成超时');
      return;
    }
    attempts++;

    try {
      const data = await API.get(`/api/chat/tts-status/${taskId}`);

      if (data.status === 'completed' && data.audio_url) {
        updateTTSStatus(taskId, 'completed', data.audio_url);
        return;
      } else if (data.status === 'failed') {
        updateTTSStatus(taskId, 'failed', null, data.error || '生成失败');
        return;
      }

      setTimeout(poll, 1000);
    } catch (e) {
      setTimeout(poll, 2000);
    }
  };

  setTimeout(poll, 500); // 500ms 后开始第一次轮询
}

// 更新 TTS 状态显示
function updateTTSStatus(taskId, status, audioUrl, error) {
  const player = document.getElementById(`tts-player-${taskId}`);
  if (!player) return;

  const btn = player.querySelector('.audio-btn');
  const label = player.querySelector('.audio-text');

  if (status === 'completed' && audioUrl) {
    // 音频已就绪 - 替换为可播放的按钮
    const bubble = player.parentElement;
    player.remove();

    // 找到对应的消息行
    const messageRow = bubble.closest('.message-row');
    if (messageRow) {
      addAudioButton(messageRow, audioUrl, false); // 不自动播放
    }
  } else if (status === 'failed') {
    btn.innerHTML = '❌';
    btn.title = '音频生成失败';
    btn.disabled = true;
    label.innerText = error || '音频生成失败';
    label.className = 'audio-text tts-failed';
  }
}

// ==================== 语音录制 ====================
async function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = e => state.audioChunks.push(e.data);
    state.mediaRecorder.onstop = () => {
      const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
      sendAudio(blob);
      stream.getTracks().forEach(t => t.stop());
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    document.getElementById('mic-btn').classList.add('recording');
  } catch (e) {
    alert('无法访问麦克风: ' + e.message);
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
  }
}

// ==================== 输入处理 ====================
function initInputHandlers() {
  const input = document.getElementById('text-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) { sendMessage(text); input.value = ''; }
    }
  });

  document.getElementById('send-btn').onclick = () => {
    const text = input.value.trim();
    if (text) { sendMessage(text); input.value = ''; }
  };

  document.getElementById('mic-btn').onclick = toggleRecording;
}

// ==================== 设置 ====================
async function loadSettings() {
  try {
    const settings = await API.get('/api/settings');
    if (settings.llm?.backends) {
      const select = document.getElementById('settings-backend');
      select.innerHTML = '';
      for (const [name, cfg] of Object.entries(settings.llm.backends)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `${name} (${cfg.model || ''})`;
        if (name === settings.llm?.default_backend) opt.selected = true;
        select.appendChild(opt);
      }
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }
}

function openSettings() { document.getElementById('settings-modal').classList.add('active'); }
function closeSettings() { document.getElementById('settings-modal').classList.remove('active'); }

async function saveSettings() {
  const backend = document.getElementById('settings-backend').value;
  try {
    await API.put('/api/settings', { llm: { default_backend: backend } });
    closeSettings();
  } catch (e) {
    Toast.error('保存设置失败');
  }
}

// ==================== 角色卡编辑 ====================
function openCharacterModal(charId = null) {
  const modal = document.getElementById('char-modal');
  const form = document.getElementById('char-form');
  form.reset();

  if (charId) {
    const c = state.characters.find(ch => ch.id === charId);
    if (c) {
      document.getElementById('char-modal-title').textContent = '编辑角色';
      document.getElementById('char-id').value = c.id;
      document.getElementById('char-name').value = c.name;
      document.getElementById('char-description').value = c.description || '';
      document.getElementById('char-personality').value = c.personality || '';
      document.getElementById('char-system-prompt').value = c.system_prompt || '';
      document.getElementById('char-first-mes').value = c.first_mes || '';
      document.getElementById('char-tts-model').value = c.tts?.model || 'mimo-v2.5-tts-voiceclone';
      document.getElementById('char-tts-voice').value = c.tts?.voice || '冰糖';
      document.getElementById('char-tts-style').value = c.tts?.style_prompt || '';
      // 显示当前参考音频
      const voiceInfo = document.getElementById('current-voice');
      if (c.tts?.ref_audio_filename) {
        voiceInfo.textContent = `当前参考音频: ${c.tts.ref_audio_filename}`;
      } else if (c.tts?.model === 'mimo-v2.5-tts') {
        voiceInfo.textContent = `预置音色: ${c.tts?.voice || '冰糖'}`;
      } else {
        voiceInfo.textContent = '未设置参考音频';
      }
    }
  } else {
    document.getElementById('char-modal-title').textContent = '创建角色';
    document.getElementById('char-id').value = '';
    document.getElementById('current-voice').textContent = '';
  }

  modal.classList.add('active');
}

function closeCharacterModal() {
  document.getElementById('char-modal').classList.remove('active');
}

async function saveCharacter() {
  const form = document.getElementById('char-form');
  const formData = new FormData(form);
  const charId = document.getElementById('char-id').value;
  const voiceFile = document.getElementById('char-voice-file').files[0];

  try {
    let data;
    if (charId) {
      data = await API.putForm(`/api/characters/${charId}`, formData);
    } else {
      data = await API.postForm('/api/characters', formData);
    }
    const id = data.id || charId;

    if (voiceFile && id) {
      const voiceForm = new FormData();
      voiceForm.append('file', voiceFile);
      await API.postForm(`/api/characters/${id}/voice`, voiceForm);
    }

    closeCharacterModal();
    await loadCharacters();
  } catch (e) {
    Toast.error('保存角色失败: ' + e.message);
  }
}

async function deleteCharacter(charId) {
  if (!confirm('确定要删除这个角色吗？')) return;
  try {
    await API.del(`/api/characters/${charId}`);
    if (state.currentCharacter?.id === charId) state.currentCharacter = null;
    await loadCharacters();
  } catch (e) {
    Toast.error('删除失败: ' + e.message);
  }
}

// ==================== 粒子特效 ====================
function initParticles() {
  const layer = document.getElementById('effects-layer');
  // 花瓣
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle petal';
    const size = Math.random() * 8 + 4;
    p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;animation-duration:${Math.random()*10+8}s;animation-delay:${Math.random()*10}s;`;
    layer.appendChild(p);
  }
  // 气泡
  for (let i = 0; i < 20; i++) {
    const b = document.createElement('div');
    b.className = 'particle bubble';
    const size = Math.random() * 12 + 4;
    b.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;animation-duration:${Math.random()*12+6}s;animation-delay:${Math.random()*8}s;`;
    layer.appendChild(b);
  }
}

// ==================== 工具函数 ====================
function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function escapeAttr(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function scrollToBottom() {
  const c = document.getElementById('chat-container');
  c.scrollTop = c.scrollHeight;
}

// ========== 角色卡导入导出 ==========

function importCharacter() {
  document.getElementById('import-file').click();
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const data = await API.postForm('/api/characters/import', formData);
    Toast.show(`角色「${data.name}」导入成功`, 'success');
    await loadCharacters();
  } catch (e) {
    Toast.show('导入失败: ' + e.message, 'error');
  }

  input.value = '';
}

function exportCharacter(charId, format) {
  const url = `/api/characters/${charId}/export/${format}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  fetch(url, { credentials: 'include' })
    .then(res => res.blob())
    .then(blob => {
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
