const personaState = { items: [], selectedId: null };
const personaStatus = (message) => { document.getElementById('persona-status').textContent = message; };

function personaPayload() {
  return {
    name: document.getElementById('persona-name').value.trim(),
    avatar_url: document.getElementById('persona-avatar').value.trim() || null,
    description: document.getElementById('persona-description').value,
    injection_position: document.getElementById('persona-position').value,
    depth: Number(document.getElementById('persona-depth').value),
  };
}

function resetPersonaForm() {
  personaState.selectedId = null;
  document.getElementById('persona-form-title').textContent = '新建 Persona';
  document.getElementById('persona-name').value = '';
  document.getElementById('persona-avatar').value = '';
  document.getElementById('persona-description').value = '';
  document.getElementById('persona-position').value = 'after_char';
  document.getElementById('persona-depth').value = '4';
}

function renderPersonas() {
  const container = document.getElementById('persona-list');
  const fragment = document.createDocumentFragment();
  personaState.items.forEach((item) => {
    const row = document.createElement('article'); row.className = 'item';
    const title = document.createElement('strong'); title.textContent = `${item.name}${item.is_default ? '（默认）' : ''}`;
    const description = document.createElement('p'); description.textContent = item.description || '暂无描述';
    const actions = document.createElement('div'); actions.className = 'row';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑'; edit.addEventListener('click', () => selectPersona(item));
    const makeDefault = document.createElement('button'); makeDefault.type = 'button'; makeDefault.textContent = '设为默认'; makeDefault.addEventListener('click', () => setDefaultPersona(item.id));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', () => deletePersona(item.id));
    actions.append(edit, makeDefault, remove); row.append(title, description, actions); fragment.appendChild(row);
  });
  container.replaceChildren(fragment);
}

function selectPersona(item) {
  personaState.selectedId = item.id;
  document.getElementById('persona-form-title').textContent = `编辑：${item.name}`;
  document.getElementById('persona-name').value = item.name;
  document.getElementById('persona-avatar').value = item.avatar_url || '';
  document.getElementById('persona-description').value = item.description || '';
  document.getElementById('persona-position').value = item.injection_position;
  document.getElementById('persona-depth').value = String(item.depth);
}

async function loadPersonas() { personaState.items = await API.get('/api/personas'); renderPersonas(); }
async function savePersona() {
  const button = document.getElementById('save-persona'); button.disabled = true;
  try {
    const path = personaState.selectedId ? `/api/personas/${encodeURIComponent(personaState.selectedId)}` : '/api/personas';
    if (personaState.selectedId) await API.put(path, personaPayload()); else await API.post(path, personaPayload());
    resetPersonaForm(); await loadPersonas(); personaStatus('Persona 已保存');
  } catch (error) { personaStatus(error.message); } finally { button.disabled = false; }
}
async function setDefaultPersona(id) { await API.put(`/api/personas/default/${encodeURIComponent(id)}`, {}); await loadPersonas(); personaStatus('默认 Persona 已更新'); }
async function deletePersona(id) { if (!window.confirm('确认删除这个 Persona？')) return; await API.del(`/api/personas/${encodeURIComponent(id)}`); resetPersonaForm(); await loadPersonas(); personaStatus('Persona 已删除'); }
async function saveBinding() {
  if (!personaState.selectedId) return personaStatus('请先选择一个 Persona');
  const scope = document.getElementById('binding-scope').value;
  const scopeId = document.getElementById('binding-scope-id').value.trim();
  await API.put(`/api/personas/bindings/${scope}/${encodeURIComponent(scopeId)}`, { persona_id: personaState.selectedId });
  personaStatus('绑定已保存');
}

async function initPersonas() {
  if (!await Auth.loadUser()) return void (window.location.href = Auth.loginUrl(location.href));
  document.getElementById('save-persona').addEventListener('click', savePersona);
  document.getElementById('reset-persona').addEventListener('click', resetPersonaForm);
  document.getElementById('save-binding').addEventListener('click', saveBinding);
  await loadPersonas();
}
initPersonas().catch((error) => personaStatus(error.message));
