(() => {
  'use strict';

  const STORAGE_KEY = 'memo-app-notes-v1';
  const THEME_KEY = 'memo-app-theme-v1';
  const themeToggle = document.querySelector('#theme-toggle');

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    themeToggle.setAttribute('aria-label', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
    themeToggle.title = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
    themeToggle.querySelector('.theme-icon').textContent = isDark ? '☀' : '☾';
    themeToggle.querySelector('.theme-label').textContent = isDark ? '라이트 모드' : '다크 모드';
    document.querySelector('meta[name="theme-color"]').content = isDark ? '#17181b' : '#ffffff';
  }

  let savedTheme = 'light';
  try {
    savedTheme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch (error) {
    console.warn('테마 설정을 불러오지 못했습니다.', error);
  }
  applyTheme(savedTheme);
  themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    try { localStorage.setItem(THEME_KEY, nextTheme); }
    catch (error) { console.warn('테마 설정을 저장하지 못했습니다.', error); }
  });

  const SUPABASE = {
    url: 'https://dgzxqcfzbadhdxlcjdbe.supabase.co',
    publishableKey: 'sb_publishable_kPGRMx6lQe0GvCwjcgKkZw_ktMgZyOq',
    table: 'memos'
  };
  const API_URL = `${SUPABASE.url}/rest/v1/${SUPABASE.table}`;

  function localLoad() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(isValidMemo) : [];
    } catch (error) {
      console.error('로컬 메모를 불러오지 못했습니다.', error);
      return [];
    }
  }

  function localSave(notes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      return true;
    } catch (error) {
      console.error('로컬 메모를 저장하지 못했습니다.', error);
      return false;
    }
  }

  // Supabase REST API 호출에는 Publishable Key를 사용합니다.
  const repository = {
    async request(url = API_URL, options = {}) {
      const response = await fetch(url, {
        ...options,
        headers: {
          apikey: SUPABASE.publishableKey,
          Authorization: `Bearer ${SUPABASE.publishableKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Supabase 응답 오류 (${response.status}): ${detail}`);
      }
      if (response.status === 204) return null;
      return response.json();
    },
    async loadAll() {
      const rows = await this.request(`${API_URL}?select=id,title,content,created_at,updated_at&order=updated_at.desc`);
      return rows.map(row => ({
        id: row.id,
        title: row.title ?? '',
        content: row.content ?? '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },
    async insert(note) {
      const rows = await this.request(API_URL, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title: note.title, content: note.content })
      });
      return rows[0];
    },
    async update(note) {
      const rows = await this.request(`${API_URL}?id=eq.${encodeURIComponent(note.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title: note.title, content: note.content })
      });
      if (!rows.length) throw new Error('수정할 메모를 찾을 수 없습니다.');
      return rows[0];
    },
    async remove(id) {
      await this.request(`${API_URL}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  };

  function isValidMemo(item) {
    return item && typeof item.id === 'string' && typeof item.title === 'string' &&
      typeof item.content === 'string' && typeof item.createdAt === 'string' &&
      typeof item.updatedAt === 'string';
  }

  function fromRow(row) {
    return { id: row.id, title: row.title ?? '', content: row.content ?? '',
      createdAt: row.created_at, updatedAt: row.updated_at };
  }

  const form = document.querySelector('#memo-form');
  const idInput = document.querySelector('#memo-id');
  const titleInput = document.querySelector('#memo-title');
  const contentInput = document.querySelector('#memo-content');
  const saveButton = document.querySelector('#save-button');
  const cancelButton = document.querySelector('#cancel-edit');
  const formHeading = document.querySelector('#form-heading');
  const formHint = document.querySelector('#form-hint');
  const searchInput = document.querySelector('#search-input');
  const memoList = document.querySelector('#memo-list');
  const memoCount = document.querySelector('#memo-count');
  const toast = document.querySelector('#toast');
  const deleteDialog = document.querySelector('#delete-dialog');
  const confirmDeleteButton = document.querySelector('#confirm-delete');
  let notes = localLoad().sort(byUpdated);
  let pendingDeleteId = null;
  let toastTimer;
  let usingLocalFallback = false;

  function byUpdated(a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }
  function createId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }
  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }
  function showError(error) {
    console.error(error);
    const message = error?.message || '?????녿뒗 ?ㅻ쪟';
    showToast(`Supabase ?곌껐???ㅽ뙣?덉뒿?덈떎: ${message}`);
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase('ko-KR');
    const filtered = [...notes].sort(byUpdated).filter(note =>
      `${note.title}\n${note.content}`.toLocaleLowerCase('ko-KR').includes(query));
    memoCount.textContent = String(notes.length);
    if (!filtered.length) {
      const searching = Boolean(query);
      memoList.innerHTML = `<div class="empty-state"><div class="empty-icon">${searching ? '⌕' : '+'}</div><strong>${searching ? '검색 결과가 없습니다' : '아직 메모가 없습니다'}</strong><p>${searching ? '다른 단어로 검색해 보세요.' : '첫 메모를 작성해 생각을 기록해 보세요.'}</p></div>`;
      return;
    }
    memoList.innerHTML = filtered.map(note => `
      <article class="memo-card" data-id="${escapeText(note.id)}">
        <div class="memo-card-top"><h3>${escapeText(note.title || '제목 없는 메모')}</h3>
          <time class="memo-date" datetime="${escapeText(note.updatedAt)}">${escapeText(formatDate(note.updatedAt))}</time></div>
        ${note.content ? `<p class="memo-card-content">${escapeText(note.content)}</p>` : ''}
        <div class="memo-card-footer"><button class="memo-action edit" type="button" data-action="edit">수정</button>
          <button class="memo-action delete" type="button" data-action="delete">삭제</button></div>
      </article>`).join('');
  }
  function resetForm() {
    form.reset(); idInput.value = ''; formHeading.textContent = '새 메모';
    saveButton.innerHTML = '<span class="plus">+</span> 메모 저장';
    cancelButton.classList.add('hidden');
    formHint.textContent = '硫붾え??Supabase????λ릺怨???釉뚮씪?곗??먮룄 諛깆뾽?⑸땲??';
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    if (!title && !content) {
      formHint.textContent = '제목이나 내용을 입력해 주세요.';
      (titleInput.value ? contentInput : titleInput).focus();
      return;
    }
    const editingId = idInput.value;
    saveButton.disabled = true;
    try {
      if (usingLocalFallback) {
        const now = new Date().toISOString();
        if (editingId) {
          const index = notes.findIndex(note => note.id === editingId);
          if (index !== -1) notes[index] = { ...notes[index], title, content, updatedAt: now };
        } else notes.push({ id: createId(), title, content, createdAt: now, updatedAt: now });
        localSave(notes);
      } else if (editingId) {
        const row = await repository.update({ id: editingId, title, content });
        notes = notes.map(note => note.id === editingId ? fromRow(row) : note);
      } else {
        const row = await repository.insert({ title, content });
        notes.unshift(fromRow(row));
      }
      notes.sort(byUpdated);
      localSave(notes);
      showToast(editingId ? '메모를 수정했습니다.' : '메모를 저장했습니다.');
      resetForm(); render();
    } catch (error) { showError(error); }
    finally { saveButton.disabled = false; }
  });

  cancelButton.addEventListener('click', resetForm);
  searchInput.addEventListener('input', render);
  memoList.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('.memo-card');
    const note = notes.find(item => item.id === card?.dataset.id);
    if (!note) return;
    if (button.dataset.action === 'edit') {
      idInput.value = note.id; titleInput.value = note.title; contentInput.value = note.content;
      formHeading.textContent = '메모 수정'; saveButton.textContent = '변경사항 저장';
      cancelButton.classList.remove('hidden');
      formHint.textContent = '수정한 내용은 저장하면 바로 반영됩니다.';
      titleInput.focus();
      document.querySelector('.compose-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else { pendingDeleteId = note.id; deleteDialog.showModal(); }
  });

  confirmDeleteButton.addEventListener('click', async event => {
    event.preventDefault();
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    confirmDeleteButton.disabled = true;
    try {
      if (usingLocalFallback) { notes = notes.filter(note => note.id !== id); localSave(notes); }
      else await repository.remove(id);
      if (idInput.value === id) resetForm();
      pendingDeleteId = null; deleteDialog.close(); render();
      showToast('메모를 삭제했습니다.');
    } catch (error) { showError(error); }
    finally { confirmDeleteButton.disabled = false; }
  });
  deleteDialog.addEventListener('close', () => { pendingDeleteId = null; });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault(); searchInput.focus();
    }
    if (event.key === 'Escape' && !deleteDialog.open && idInput.value) resetForm();
  });

  async function initialize() {
    render();
    try {
      const remoteNotes = await repository.loadAll();
      // 기존 브라우저 메모가 있고 서버가 비어 있으면 한 번 서버로 이전합니다.
      if (!remoteNotes.length && notes.length) {
        for (const note of [...notes].reverse()) {
          try {
            const row = await repository.insert(note);
            remoteNotes.unshift(fromRow(row));
          } catch (error) {
            // 일부 이전에 실패해도 나머지 로컬 메모를 계속 처리합니다.
            console.error('로컬 메모 이전에 실패했습니다.', error);
          }
        }
      }
      const migrationIncomplete = remoteNotes.length === 0 && localLoad().length > 0;
      notes = remoteNotes.sort(byUpdated);
      if (!migrationIncomplete) localSave(notes);
      usingLocalFallback = false;
      document.querySelector('.local-indicator').innerHTML = '<span class="status-dot"></span> Supabase에 동기화됨';
      formHint.textContent = '메모는 Supabase에 저장되고 이 브라우저에도 백업됩니다.';
      if (migrationIncomplete) {
        showToast('일부 로컬 메모를 이전하지 못했습니다. 브라우저 백업을 확인해 주세요.');
      }
      render();
    } catch (error) {
      usingLocalFallback = true;
      notes = localLoad().sort(byUpdated);
      document.querySelector('.local-indicator').innerHTML = '<span class="status-dot"></span> 오프라인 로컬 모드';
      formHint.textContent = 'Supabase에 연결할 수 없어 메모를 이 브라우저에 저장합니다.';
      render();
      console.error('Supabase 연결 실패. 로컬 저장소를 사용합니다.', error);
      showToast('Supabase 연결에 실패해 로컬 저장 모드로 전환했습니다.');
    }
  }

  initialize();
})();


