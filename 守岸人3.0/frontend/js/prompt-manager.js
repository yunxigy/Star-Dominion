const promptState = {
  presets: [], selectedPresetId: null, blocks: [], selectedBlockId: null, profiles: [],
};
const promptStatus = (message) => { document.getElementById('prompt-status').textContent = message; };
function textRows(containerId, values, formatter, onClick) {
  const container = document.getElementById(containerId); const fragment = document.createDocumentFragment();
  values.forEach((value) => { const button=document.createElement('button'); button.type='button'; button.className='item'; button.textContent=formatter(value); button.addEventListener('click',()=>onClick?.(value)); fragment.appendChild(button); });
  container.replaceChildren(fragment);
}
async function loadPresets() {
  promptState.presets = await API.get('/api/prompt-presets');
  textRows('preset-list', promptState.presets, item => `${item.name} · ${item.token_budget} Token`, selectPreset);
  if (!promptState.selectedPresetId && promptState.presets[0]) await selectPreset(promptState.presets[0]);
}
async function selectPreset(item) {
  promptState.selectedPresetId = item.id; promptState.selectedBlockId = null;
  promptState.blocks = await API.get(`/api/prompt-presets/${encodeURIComponent(item.id)}/blocks`);
  textRows('block-list', promptState.blocks, block => `${block.sort_order} · ${block.name} · ${block.enabled ? '启用' : '停用'}`, selectBlock);
}
function selectBlock(block) {
  promptState.selectedBlockId = block.id;
  document.getElementById('block-name').value = block.name;
  document.getElementById('block-kind').value = block.kind;
  document.getElementById('block-role').value = block.role;
  document.getElementById('block-order').value = String(block.sort_order);
  document.getElementById('block-enabled').checked = block.enabled;
  document.getElementById('block-content').value = block.content;
}
function blockPayload() { return { kind:document.getElementById('block-kind').value, name:document.getElementById('block-name').value.trim(), content:document.getElementById('block-content').value, sort_order:Number(document.getElementById('block-order').value), role:document.getElementById('block-role').value, enabled:document.getElementById('block-enabled').checked, max_tokens:null }; }
async function savePreset() { const button=document.getElementById('save-preset'); button.disabled=true; try { await API.post('/api/prompt-presets',{name:document.getElementById('preset-name').value.trim(),token_budget:Number(document.getElementById('preset-budget').value)}); await loadPresets(); promptStatus('预设已创建'); } catch(error){promptStatus(error.message);} finally {button.disabled=false;} }
async function saveBlock() {
  if (!promptState.selectedPresetId) return promptStatus('请先选择预设');
  if (promptState.selectedBlockId) await API.put(`/api/prompt-presets/blocks/${encodeURIComponent(promptState.selectedBlockId)}`, blockPayload());
  else await API.post(`/api/prompt-presets/${encodeURIComponent(promptState.selectedPresetId)}/blocks`, blockPayload());
  await selectPreset({id:promptState.selectedPresetId}); promptStatus('Prompt 块已保存');
}
async function deleteBlock() {
  if (!promptState.selectedBlockId || !window.confirm('确认删除这个 Prompt 块？')) return;
  await API.del(`/api/prompt-presets/blocks/${encodeURIComponent(promptState.selectedBlockId)}`);
  await selectPreset({id:promptState.selectedPresetId}); promptStatus('Prompt 块已删除');
}
async function reorderBlocks() {
  const ordered = [...promptState.blocks].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));
  await API.put(`/api/prompt-presets/${encodeURIComponent(promptState.selectedPresetId)}/blocks/reorder`, {block_ids:ordered.map(item=>item.id)});
  await selectPreset({id:promptState.selectedPresetId}); promptStatus('排序已保存');
}
async function loadProfiles(){promptState.profiles=await API.get('/api/model-profiles');textRows('model-profile-list',promptState.profiles,item=>`${item.name} · ${item.provider}/${item.model}`);}
async function saveProfile(){await API.post('/api/model-profiles',{name:document.getElementById('profile-name').value.trim(),provider:document.getElementById('profile-provider').value.trim(),model:document.getElementById('profile-model').value.trim(),prompt_preset_id:promptState.selectedPresetId,parameters:{temperature:Number(document.getElementById('profile-temperature').value)},stop_sequence_refs:[]});await loadProfiles();promptStatus('模型档案已添加');}
async function runPreview(){if(!promptState.selectedPresetId)return promptStatus('请先选择预设');const result=await API.post('/api/prompt-presets/preview',{preset_id:promptState.selectedPresetId,metadata:{model:'preview'}});document.getElementById('prompt-preview').textContent=result.included.map(item=>`[${item.kind}] ${item.content}`).join('\n\n');textRows('preview-trace',result.trace,item=>`${item.status} · ${item.reason} · ${item.estimated_tokens} Token`);}
async function initPromptManager(){if(!await Auth.loadUser())return void(window.location.href=Auth.loginUrl(location.href));document.getElementById('save-preset').addEventListener('click',savePreset);document.getElementById('save-block').addEventListener('click',saveBlock);document.getElementById('delete-block').addEventListener('click',deleteBlock);document.getElementById('reorder-blocks').addEventListener('click',reorderBlocks);document.getElementById('save-profile').addEventListener('click',saveProfile);document.getElementById('run-preview').addEventListener('click',runPreview);await Promise.all([loadPresets(),loadProfiles()]);}
initPromptManager().catch(error=>promptStatus(error.message));
