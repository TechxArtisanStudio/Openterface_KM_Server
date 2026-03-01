export function createMacrosModule({ getTargetOS, sendRaw, sendHotkey, banner }) {
  const DEFAULT_MACROS_BY_OS = {
    windows: [
      { id:'dm1', name:'Show Desktop',  steps:[{t:'hotkey',v:'win+d'}] },
      { id:'dm2', name:'Open Run…',     steps:[{t:'hotkey',v:'win+r'}] },
      { id:'dm3', name:'Open Notepad',  steps:[{t:'hotkey',v:'win+r'},{t:'wait',v:'500'},{t:'key',v:'notepad\r'}] },
      { id:'dm4', name:'Open Terminal', steps:[{t:'hotkey',v:'win+r'},{t:'wait',v:'500'},{t:'key',v:'cmd\r'}] },
      { id:'dm5', name:'Lock Screen',   steps:[{t:'hotkey',v:'win+l'}] },
    ],
    macos: [
      { id:'dm1', name:'Spotlight',     steps:[{t:'hotkey',v:'cmd+space'}] },
      { id:'dm2', name:'App Switcher',  steps:[{t:'hotkey',v:'cmd+tab'}] },
      { id:'dm3', name:'Open Terminal', steps:[{t:'hotkey',v:'cmd+space'},{t:'wait',v:'500'},{t:'key',v:'terminal\r'}] },
      { id:'dm4', name:'Lock Screen',   steps:[{t:'hotkey',v:'ctrl+cmd+q'}] },
      { id:'dm5', name:'Force Quit',    steps:[{t:'hotkey',v:'cmd+opt+esc'}] },
    ],
    linux: [
      { id:'dm1', name:'Show Desktop',  steps:[{t:'hotkey',v:'super+d'}] },
      { id:'dm2', name:'Open Terminal', steps:[{t:'hotkey',v:'ctrl+alt+t'}] },
      { id:'dm3', name:'Lock Screen',   steps:[{t:'hotkey',v:'ctrl+alt+l'}] },
      { id:'dm4', name:'App Launcher',  steps:[{t:'hotkey',v:'super'}] },
      { id:'dm5', name:'Switch Window', steps:[{t:'hotkey',v:'alt+tab'}] },
    ],
  };

  function getDefaultMacros(os) {
    return (DEFAULT_MACROS_BY_OS[os] || DEFAULT_MACROS_BY_OS.windows)
      .map(m => ({ ...m, steps: m.steps.map(s => ({ ...s })) }));
  }

  let macros = [];
  try {
    const initOS = (getTargetOS && getTargetOS()) || 'windows';
    macros = JSON.parse(localStorage.getItem('km_macros') || 'null') || getDefaultMacros(initOS === 'unknown' ? 'windows' : initOS);
  } catch (_) {
    const initOS = (getTargetOS && getTargetOS()) || 'windows';
    macros = getDefaultMacros(initOS === 'unknown' ? 'windows' : initOS);
  }

  function saveMacroData() {
    try { localStorage.setItem('km_macros', JSON.stringify(macros)); } catch (_) {}
  }

  function escForEdit(s) { return s.replace(/\r/g,'\\r').replace(/\t/g,'\\t'); }
  function unescFromEdit(s) { return s.replace(/\\r/g,'\r').replace(/\\t/g,'\t').replace(/\\n/g,'\r'); }

  function applyDefaultMacrosForOS(os) {
    const newDefaults = getDefaultMacros(os);
    const userMacros = macros.filter(m => !m.id.startsWith('dm'));
    macros = [...newDefaults, ...userMacros];
    saveMacroData();
    renderMacroList();
  }

  function renderMacroList() {
    const list = document.getElementById('macro-list');
    if (!list) return;
    list.innerHTML = '';
    if (!macros.length) {
      list.innerHTML = '<div class="macro-empty">No macros yet</div>';
      return;
    }

    macros.forEach(m => {
      const row = document.createElement('div');
      row.className = 'macro-row';
      row.innerHTML =
        `<button class="macro-run" title="Run: ${m.name}">${m.name}</button>` +
        `<button class="macro-icon-btn" title="Edit">✎</button>` +
        `<button class="macro-icon-btn" title="Delete" style="color:var(--accent)">×</button>`;
      row.querySelector('.macro-run').addEventListener('click', () => runMacroById(m.id));
      row.querySelectorAll('.macro-icon-btn')[0].addEventListener('click', () => openMacroEditor(m));
      row.querySelectorAll('.macro-icon-btn')[1].addEventListener('click', () => {
        if (!confirm(`Delete macro "${m.name}"?`)) return;
        macros = macros.filter(x => x.id !== m.id);
        saveMacroData();
        renderMacroList();
      });
      list.appendChild(row);
    });
  }

  async function runMacroById(id) {
    const m = macros.find(x => x.id === id);
    if (!m) return;
    if (typeof banner === 'function') banner(`\x1b[90m  ▶ ${m.name}\x1b[0m`);
    for (const step of m.steps) {
      if (step.t === 'key') sendRaw(step.v);
      else if (step.t === 'hotkey') sendHotkey(step.v);
      else if (step.t === 'wait') await new Promise(r => setTimeout(r, Math.max(0, Number(step.v) || 500)));
    }
    if (typeof banner === 'function') banner(`\x1b[90m  ✔ Done: ${m.name}\x1b[0m`);
  }

  const macroOverlay = document.getElementById('macro-overlay');
  let macroEditId = null;

  function openMacroEditor(macro) {
    macroEditId = macro ? macro.id : null;
    document.getElementById('macro-modal-title').textContent = macro ? 'Edit Macro' : 'New Macro';
    document.getElementById('macro-name').value = macro ? macro.name : '';
    const stepsEl = document.getElementById('msteps-list');
    stepsEl.innerHTML = '';
    if (macro) {
      macro.steps.forEach(s => addMstepRow(s.t, s.t === 'key' ? escForEdit(s.v) : s.v));
    } else {
      addMstepRow('hotkey', 'win+r');
      addMstepRow('wait', '400');
      addMstepRow('key', '');
    }
    macroOverlay.classList.add('show');
    document.getElementById('macro-name').focus();
  }

  function closeMacroEditor() {
    macroOverlay.classList.remove('show');
    macroEditId = null;
  }

  function addMstepRow(type, value) {
    const stepsEl = document.getElementById('msteps-list');
    const row = document.createElement('div');
    row.className = 'mstep';

    const sel = document.createElement('select');
    sel.className = 'mstep-type';
    [{v:'key',l:'Key text'},{v:'hotkey',l:'Hotkey'},{v:'wait',l:'Wait ms'}].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.l;
      if (o.v === type) opt.selected = true;
      sel.appendChild(opt);
    });

    const inp = document.createElement('input');
    inp.className = 'mstep-val';
    inp.type = 'text';
    const placeholders = { key:'hello world\\r', hotkey:'win+r', wait:'500' };
    inp.placeholder = placeholders[type] || '';
    inp.value = value || '';
    sel.addEventListener('change', () => { inp.placeholder = placeholders[sel.value] || ''; });

    const del = document.createElement('button');
    del.className = 'mstep-del';
    del.textContent = '×';
    del.addEventListener('click', () => row.remove());

    row.append(sel, inp, del);
    stepsEl.appendChild(row);
  }

  function init() {
    document.getElementById('btn-macro-new').addEventListener('click', () => openMacroEditor(null));
    document.getElementById('btn-macro-close').addEventListener('click', closeMacroEditor);
    document.getElementById('btn-macro-cancel').addEventListener('click', closeMacroEditor);
    macroOverlay.addEventListener('click', e => { if (e.target === macroOverlay) closeMacroEditor(); });
    document.getElementById('mstep-add-key').addEventListener('click', () => addMstepRow('key', ''));
    document.getElementById('mstep-add-hotkey').addEventListener('click', () => addMstepRow('hotkey', ''));
    document.getElementById('mstep-add-wait').addEventListener('click', () => addMstepRow('wait', '500'));

    document.getElementById('btn-macro-save').addEventListener('click', () => {
      const name = document.getElementById('macro-name').value.trim();
      if (!name) { alert('Please enter a macro name.'); return; }
      const stepRows = document.querySelectorAll('#msteps-list .mstep');
      const steps = [];
      stepRows.forEach(row => {
        const t = row.querySelector('.mstep-type').value;
        const v = row.querySelector('.mstep-val').value;
        if (!v) return;
        steps.push({ t, v: t === 'key' ? unescFromEdit(v) : v });
      });
      if (!steps.length) { alert('Add at least one step with a value.'); return; }
      if (macroEditId) {
        const idx = macros.findIndex(m => m.id === macroEditId);
        if (idx >= 0) macros[idx] = { id: macroEditId, name, steps };
      } else {
        macros.push({ id: 'u' + Date.now(), name, steps });
      }
      saveMacroData();
      renderMacroList();
      closeMacroEditor();
    });

    renderMacroList();
  }

  return {
    init,
    applyDefaultMacrosForOS,
    runMacroById,
  };
}
