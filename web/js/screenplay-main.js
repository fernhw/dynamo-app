/* Screenplay Writer v3.0 — Nextcloud + Fountain */
(function () {
'use strict';

var DAV_USER_ROOT = '/remote.php/dav/files/' + (window._SP_USER || '');
var DAV_ROOT = DAV_USER_ROOT + '/Screenplays';
/* set by the desktop shell (apple/, future windows/android); absent on Nextcloud */
var NATIVE = window.DynamoNative || null;

var TYPES = [
  { id: 'tag-id',        shortLabel: '🏷️', hint: '[[tag-id]]' },
  { id: 'scene-heading', shortLabel: '🎬', hint: 'INT./EXT. LOCATION - TIME' },
  { id: 'action',        shortLabel: '⚡', hint: 'Action description' },
  { id: 'character',     shortLabel: '🎭', hint: 'CHARACTER NAME (CAPS)' },
  { id: 'parenthetical', shortLabel: '💭', hint: '(tone/action)' },
  { id: 'dialogue',      shortLabel: '💬', hint: 'Character line' },
  { id: 'transition',    shortLabel: '➡️', hint: 'Transition effect' },
  { id: 'general',       shortLabel: '📝', hint: 'Plain text' },
];

/* ── state ── */
var st = {
  files: [], loading: false, error: null,
  currentPath: null, currentTitle: 'Untitled Screenplay',
  blocks: [], focusedIdx: -1,
  selectionMode: false, selectedBlocks: [], clipboard: [],
  nextId: 1, lastSaved: null,
  savedContent: null, conflictOpen: false,
  history: [], historyIdx: -1,
  zoom: 1,
  hideDynamos: false,
  dockPreview: false,
  dockWidth: 542,
  titlePageMeta: {},
  dynamoMode: true,  /* false = pure screenplay mode: no tags, no limits */
  spellMode: true,   /* browser spellcheck on all textareas */
};
var historyTimer = null;
function pushHistory() {
  if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; }
  st.history = st.history.slice(0, st.historyIdx + 1);
  st.history.push(JSON.stringify(st.blocks));
  st.historyIdx = st.history.length - 1;
  if (st.history.length > 100) { st.history.shift(); st.historyIdx--; }
  /* every undoable edit must also persist — type changes, deletes, reorders,
     etc. all flow through here, so this is the one place that guarantees no
     structural change is ever silently dropped on reload */
  scheduleSave();
}
function scheduleHistory() {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = setTimeout(pushHistory, 800);
}
function undoHistory() {
  if (!blocksEl || st.historyIdx <= 0) return;
  st.historyIdx--;
  st.blocks = JSON.parse(st.history[st.historyIdx]);
  st.focusedIdx = -1;
  renderBlocks(); renderBar();
  scheduleSave();
}
function redoHistory() {
  if (!blocksEl || st.historyIdx >= st.history.length - 1) return;
  st.historyIdx++;
  st.blocks = JSON.parse(st.history[st.historyIdx]);
  st.focusedIdx = -1;
  renderBlocks(); renderBar();
  scheduleSave();
}
function canUndo() { return st.historyIdx > 0; }
function canRedo() { return st.historyIdx < st.history.length - 1; }
/* document-level undo/redo + block navigation when no textarea has focus */
document.addEventListener('keydown', function(e) {
  if (!blocksEl) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (NATIVE) { NATIVE.cmd('save'); return; }
    var saveBtn = document.querySelector('.sp-save-btn');
    var saveTi  = document.querySelector('.sp-menubar .sp-title-input');
    doSave(saveBtn, saveTi);
    return;
  }
  /* Cmd/Ctrl+A — select all blocks. Works in two situations:
       (1) no textarea focused → straight select-all
       (2) a textarea IS focused but every char is already selected → escalate
           from "all text in this line" to "all blocks" (Notion/Linear pattern). */
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
    var ae = document.activeElement;
    var inTA = ae && ae.tagName === 'TEXTAREA';
    var allTextSelected = inTA && ae.selectionStart === 0 && ae.selectionEnd === ae.value.length && ae.value.length > 0;
    var nothingToSelectInTA = inTA && ae.value.length === 0;
    if (!inTA || allTextSelected || nothingToSelectInTA) {
      e.preventDefault();
      if (inTA) ae.blur();
      st.selectedBlocks = [];
      for (var ai = 0; ai < st.blocks.length; ai++) st.selectedBlocks.push(ai);
      st.focusedIdx = -1;
      selRangeAnchor = 0;
      lastSelectAnchor = st.blocks.length - 1;
      renderBlocks(); updateSelection(); renderBar();
      return;
    }
    /* otherwise let the textarea handle the first Cmd+A natively (select line text) */
  }
  if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoHistory(); else undoHistory();
    return;
  }
  /* Cmd/Ctrl+C / X on selected blocks → put FOUNTAIN text on the system clipboard
     (this is a Fountain editor, so a copy must yield valid Fountain) */
  if (st.selectedBlocks.length && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      && (e.key === 'c' || e.key === 'x')) {
    e.preventDefault();
    var sorted = st.selectedBlocks.slice().sort(function(a, b){ return a - b; });
    var picked = sorted.map(function(i){ return st.blocks[i]; });
    var fountain = blocksToFountain(picked).replace(/^\n+/, '').replace(/\n+$/, '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fountain).catch(function(){});
    }
    if (e.key === 'x') cutS(); else copyS(); /* keep internal clipboard too */
    return;
  }
  /* Cmd/Ctrl+1..8 set the element type of the selected block(s) */
  if (st.selectedBlocks.length && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
      && e.key >= '1' && e.key <= '8') {
    var sti = parseInt(e.key, 10) - 1;
    if (TYPES[sti]) {
      e.preventDefault();
      pushHistory();
      st.selectedBlocks.forEach(function(i){ st.blocks[i].type = TYPES[sti].id; });
      renderBlocks(); updateSelection(); renderBar();
    }
    return;
  }
  if (st.selectedBlocks.length && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    var dir = e.key === 'ArrowDown' ? 1 : -1;
    var cur = lastSelectAnchor >= 0 ? lastSelectAnchor
            : (dir > 0 ? Math.max.apply(null, st.selectedBlocks)
                       : Math.min.apply(null, st.selectedBlocks));
    var next = Math.max(0, Math.min(st.blocks.length - 1, cur + dir));
    if (e.shiftKey) {
      if (selRangeAnchor < 0) selRangeAnchor = cur;
      var lo = Math.min(selRangeAnchor, next), hi = Math.max(selRangeAnchor, next);
      st.selectedBlocks = [];
      for (var k = lo; k <= hi; k++) st.selectedBlocks.push(k);
    } else {
      st.selectedBlocks = [next];
      selRangeAnchor = next;
    }
    lastSelectAnchor = next;
    updateSelection(); renderBar();
    scrollBlockIntoView(next);
    return;
  }
  /* Delete / Backspace on a multi-selection: remove every selected block.
     delS() pushes undo history, so this is fully undoable (Cmd+Z) and saved. */
  if (st.selectedBlocks.length && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    delS();
    return;
  }
  /* Enter on a single-selected block: jump into it to edit */
  if (e.key === 'Enter' && st.selectedBlocks.length === 1) {
    e.preventDefault();
    var only = st.selectedBlocks[0];
    st.selectedBlocks = [];
    focusTA(only);
    renderBar();
    return;
  }
});

/* ════ Fountain ════ */
/* Behind-the-scenes raw indentation — purely to make the saved .fountain easy
   to read in a plain editor (VS Code etc.). It is stripped again on load
   (fountainToBlocks trims every line) so it is NEVER seen inside this player.
   Each tab = 4 spaces: NAMES 3 tabs (12), parentheticals 3 tabs (12),
   dialogue 2 tabs (8); action / scene / transition / tags get none. */
var FOUNTAIN_INDENT = { character: 12, parenthetical: 12, dialogue: 8 };
function indentFountain(text, type) {
  var pad = FOUNTAIN_INDENT[type];
  if (!pad) return text;
  var sp = new Array(pad + 1).join(' ');
  return text.split('\n').map(function(ln){ return ln ? sp + ln : ln; }).join('\n');
}
function blocksToFountain(blocks) {
  /* prepend Fountain title-page if there is any metadata */
  var header = '';
  if (st.titlePageMeta && Object.keys(st.titlePageMeta).length) {
    header = serializeTitlePage(st.titlePageMeta) + '\n\n';
  }
  var out = [], prevType = null;
  blocks.forEach(function(b) {
    var t = b.type, s = b.text.trim();
    if (!s) { prevType = t; return; }

    if (t === 'tag-id') {
      var tagText = s;
      if (!tagText.startsWith('[[')) tagText = '[[' + tagText + ']]';
      out.push(tagText);
    } else if (t === 'scene-heading') {
      out.push('');
      out.push(/^(INT|EXT|INT\.\/EXT|I\/E)[\s\.]/i.test(s) ? s.toUpperCase() : '.' + s.toUpperCase());
      out.push('');
    } else if (t === 'action') {
      out.push('');
      out.push(s);
      out.push('');
    } else if (t === 'character') {
      // Fountain spec requires a blank line before every character cue so the
      // parser can tell speeches apart. Without it the inner dialogue-group loop
      // (which runs until a blank line) eats the next NAME as dialogue.
      out.push('');
      out.push(indentFountain(s.toUpperCase(), 'character'));
    } else if (t === 'parenthetical') {
      out.push(indentFountain(s.startsWith('(') ? s : '(' + s + ')', 'parenthetical'));
    } else if (t === 'dialogue') {
      // If previous block was also dialogue, this is a continuation paragraph — separate with a blank line
      /*if (prevType === 'dialogue') { // removed for now
        out.push('');
      }*/
      out.push(indentFountain(s, 'dialogue'));
    } else if (t === 'transition') {
      out.push('');
      out.push('> ' + s.toUpperCase());
      out.push('');
    } else {
      out.push(s);
      out.push('');
    }
    prevType = t;
  });
  return header + out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ════ Fountain title-page (metadata block) ════
   The Fountain spec defines an optional title page as zero or more
   "Key: Value" pairs at the very top of the file, terminated by the first
   blank line.  We strip it before block parsing and store it in
   st.titlePageMeta so it survives the edit session and round-trips intact. */
function parseTitlePage(text) {
  var VISIBLE_TITLE_KEYS = {
    'Title': true,
    'Credit': true,
    'Author': true,
    'Source': true,
    'Draft date': true,
    'Contact': true,
    'Language': true,
    'Notes': true
  };
  function parseMetaLine(trimmed) {
    if (!trimmed) return null;
    /* tolerate decorative prefixes/suffixes inside comment blocks */
    trimmed = trimmed.replace(/^\*\s*/, '').replace(/\s*\*\/$/, '');
    var m = trimmed.match(/^([A-Za-z][\w ]*?):\s*(.*)$/);
    if (!m) return null;
    return { key: m[1], value: m[2] };
  }

  /* Preferred: split on the explicit Header-end delimiter written by DYNAMO.
     (The delimiter is the Fountain boneyard comment: slash-star Header end star-slash) */
  var DELIM = '/*Header end*/';
  var delimIdx = text.indexOf(DELIM);
  if (delimIdx >= 0) {
    var headerRaw = text.slice(0, delimIdx);
    var rest = text.slice(delimIdx + DELIM.length).replace(/^\n/, '');
    /* parse key:value pairs from the header block, including keys inside
       comment blocks (custom metadata) */
    var meta = {};
    headerRaw.split('\n').forEach(function(line) {
      var t = line.trim();
      var p = parseMetaLine(t);
      if (p) meta[p.key] = p.value;
    });
    return { meta: meta, rest: rest };
  }
  /* Fallback: no delimiter yet — try classic Fountain title-page heuristic
     (key:value lines at the top, terminated by first blank line). */
  var lines = text.split('\n');
  var meta = {}, i = 0, inTitlePage = false, lastKey = null;
  while (i < lines.length) {
    var raw = lines[i];
    var trimmed = raw.trim();
    if (/^\/\*/.test(trimmed) || /^\*\//.test(trimmed)) { i++; continue; }
    if (!trimmed) {
      if (inTitlePage) { i++; break; }
      else { break; }
    }
    var p = parseMetaLine(trimmed);
    if (p) {
      inTitlePage = true; lastKey = p.key; meta[lastKey] = p.value;
      i++; continue;
    }
    if (inTitlePage && /^\s+/.test(raw) && lastKey) {
      meta[lastKey] = (meta[lastKey] ? meta[lastKey] + '\n' : '') + trimmed;
      i++; continue;
    }
    break;
  }
  if (!inTitlePage) meta = {};
  return { meta: meta, rest: lines.slice(i).join('\n') };
}
function defaultTitlePage(title) {
  /* Minimal default when no title page exists yet */
  return { Title: title || 'Untitled Screenplay', Language: '', Contact: '' };
}
function serializeTitlePage(meta) {
  var ORDERED = ['Title','Credit','Author','Source','Draft date','Contact','Language','Notes'];
  var visible = ORDERED.filter(function(k){ return meta[k] !== undefined && meta[k] !== null; });
  var custom = [];
  Object.keys(meta).forEach(function(k){
    if (visible.indexOf(k) >= 0) return;
    if (meta[k] === undefined || meta[k] === null) return;
    var v = String(meta[k]).trim();
    if (!v) return;
    custom.push(k);
  });
  if (!visible.length && !custom.length) return '';

  var out = [];
  visible.forEach(function(k){ out.push(k + ': ' + (meta[k] || '')); });
  if (custom.length) {
    out.push('/*');
    out.push('metas');
    custom.forEach(function(k){ out.push(k + ': ' + meta[k]); });
    out.push('*/');
  }
  out.push('/*Header end*/');
  return out.join('\n');
}

function applyDynamoMode() {
  /* sync st.dynamoMode from metadata, then apply/remove sp-dynamo-off on blocksEl */
  var val = (st.titlePageMeta['Dynamo'] || 'yes').toLowerCase();
  st.dynamoMode = (val !== 'no' && val !== 'false' && val !== 'off');
  if (blocksEl) blocksEl.classList.toggle('sp-dynamo-off', !st.dynamoMode);
}

function fountainToBlocks(text) {
  /* strip & stash title-page metadata before block parsing */
  var tp = parseTitlePage(text);
  /* auto-create a default title page for files that have none */
  st.titlePageMeta = (Object.keys(tp.meta).length) ? tp.meta
    : defaultTitlePage(st.currentTitle || 'Untitled Screenplay');
  /* default Dynamo to yes if not set */
  if (!st.titlePageMeta['Dynamo']) st.titlePageMeta['Dynamo'] = 'yes';
  applyDynamoMode();
  text = tp.rest;
  var lines = text.split('\n');
  var blocks = [], id = 1, i = 0;
  while (i < lines.length) {
    var line = lines[i].trim();
    if (!line) { i++; continue; }

    // standalone [[tag-id]] line (NOVA game tag)
    if (/^\[\[[^\]]+\]\]$/.test(line)) {
      blocks.push({ id: id++, type: 'tag-id', text: line });
      i++; continue;
    }

    // scene heading
    if (/^(INT|EXT|INT\.\/EXT|I\/E)[\s\.]/i.test(line) || /^\.[A-Z]/.test(line)) {
      blocks.push({ id: id++, type: 'scene-heading', text: line.startsWith('.') ? line.slice(1) : line });
      i++; continue;
    }
    // transition  > TEXT
    if (line.startsWith('>') && !line.endsWith('<')) {
      blocks.push({ id: id++, type: 'transition', text: line.slice(1).trim() });
      i++; continue;
    }
    // character (ALL CAPS line followed by dialogue/paren, but NOT scene heading)
    if (line === line.toUpperCase() && /[A-Z]/.test(line) && !line.startsWith('(') && !line.includes('.')) {
      var j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      var next = j < lines.length ? lines[j].trim() : '';
      if (next && (next.startsWith('(') || (next !== next.toUpperCase()))) {
        blocks.push({ id: id++, type: 'character', text: line });
        i++;
        while (i < lines.length && lines[i].trim()) {
          var dl = lines[i].trim();
          if (/^\[\[[^\]]+\]\]$/.test(dl)) blocks.push({ id: id++, type: 'tag-id', text: dl });
          else if (dl.startsWith('(')) blocks.push({ id: id++, type: 'parenthetical', text: dl });
          else blocks.push({ id: id++, type: 'dialogue', text: dl });
          i++;
        }
        continue;
      }
    }
    // parenthetical
    if (line.startsWith('(') && line.endsWith(')')) {
      blocks.push({ id: id++, type: 'parenthetical', text: line });
      i++; continue;
    }
    // action
    blocks.push({ id: id++, type: 'action', text: line });
    i++;
  }
  return blocks.length ? blocks : [{ id: 1, type: 'scene-heading', text: '' }];
}

/* ════ Smart paste classifier ════
   Turn arbitrary clipboard text (plain typed screenplay, copy from a PDF, a
   Google Doc, an email…) into canonical Fountain. The output is then handed
   to the SAME fountainToBlocks parser used on file load — so paste behaviour
   matches file-load behaviour byte-for-byte (one source of truth).

   Rules (first match wins, highest priority on top):
     1 Scene heading  ^(INT|EXT|INT./EXT|I/E|EST)[. ]      conf .99
     2 Forced scene   ^\.[A-Z]                              conf .99
     3 Transition     ^>\s  | ^[A-Z ]+TO:$                  conf .97
     4 Tag-id         ^\[\[…\]\]$                           conf 1.00
     5 Parenthetical  ^\(.+\)$  AND prev was char/dialogue  conf .93
     6 Character cue  short, mostly UPPER, no terminal .!?  conf .85→1.0
        (two-pass: recurring cue ≥2× locks confidence to 1.0)
     7 Dialogue       prev was character/parenthetical      conf .90
     8 Action         everything else                       conf .70                                                 */
function smartParsePaste(text) {
  if (!text) return '';
  // 1. Normalize
  text = text.replace(/\r\n?/g, '\n')
             .replace(/\u00A0/g, ' ')       // NBSP → space
             .replace(/[ \t]+$/gm, '');     // strip trailing whitespace per line
                                             // (also kills markdown `  ` line-breaks)
  var lines = text.split('\n');

  // 2. First pass — tag each line provisionally
  function tagLine(raw) {
    var t = raw.trim();
    if (!t) return { type: 'blank' };
    if (/^(INT|EXT|INT\.\/EXT|I\/E|EST)[\s\.]/i.test(t)) return { type: 'scene', text: t };
    if (/^\.[A-Z]/.test(t))                              return { type: 'scene', text: t.slice(1) };
    if (/^>\s*\S/.test(t) && !/<\s*$/.test(t))           return { type: 'transition', text: t.replace(/^>\s*/, '') };
    if (/^[A-Z][A-Z0-9 ]{2,}TO:$/.test(t))               return { type: 'transition', text: t };
    if (/^\[\[[^\]]+\]\]$/.test(t))                      return { type: 'tag-id', text: t };
    if (/^\(.+\)$/.test(t))                              return { type: 'paren', text: t };
    // character cue candidate: short, mostly uppercase, no terminal . ! ?
    // (allow optional trailing extension like (V.O.), (CONT'D))
    if (t.length <= 38) {
      var bare = t.replace(/\s*\([^)]*\)\s*$/, '');
      var letters = bare.match(/[A-Za-z]/g) || [];
      var uppers  = bare.match(/[A-Z]/g) || [];
      if (letters.length > 0 && uppers.length / letters.length >= 0.85
          && !/[.!?]$/.test(bare)
          && /^[A-Z][A-Z0-9 .'\-#&\/]*$/.test(bare)) {
        return { type: 'char-maybe', text: t, base: bare.trim() };
      }
    }
    return { type: 'unknown', text: t };
  }
  var tags = lines.map(tagLine);

  // 3. Two-pass character lock — any cue seen ≥2× locks in as a real character
  var counts = {};
  tags.forEach(function(g){ if (g.type === 'char-maybe') counts[g.base] = (counts[g.base] || 0) + 1; });

  // 4. Contextual resolution — chars confirmed, unknowns become dialogue/action
  var prev = null, out = [];
  for (var i = 0; i < tags.length; i++) {
    var g = tags[i];
    if (g.type === 'blank') { prev = null; continue; }

    if (g.type === 'scene')      { out.push({ kind: 'scene',      text: g.text }); prev = 'scene';      continue; }
    if (g.type === 'transition') { out.push({ kind: 'transition', text: g.text }); prev = 'transition'; continue; }
    if (g.type === 'tag-id')     { out.push({ kind: 'tag-id',     text: g.text }); prev = 'tag-id';     continue; }

    if (g.type === 'char-maybe') {
      // peek the next non-blank line
      var next = null;
      for (var j = i + 1; j < tags.length; j++) { if (tags[j].type !== 'blank') { next = tags[j]; break; } }
      var recurring = counts[g.base] >= 2;
      // if the next line is clearly a NEW scene/transition, this short upper line is NOT a cue
      if (next && (next.type === 'scene' || next.type === 'transition')) {
        out.push({ kind: 'action', text: g.text }); prev = 'action'; continue;
      }
      // confirm cue when: it recurs OR the very next non-blank is dialogue-shaped
      if (recurring || (next && (next.type === 'paren' || next.type === 'unknown'))) {
        out.push({ kind: 'character', text: g.text }); prev = 'character'; continue;
      }
      // a lone short UPPER line with nothing under it → most likely action / a stage cue
      out.push({ kind: 'action', text: g.text }); prev = 'action'; continue;
    }

    if (g.type === 'paren') {
      if (prev === 'character' || prev === 'dialogue' || prev === 'paren') {
        out.push({ kind: 'parenthetical', text: g.text }); prev = 'paren'; continue;
      }
      out.push({ kind: 'action', text: g.text }); prev = 'action'; continue;
    }

    // unknown: dialogue if it follows a cue/paren/dialogue, else action
    if (prev === 'character' || prev === 'paren' || prev === 'dialogue') {
      out.push({ kind: 'dialogue', text: g.text }); prev = 'dialogue'; continue;
    }
    out.push({ kind: 'action', text: g.text }); prev = 'action';
  }

  // 5. Emit canonical Fountain (blank-line rules match blocksToFountain's expectations)
  /* Dialogue is wrapped to 36 chars / line, breaking only at word boundaries —
     matches the in-game dialogue-box budget so the writer never has to re-flow
     after pasting. Variables/icons keep their literal length here (worst-case
     widening is a separate preview concern). */
  function wrapDialogue(s, max) {
    if (!s) return [''];
    // pre-existing newlines are honored: wrap each paragraph independently
    var paras = s.split('\n');
    var out = [];
    paras.forEach(function(p) {
      var words = p.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); return; }
      var line = '';
      words.forEach(function(w) {
        // a single word longer than the budget: keep it whole, on its own line
        if (w.length > max) {
          if (line) { out.push(line); line = ''; }
          out.push(w);
          return;
        }
        if (!line) { line = w; return; }
        if (line.length + 1 + w.length <= max) line += ' ' + w;
        else { out.push(line); line = w; }
      });
      if (line) out.push(line);
    });
    return out;
  }
  var lines2 = [];
  /* prevKind tracks the LAST emitted kind so we know whether to glue this line
     to the previous one (same speech: cue→paren→dialogue→paren→dialogue) or
     break with a blank line (new speech / scene / action). Fountain requires
     ZERO blank lines inside a dialogue group — a blank line ends the speech
     and makes the next "(text)" a standalone parenthetical and the next
     sentence a stray action line. That is the bug we are fixing here. */
  var prevKind = null;
  function isSpeechPart(k) { return k === 'character' || k === 'parenthetical' || k === 'dialogue'; }
  function emit(k, txt) {
    if (Array.isArray(txt)) { txt.forEach(function(l){ emit(k, l); }); return; }
    var prevIsSpeech = isSpeechPart(prevKind);
    var curIsSpeech  = isSpeechPart(k);
    if (k === 'scene' || k === 'transition' || k === 'action') {
      lines2.push(''); lines2.push(txt); lines2.push('');
    } else if (k === 'tag-id') {
      lines2.push(txt);
    } else if (k === 'character') {
      lines2.push('');           // blank BEFORE every cue starts a new speech
      lines2.push(txt);
    } else { // parenthetical or dialogue
      // glue to previous speech with NO blank line so the cue keeps its group
      if (!prevIsSpeech) lines2.push('');
      lines2.push(txt);
    }
    prevKind = k;
  }
  out.forEach(function(b) {
    switch (b.kind) {
      case 'scene':         emit('scene',         b.text.toUpperCase()); break;
      case 'transition':    emit('transition',    '> ' + b.text.toUpperCase().replace(/^>\s*/, '')); break;
      case 'tag-id':        emit('tag-id',        b.text); break;
      case 'character':     emit('character',     b.text); break;
      case 'parenthetical': emit('parenthetical', b.text); break;
      case 'dialogue':      emit('dialogue',      wrapDialogue(b.text, 36)); break;
      case 'action':        emit('action',        b.text); break;
    }
  });
  return lines2.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ════ WebDAV ════ */
function getToken() {
  var h = document.querySelector('head[data-requesttoken]');
  return h ? h.getAttribute('data-requesttoken') : '';
}

function davFetch(method, path, body) {
  var headers = { 'requesttoken': getToken() };
  var opts = { method: method, credentials: 'same-origin', headers: headers };
  if (method === 'PROPFIND') {
    headers['Depth'] = '1';
    headers['Content-Type'] = 'application/xml';
    opts.body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>';
  }
  if (body !== undefined && method !== 'PROPFIND') {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    opts.body = body;
  }
  return fetch(path, opts);
}

function ensureFolder() {
  return davFetch('MKCOL', DAV_ROOT);
}

// PROPFIND one folder (Depth:1) — Nextcloud allows this (Depth:infinity is disabled).
// Returns { folders: [hrefs], files: [{name, path}] }
function propfindFolder(davPath) {
  var headers = { 'requesttoken': getToken(), 'Depth': '1', 'Content-Type': 'application/xml' };
  var body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
  return fetch(davPath, { method: 'PROPFIND', credentials: 'same-origin', headers: headers, body: body })
    .then(function(res) {
      if (res.status === 404) return { folders: [], files: [] };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text().then(function(xml) {
        var doc = new DOMParser().parseFromString(xml, 'text/xml');
        var folders = [], files = [];
        var basePath = decodeURIComponent(davPath.replace(/\/+$/, ''));
        doc.querySelectorAll('response').forEach(function(r) {
          var href = r.querySelector('href');
          if (!href) return;
          var raw = href.textContent.trim();
          var path = decodeURIComponent(raw);
          // Skip the folder itself
          if (path.replace(/\/+$/, '') === basePath) return;
          var isCollection = !!r.querySelector('resourcetype collection');
          if (isCollection) {
            folders.push(raw);
          } else if (path.toLowerCase().endsWith('.fountain')) {
            var parts = path.split('/').filter(Boolean);
            var filename = parts.pop().replace(/\.fountain$/i, '');
            var userIdx = parts.indexOf(window._SP_USER || '');
            var folder = userIdx >= 0 ? parts.slice(userIdx + 1).join('/') : '';
            var display = folder ? folder + '/' + filename : filename;
            files.push({ name: display, path: path });
          }
        });
        return { folders: folders, files: files };
      });
    });
}

function listFiles() {
  // Recursively walk the user's storage with Depth:1 (Depth:infinity is blocked by Nextcloud).
  var all = [];
  var seen = {};
  function walk(davPath, depth) {
    return propfindFolder(davPath).then(function(res) {
      res.files.forEach(function(f) {
        if (!seen[f.path]) { seen[f.path] = true; all.push(f); }
      });
      // Cap recursion depth to avoid runaway traversal of huge trees.
      if (depth >= 6) return;
      return Promise.all(res.folders.map(function(href) {
        return walk(href, depth + 1);
      }));
    });
  }
  return walk(DAV_USER_ROOT + '/', 0).then(function() {
    all.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return all;
  });
}

function loadFile(path) {
  return davFetch('GET', path).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}

function saveFileToDav(path, content) {
  return ensureFolder().then(function() {
    return davFetch('PUT', path, content);
  }).then(function(res) {
    if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error('HTTP ' + res.status);
    return true;
  });
}

/* ════ UI helpers ════ */
function h(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* reflect the open file path in the page URL (?path=…) so it can be reopened directly */
function syncUrl(path) {
  try {
    var url = new URL(window.location.href);
    if (path) url.searchParams.set('path', path);
    else url.searchParams.delete('path');
    history.replaceState(null, '', url.toString());
  } catch (e) { /* non-fatal */ }
}

/* debounced save-on-change: fires 1.2 s after the last edit.
   Also resets the 30-s idle auto-save so it always runs 30 s after the
   last modification — not on a fixed clock independent of your typing. */
var saveTimer = null;
function scheduleSave() {
  /* reset the idle auto-save window */
  if (st.autoSaveTimer) clearTimeout(st.autoSaveTimer);
  st.autoSaveTimer = setTimeout(function() {
    st.autoSaveTimer = null;
    if (st.blocks && st.blocks.length) {
      var ti = st._autoSaveTitleInput || document.querySelector('.sp-menubar .sp-title-input');
      doSave(null, ti);
    }
  }, 30000);
  /* debounced immediate save */
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function() {
    saveTimer = null;
    if (st.blocks && st.blocks.length) {
      var titleInput = document.querySelector('.sp-menubar .sp-title-input');
      doSave(null, titleInput);
    }
  }, 1200);
}

/* ════ FILE LIST SCREEN ════ */
function showList() {
  var root = document.getElementById('app-content-vue');
  root.innerHTML = '';

  var wrap = h('div', 'sp-list-screen');
  var header = h('div', 'sp-list-header');
  header.appendChild(h('h2', 'sp-list-title', '🎬 Screenplays'));

  var newBtn = h('button', 'sp-new-btn', '+ New Screenplay');
  newBtn.addEventListener('click', function() {
    promptNewFile(root);
  });
  header.appendChild(newBtn);
  wrap.appendChild(header);

  if (st.loading) {
    wrap.appendChild(h('div', 'sp-list-loading', 'Loading…'));
    root.appendChild(wrap);
    return;
  }
  if (st.error) {
    wrap.appendChild(h('div', 'sp-list-error', 'Error: ' + st.error));
    root.appendChild(wrap);
    return;
  }
  if (!st.files.length) {
    wrap.appendChild(h('div', 'sp-list-empty', 'No screenplays yet. Click "+  New Screenplay" to start.'));
    root.appendChild(wrap);
    return;
  }

  var ul = h('ul', 'sp-file-list');
  st.files.forEach(function(f) {
    var li = h('li', 'sp-file-item');
    li.appendChild(h('span', 'sp-file-icon', '📄'));
    li.appendChild(h('span', 'sp-file-name', f.name));
    li.addEventListener('click', function() {
      li.textContent = 'Loading…';
      loadFile(f.path).then(function(text) {
        openEditor(f.path, f.name, fountainToBlocks(text), text);
      }).catch(function(e) { alert('Cannot open: ' + e.message); showList(); });
    });
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  root.appendChild(wrap);
}

function promptNewFile(root) {
  var name = prompt('Screenplay name:', 'Untitled Screenplay');
  if (!name) return;
  name = name.trim() || 'Untitled Screenplay';
  openEditor(null, name, [{ id: st.nextId++, type: 'scene-heading', text: '' }]);
}

/* ── inline [[tag]] renderer ── */
var SPELL_LEXICON = null;
var SPELL_LEXICON_LIST = null;
var SPELL_LEXICON_LANG = '';
var SPELL_LEXICON_LOADING = false;
function getScriptBasePath() {
  var s = document.querySelector('script[src*="screenplay-main.js"]');
  if (!s) return '';
  var src = s.getAttribute('src') || '';
  return src.replace(/\/screenplay-main\.js(?:\?.*)?$/, '');
}
function effectiveSpellLang() {
  var l = (st.titlePageMeta && st.titlePageMeta['Language']) ||
          (navigator.language || navigator.userLanguage || '');
  return (l || '').toLowerCase().replace(/-.*/, '');
}
function ensureSpellLexicon() {
  /* We ship an English lexicon and use it for Latin-script typo detection
     regardless of document language (so e.g. detaails is still caught even
     when Language metadata is not set to en). */
  if (SPELL_LEXICON && SPELL_LEXICON_LANG === 'en') return;

  /* Fast path: template embeds lexicon directly (most reliable across NC
     routes, CSP, and cache behavior). */
  if (window._SP_LEXICON_EN && window._SP_LEXICON_EN.length) {
    var embeddedSet = {};
    var embeddedList = [];
    for (var ei = 0; ei < window._SP_LEXICON_EN.length; ei++) {
      var ew = String(window._SP_LEXICON_EN[ei] || '').trim().toLowerCase();
      if (!ew) continue;
      embeddedSet[ew] = true;
      embeddedList.push(ew);
    }
    SPELL_LEXICON = embeddedSet;
    SPELL_LEXICON_LIST = embeddedList;
    SPELL_LEXICON_LANG = 'en';
    return;
  }

  if (SPELL_LEXICON_LOADING) return;
  SPELL_LEXICON_LOADING = true;
  var base = getScriptBasePath();
  var urls = [];
  if (base) urls.push(base + '/lexicon-en-20k.txt');
  urls.push('js/lexicon-en-20k.txt');
  urls.push('./js/lexicon-en-20k.txt');
  urls.push('/custom_apps/screenplay/js/lexicon-en-20k.txt');
  urls.push('/index.php/apps/screenplay/js/lexicon-en-20k.txt');
  if (window.OC && typeof window.OC.generateUrl === 'function') {
    urls.push(window.OC.generateUrl('/apps/screenplay/js/lexicon-en-20k.txt'));
  }
  /* de-dup while preserving order */
  var seen = {}, candidates = [];
  urls.forEach(function(u){ if (u && !seen[u]) { seen[u] = true; candidates.push(u); } });

  function tryFetch(i) {
    if (i >= candidates.length) return Promise.reject(new Error('lexicon not found at any candidate URL'));
    return fetch(candidates[i], { cache: 'force-cache' }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).catch(function() {
      return tryFetch(i + 1);
    });
  }

  tryFetch(0).then(function(t) {
    var set = {};
    var list = [];
    t.split(/\r?\n/).forEach(function(w) {
      w = w.trim().toLowerCase();
      if (w) {
        set[w] = true;
        list.push(w);
      }
    });
    SPELL_LEXICON = set;
    SPELL_LEXICON_LIST = list;
    SPELL_LEXICON_LANG = 'en';
    renderBlocks(); /* refresh typo marks once dictionary arrives */
  }).catch(function(err) {
    SPELL_LEXICON = null;
    SPELL_LEXICON_LIST = null;
    SPELL_LEXICON_LANG = '';
    /* keep a breadcrumb for debugging in DevTools */
    if (window.console && console.warn) console.warn('DYNAMO lexicon load failed:', err && err.message ? err.message : err);
  }).finally(function() {
    SPELL_LEXICON_LOADING = false;
  });
}
function renderFallbackTypos(rawLine, escapedLine) {
  if (!st.spellMode) return escapedLine;
  var dict = getDictionary();
  var dictSet = {};
  dict.forEach(function(w){ dictSet[w] = true; });
  var canUseLexicon = !!SPELL_LEXICON;
  var seen = {};
  var re = /[A-Za-z']+/g;
  var m;
  while ((m = re.exec(rawLine))) {
    var w = m[0];
    var lw = w.toLowerCase();
    if (seen[lw]) continue;
    seen[lw] = true;
    if (dictSet[lw]) continue;
    if (w.length < 3) continue;
    /* leave ALL-CAPS cues/names alone */
    if (w === w.toUpperCase()) continue;
    var looksWrong = false;
    if (canUseLexicon) {
      /* dictionary-based check */
      looksWrong = !SPELL_LEXICON[lw];
    } else {
      /* fallback heuristic when lexicon is not available */
      looksWrong = /(.)\1\1/i.test(w);
    }
    if (!looksWrong) continue;
    var esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    escapedLine = escapedLine.replace(new RegExp('\\b' + esc + '\\b', 'g'), '<span class="sp-typo-fallback">' + w + '</span>');
  }
  return escapedLine;
}

function renderInline(text, type) {
  if (!text) return '';
  /* standalone tag-id label: collapse the whole [[id]] to a tiny caret marker
     in the gutter — the id itself shows on hover (title), so it stops stealing
     visual hierarchy from the dialogue. */
  if (type === 'tag-id') {
    var inner = (text.match(/\[\[([^\]]+)\]\]/) || [])[1] || text;
    var idEsc = inner.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return '<span class="sp-chip sp-chip-caret" title="' + idEsc + '">&#9656;</span>';
  }
  var checkLimit = (type === 'dialogue');
  return text.split('\n').map(function(line) {
    /* worst-case length: a variable [[t##]] is replaced in-game by a real value,
       so it counts at its MAX width — the 12-char "[##Variable]" placeholder —
       while every other [[…]] tag collapses to nothing for the 36-char check */
    var clean = line
      .replace(/\[\[t(\d{2})\]\]/g, '[$1Variable]')
      .replace(/\[\[[^\]]*\]\]/g, '');
    var over = checkLimit && clean.length > 36;
    var safe = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    safe = renderFallbackTypos(line, safe);
    safe = safe.replace(/\[\[h\]\]([\s\S]*?)\[\[\/h\]\]/g, '<mark class="sp-hl">$1</mark>');
    safe = safe.replace(/\[\[(c\d{2})\]\]/g, '<span class="sp-chip sp-chip-icon" title="icon">[$1]</span>');
    safe = safe.replace(/\[\[t(\d{2})\]\]/g, '<span class="sp-chip sp-chip-var" title="variable (max width)">[$1Variable]</span>');
    safe = safe.replace(/\[\[([^\]]+)\]\]/g, '<span class="sp-chip sp-chip-tag">$1</span>');
    return over
      ? '<span class="sp-line-over">' + safe + '<span class="sp-line-over-badge">' + clean.length + '</span></span>'
      : safe;
  }).join('\n');
}

/* ════ EDITOR SCREEN ════ */
var blocksEl = null, mobileBarEl = null, menuBarEl = null;

function openEditor(path, title, blocks, rawText) {
  st.currentPath = path;
  st.currentTitle = title;
  /* NOTE: do NOT reset st.titlePageMeta here — fountainToBlocks() is called
     as the argument that produces `blocks`, so it has already populated
     st.titlePageMeta by the time we arrive here. Resetting it would discard
     all the metadata that was just parsed from the file. */
  st.blocks = blocks;
  /* CRITICAL: reset nextId from the loaded document so future inserts get
     globally unique IDs. If nextId stays low (e.g. 1), newly inserted lines
     reuse IDs that already exist in older blocks; then drag-handle resolution
     by id can target the wrong row and move unrelated character/dialogue lines. */
  var maxId = 0;
  st.blocks.forEach(function(b) {
    if (b && typeof b.id === 'number' && b.id > maxId) maxId = b.id;
  });
  st.nextId = maxId + 1;
  st.focusedIdx = 0;
  st.selectionMode = false;
  st.selectedBlocks = [];
  /* seed undo history so Cmd+Z can always return to the loaded state */
  st.history = [JSON.stringify(blocks)];
  st.historyIdx = 0;
  /* the exact bytes that are on disk right now — the Fountain baseline. Used to
     (a) skip pointless re-saves and (b) detect when another tab/process changed
     the file out from under us so we can ask the user which version to keep. */
  st.savedContent = (typeof rawText === 'string') ? rawText : blocksToFountain(blocks);

  var root = document.getElementById('app-content-vue');
  root.innerHTML = '';

  var editor = h('div', 'sp-editor');
  editor.classList.toggle('sp-mobile', window.innerWidth < 768);
  window.addEventListener('resize', function() {
    editor.classList.toggle('sp-mobile', window.innerWidth < 768);
  });

  /* ── classic word-processor chrome: menu bar (File·Edit·Format·View) + element toolbar ── */
  var chrome = h('div', 'sp-chrome');

  /* ROW 1 — menu bar: brand · menu words · title · save */
  var menubar = h('div', 'sp-menubar');

  /* brand: thunderbolt logo (three staggered strokes) + DYNAMO wordmark */
  var brand = h('div', 'sp-brand');
  brand.title = 'DYNAMO — screenplay editor for videogames' + (window._SP_BUILD ? (' (build ' + window._SP_BUILD + ')') : '');
  brand.innerHTML =
    '<svg class="sp-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<line x1="3"  y1="5"  x2="17" y2="5"  />' +
      '<line x1="8"  y1="12" x2="21" y2="12" />' +
      '<line x1="14" y1="19" x2="21" y2="19" />' +
    '</svg>' +
    '<span class="sp-brand-text">DYNAMO</span>';
  menubar.appendChild(brand);

  /* menu words (File/Edit/Format/View) — rebuilt by renderBar() */
  menuBarEl = h('div', 'sp-menus');
  menubar.appendChild(menuBarEl);

  /* flexible gap pushes title + save to the right */
  menubar.appendChild(h('div', 'sp-menu-spacer'));

  /* file title: looks like plain text, click to edit */
  var titleInput = h('input', 'sp-title-input');
  titleInput.value = st.currentTitle;
  titleInput.spellcheck = false;
  titleInput.title = 'Click to rename';
  titleInput.addEventListener('input', function() {
    st.currentTitle = titleInput.value;
    scheduleSave();
  });
  menubar.appendChild(titleInput);

  var lastSavedDisp = h('span', 'sp-last-saved', '');
  lastSavedDisp.id = 'sp-last-saved';
  menubar.appendChild(lastSavedDisp);

  /* preview sidebar toggle: a [ |] panel icon (box with a right-hand divider) */
  var previewBtn = h('button', 'sp-preview-btn');
  previewBtn.id = 'sp-preview-btn';
  previewBtn.title = 'Toggle preview panel';
  previewBtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
      '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<line x1="10.5" y1="2.5" x2="10.5" y2="13.5" stroke="currentColor" stroke-width="1.3"/>' +
    '</svg>';
  previewBtn.addEventListener('click', function(){ setDockPreview(!st.dockPreview); });
  menubar.appendChild(previewBtn);

  var saveTopBtn = h('button', 'sp-save-btn');
  saveTopBtn.innerHTML = '<span class="sp-save-ico">\uD83D\uDCBE</span> Save';
  saveTopBtn.title = 'Save (\u2318S)';
  saveTopBtn.addEventListener('click', function() {
    if (NATIVE) NATIVE.cmd('save'); else doSave(saveTopBtn, titleInput);
  });
  menubar.appendChild(saveTopBtn);

  chrome.appendChild(menubar);

  /* ROW 2 — element-type icon toolbar (rebuilt by renderBar) */
  mobileBarEl = h('div', 'sp-typebar');
  chrome.appendChild(mobileBarEl);

  /* expose handlers the menus need */
  window._spDoSave = function() { doSave(saveTopBtn, titleInput); };

  /* reflect the open file in the URL so it can be reopened directly */
  syncUrl(st.currentPath);

  /* Safety auto-save: fires 30 s after the LAST edit (not on a fixed clock).
     scheduleSave resets this timer on every keystroke, so it only runs when
     you've been idle for 30 s — not blindly every 30 s regardless of activity.
     doSave is conflict-aware and skips writes when nothing changed. */
  if (st.autoSaveTimer) clearTimeout(st.autoSaveTimer);
  st.autoSaveTimer = null;
  st._autoSaveTitleInput = titleInput;  /* keep ref for the deferred save */
  ensureSpellLexicon();

  /* layout */
  var layout = h('div', 'sp-layout');
  var area = h('div', 'sp-script-area');
  var page = h('div', 'sp-page');
  /* title card — locked, non-editable; edit only via Document Info modal */
  var titleCard = h('div', 'sp-title-card');
  titleCard.id = 'sp-title-card';
  page.appendChild(titleCard);
  blocksEl = page;
  setupDragSelect(page);
  setupGutterAdd(area);
  area.appendChild(page);
  renderTitleCard();
  layout.appendChild(area);

  /* ── foldable PREVIEW SIDE SECTION: a grey panel pinned to the right that
     shows the live preview for the focused tag group. Enabling it pushes the
     script editor left (sp-script-area is flex:1) so it never overlaps. A
     draggable separator on its left edge resizes the panel. ── */
  var dockSep = h('div', 'sp-dock-sep');
  dockSep.id = 'sp-dock-sep';
  dockSep.title = 'Drag to resize';
  layout.appendChild(dockSep);

  var dock = h('div', 'sp-dock');
  dock.id = 'sp-dock';
  var dockHead = h('div', 'sp-dock-head');
  dockHead.innerHTML = '<span class="sp-dock-title">PREVIEW</span>';
  var dockClose = h('button', 'sp-dock-close', '\u00D7');
  dockClose.title = 'Close preview panel';
  dockClose.addEventListener('click', function(){ setDockPreview(false); });
  dockHead.appendChild(dockClose);
  var dockBody = h('div', 'sp-dock-body');
  dockBody.id = 'sp-dock-body';
  dock.appendChild(dockHead);
  dock.appendChild(dockBody);
  layout.appendChild(dock);
  setupDockResize(dockSep, dock);

  /* ── bottom status bar: page count · zoom controls (− / 100% ▾ / +) ── */
  var statusbar = h('div', 'sp-statusbar');

  var statLeft = h('div', 'sp-status-left');
  statLeft.id = 'sp-status-left';
  statusbar.appendChild(statLeft);

  var zoomWrap = h('div', 'sp-zoom');

  var zoomOut = h('button', 'sp-zoom-btn', '\u2212');
  zoomOut.title = 'Zoom out';
  zoomOut.addEventListener('click', function(){ setZoom(st.zoom - 0.1); });

  /* current-zoom button opens a preset menu (like Final Draft / Word) */
  var zoomDd = h('div', 'sp-zoom-dd');
  var zoomVal = h('button', 'sp-zoom-val', '100%');
  zoomVal.id = 'sp-zoom-val';
  zoomVal.title = 'Zoom';
  var zoomMenu = h('div', 'sp-zoom-menu');
  [50, 75, 90, 100, 125, 150, 200].forEach(function(p){
    var it = h('button', 'sp-zoom-item', p + '%');
    it.addEventListener('mousedown', function(e){ e.preventDefault(); });
    it.addEventListener('click', function(e){ e.stopPropagation(); zoomDd.classList.remove('open'); setZoom(p / 100); });
    zoomMenu.appendChild(it);
  });
  zoomVal.addEventListener('mousedown', function(e){ e.preventDefault(); });
  zoomVal.addEventListener('click', function(e){
    e.stopPropagation();
    var willOpen = !zoomDd.classList.contains('open');
    document.querySelectorAll('.sp-zoom-dd.open').forEach(function(d){ d.classList.remove('open'); });
    if (willOpen) zoomDd.classList.add('open');
  });
  zoomDd.appendChild(zoomVal);
  zoomDd.appendChild(zoomMenu);

  var zoomIn = h('button', 'sp-zoom-btn', '+');
  zoomIn.title = 'Zoom in';
  zoomIn.addEventListener('click', function(){ setZoom(st.zoom + 0.1); });

  var zoomSlider = h('input', 'sp-zoom-slider');
  zoomSlider.type = 'range';
  zoomSlider.min = '50'; zoomSlider.max = '200'; zoomSlider.step = '5';
  zoomSlider.value = String(Math.round(st.zoom * 100));
  zoomSlider.id = 'sp-zoom-slider';
  zoomSlider.title = 'Zoom';
  zoomSlider.addEventListener('input', function(){ setZoom(parseInt(zoomSlider.value, 10) / 100); });

  zoomWrap.appendChild(zoomOut);
  zoomWrap.appendChild(zoomDd);
  zoomWrap.appendChild(zoomIn);
  zoomWrap.appendChild(zoomSlider);
  statusbar.appendChild(zoomWrap);

  if (!window._spZoomCloser) {
    window._spZoomCloser = true;
    document.addEventListener('click', function(){
      document.querySelectorAll('.sp-zoom-dd.open').forEach(function(d){ d.classList.remove('open'); });
    });
  }

  editor.appendChild(chrome);
  editor.appendChild(layout);
  editor.appendChild(statusbar);
  root.appendChild(editor);

  applyZoom();
  renderBlocks();
  renderBar();
  applyDockPreview();
}

/* ── foldable preview dock ── */
function setDockPreview(on) {
  st.dockPreview = !!on;
  applyDockPreview();
  renderBar(); /* refresh the View-menu check mark */
}
function applyDockPreview() {
  var editor = document.querySelector('.sp-editor');
  if (editor) editor.classList.toggle('sp-dock-open', !!st.dockPreview);
  var btn = document.getElementById('sp-preview-btn');
  if (btn) btn.classList.toggle('active', !!st.dockPreview);
  /* the resize drag writes inline width onto the dock; those inline styles win
     over the CSS collapse rule, so we must clear them when closing — otherwise
     "hide" leaves the panel stuck open at its dragged width */
  var dock = document.getElementById('sp-dock');
  if (dock) {
    if (st.dockPreview) {
      dock.style.flexBasis = st.dockWidth + 'px';
      dock.style.width = st.dockWidth + 'px';
    } else {
      dock.style.flexBasis = '';
      dock.style.width = '';
    }
  }
  if (st.dockPreview) { hideGamePreview(); renderDockPreview(); }
}
/* drag the separator on the dock's left edge to resize the preview panel */
function setupDockResize(sep, dock) {
  var dragging = false;
  sep.addEventListener('mousedown', function(ev){
    if (ev.button !== 0 || !st.dockPreview) return;
    ev.preventDefault();
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(ev){
    if (!dragging) return;
    var layout = dock.parentNode;
    var rect = layout.getBoundingClientRect();
    var w = rect.right - ev.clientX;
    w = Math.max(220, Math.min(rect.width - 280, w));
    st.dockWidth = Math.round(w);
    dock.style.flexBasis = st.dockWidth + 'px';
    dock.style.width = st.dockWidth + 'px';
  });
  document.addEventListener('mouseup', function(){
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
/* Given a block index, find the tag-id that OWNS its dialogue group (or the tag
   itself), so the dock can show the right preview for whatever line is focused.
   Returns -1 when the block isn't part of a dynamo group. */
function gameGroupTagIdxForBlock(idx) {
  var blocks = st.blocks;
  if (idx < 0 || idx >= blocks.length) return -1;
  if (blocks[idx].type === 'tag-id') return idx;
  for (var b = idx; b >= 0; b--) {
    var t = blocks[b].type;
    if (t === 'tag-id') return b;
    if (t === 'scene-heading' || t === 'action' || t === 'transition' || t === 'general') return -1;
  }
  return -1;
}
/* Fill the dock body with the preview for the currently focused tag group. */
function renderDockPreview() {
  if (!st.dockPreview) return;
  var body = document.getElementById('sp-dock-body');
  if (!body) return;
  var idx = st.focusedIdx;
  if (idx < 0 && st.selectedBlocks.length) idx = st.selectedBlocks[0];
  var tagIdx = gameGroupTagIdxForBlock(idx);
  if (tagIdx < 0) {
    body.innerHTML = '<div class="sp-dock-empty">Click a dynamo tag or its dialogue to preview it here.</div>';
    return;
  }
  var html = buildGamePreviewHtml(computeGameGroup(tagIdx));
  body.innerHTML = html || '<div class="sp-dock-empty">No dialogue in this dynamo yet.</div>';
}

/* ── zoom (Final-Draft style page zoom) ── */
function applyZoom() {
  var page = blocksEl;
  if (page) page.style.zoom = st.zoom;
  var val = document.getElementById('sp-zoom-val');
  if (val) val.textContent = Math.round(st.zoom * 100) + '%';
  var sl = document.getElementById('sp-zoom-slider');
  if (sl) sl.value = String(Math.round(st.zoom * 100));
}
function setZoom(z) {
  z = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100));
  st.zoom = z;
  applyZoom();
}

function reloadList() {
  if (st.autoSaveTimer) { clearTimeout(st.autoSaveTimer); st.autoSaveTimer = null; }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  syncUrl(null);
  st.loading = true;
  showList();
  listFiles().then(function(f) {
    st.files = f; st.loading = false; st.error = null; showList();
  }).catch(function(e) {
    st.error = e.message; st.loading = false; showList();
  });
}

function doSave(btn, titleInput) {
  var title = (titleInput ? titleInput.value.trim() : st.currentTitle) || 'Untitled Screenplay';
  st.currentTitle = title;
  var filename = title.replace(/[\/\\:*?"<>|]/g, '-') + '.fountain';
  // If opened from an existing path keep saving there; new files go to /Screenplays/
  var path = st.currentPath || (DAV_ROOT + '/' + encodeURIComponent(filename));
  var content = blocksToFountain(st.blocks);

  /* nothing changed locally → nothing to write. (Keeps an untouched/stale tab
     from doing pointless PUTs, but does NOT suppress real edits.) */
  if (content === st.savedContent && st.currentPath) {
    if (btn) { btn.innerHTML = '<span class="sp-save-ico">\uD83D\uDCBE</span> Saved \u2713'; setTimeout(function(){ btn.innerHTML = '<span class="sp-save-ico">\uD83D\uDCBE</span> Save'; btn.disabled=false; }, 1000); }
    return;
  }

  /* New file (no path yet) → just write it. */
  if (!st.currentPath) { writeSave(path, content, btn); return; }

  /* We HAVE local changes. Before overwriting, check whether the file on disk
     changed since we opened it (another tab / external editor). If it did, we
     must NOT silently clobber it — ask the user which version to keep. */
  if (st.conflictOpen) return; /* a conflict prompt is already up */
  loadFile(path).then(function(diskText) {
    /* Normalise both sides before comparing — Nextcloud WebDAV may return the
       file with a trailing newline or \r\n line endings that our serialiser
       doesn't emit, which would cause a false conflict on every single save
       even though no other editor touched the file. */
    function norm(s) { return s.replace(/\r\n?/g, '\n').trim(); }
    if (norm(diskText) !== norm(st.savedContent)) {
      showConflictDialog(path, diskText, content, btn);
    } else {
      writeSave(path, content, btn);
    }
  }).catch(function() {
    /* file vanished / first write of a renamed file → just save ours */
    writeSave(path, content, btn);
  });
}

/* perform the actual PUT and update the on-disk baseline.
   Silently retries on HTTP 423 (WebDAV lock — Nextcloud releases locks
   asynchronously, so a rapid save can race its own previous lock) and 503
   (transient server hiccup). Up to 3 attempts with gentle backoff.
   Never shows an alert — save errors go to the status bar only. */
function writeSave(path, content, btn, _attempt) {
  var attempt = _attempt || 1;
  var FLOPPY = '<span class="sp-save-ico">\uD83D\uDCBE</span> ';
  if (btn && attempt === 1) { btn.innerHTML = FLOPPY + 'Saving\u2026'; btn.disabled = true; }
  saveFileToDav(path, content).then(function(res) {
    st.currentPath = path;
    st.savedContent = content;
    st.lastSaved = new Date();
    updateLastSavedDisplay();
    syncUrl(path);
    if (btn) { btn.innerHTML = FLOPPY + 'Saved \u2713'; setTimeout(function(){ btn.innerHTML = FLOPPY + 'Save'; btn.disabled=false; }, 1500); }
    showSaveStatus(null);
  }).catch(function(e) {
    var msg = e.message || '';
    var status = parseInt(msg.replace(/\D/g,''), 10) || 0;
    /* 423 = locked, 503 = unavailable — both transient, safe to retry */
    if ((status === 423 || status === 503) && attempt < 4) {
      var delay = attempt * 1800;  /* 1.8s, 3.6s, 5.4s */
      showSaveStatus('\u23F3');
      setTimeout(function(){ writeSave(path, content, btn, attempt + 1); }, delay);
      return;
    }
    if (btn) { btn.innerHTML = FLOPPY + 'Save'; btn.disabled = false; }
    /* never alert — show a subtle error badge in the status bar */
    showSaveStatus('\u26A0\uFE0F ' + (status || msg));
  });
}
/* Show a transient save-error/pending indicator in the last-saved area */
/* ── Title card: locked display of the Fountain title page above the script ─ */
function renderTitleCard() {
  var card = document.getElementById('sp-title-card');
  if (!card) return;
  var meta = st.titlePageMeta || {};
  var title   = meta['Title']    || st.currentTitle || 'Untitled Screenplay';
  var author  = meta['Author']   || meta['Credit']  || '';
  var lang    = meta['Language'] || '';
  var contact = meta['Contact']  || '';
  var isDynamo = (meta['Dynamo'] || 'yes').toLowerCase() !== 'no';

  card.innerHTML =
    '<div class="sp-tc-inner">' +
      '<div class="sp-tc-title">' + escHtml(title) + '</div>' +
      (author  ? '<div class="sp-tc-author">' + escHtml(author) + '</div>' : '') +
      '<div class="sp-tc-badges">' +
        (lang ? '<span class="sp-tc-badge">' + escHtml(lang.toUpperCase()) + '</span>' : '') +
        '<span class="sp-tc-badge ' + (isDynamo ? 'sp-tc-badge-dynamo' : 'sp-tc-badge-plain') + '">' +
          (isDynamo ? 'DYNAMO' : 'Screenplay') +
        '</span>' +
      '</div>' +
      (contact ? '<div class="sp-tc-meta">' + escHtml(contact) + '</div>' : '') +
    '</div>' +
    '<button class="sp-tc-edit" title="Edit document info">&#9998; Edit</button>';

  card.querySelector('.sp-tc-edit').addEventListener('click', function(e){
    e.stopPropagation();
    showDocInfoModal();
  });
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── File → Download .fountain ──────────────────────────────────────────── */
function downloadFountain() {
  var content = blocksToFountain(st.blocks);
  var title = (st.currentTitle || 'screenplay').replace(/[\/\\:*?"<>|]/g, '-');
  var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = title + '.fountain';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

/* ── File → Document Info… — Fountain title-page key/value editor ───────── */
function showDocInfoModal() {
  if (!st.titlePageMeta) st.titlePageMeta = {};
  var meta = st.titlePageMeta;

  /* Fields that get plain text inputs (Language is now a dropdown) */
  var FIELDS = ['Title','Credit','Author','Source','Draft date','Contact','Notes'];

  var LANGUAGES = [
    ['','(detect from browser)'],
    ['en','en — English'],['es','es — Spanish'],['fr','fr — French'],
    ['de','de — German'],['it','it — Italian'],['pt','pt — Portuguese'],
    ['ru','ru — Russian'],['ja','ja — Japanese'],['zh','zh — Chinese'],
    ['ko','ko — Korean'],['ar','ar — Arabic'],['hi','hi — Hindi'],
    ['nl','nl — Dutch'],['pl','pl — Polish'],['sv','sv — Swedish'],
    ['tr','tr — Turkish'],['uk','uk — Ukrainian'],['vi','vi — Vietnamese'],
    ['id','id — Indonesian'],['fi','fi — Finnish'],['nb','nb — Norwegian'],
    ['da','da — Danish'],['cs','cs — Czech'],['el','el — Greek'],
    ['he','he — Hebrew'],['ro','ro — Romanian'],['hu','hu — Hungarian'],
  ];
  var detectedLang = (navigator.language || navigator.userLanguage || '').replace(/-.*$/, '');
  var currentLang = meta['Language'] || detectedLang || '';

  var overlay = h('div', 'sp-conflict-overlay');
  var modal   = h('div', 'sp-docinfo-modal');

  var hdr = h('div', 'sp-docinfo-header', 'Document Info');
  modal.appendChild(hdr);

  var body = h('div', 'sp-docinfo-body');

  /* Dynamo mode dropdown */
  (function(){
    var row = h('div', 'sp-docinfo-row');
    var lbl = h('label', 'sp-docinfo-lbl', 'Dynamo:');
    var sel = document.createElement('select');
    sel.className = 'sp-docinfo-inp';
    [['yes','Yes \u2014 game screenplay (tags, box limits, character limits)'],
     ['no', 'No  \u2014 pure screenplay (Fountain only, no game features)']].forEach(function(opt){
      var o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1];
      if ((meta['Dynamo'] || 'yes').toLowerCase() === opt[0]) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(lbl); row.appendChild(sel);
    body.appendChild(row);
    body._dynamoSel = sel;
  })();

  /* Language dropdown */
  (function(){
    var row = h('div', 'sp-docinfo-row');
    var lbl = h('label', 'sp-docinfo-lbl', 'Language:');
    var sel = document.createElement('select');
    sel.className = 'sp-docinfo-inp';
    var matched = false;
    LANGUAGES.forEach(function(pair){
      var o = document.createElement('option');
      o.value = pair[0]; o.textContent = pair[1];
      if (pair[0] && pair[0] === currentLang) { o.selected = true; matched = true; }
      sel.appendChild(o);
    });
    /* if the stored/detected language isn't in our list, add it */
    if (currentLang && !matched) {
      var o = document.createElement('option');
      o.value = currentLang; o.textContent = currentLang; o.selected = true;
      sel.insertBefore(o, sel.children[1]);
    }
    row.appendChild(lbl); row.appendChild(sel);
    body.appendChild(row);
    body._langSel = sel;
  })();

  var sep = h('div', 'sp-docinfo-sep');
  body.appendChild(sep);

  var inputs = {};
  FIELDS.forEach(function(key) {
    var row = h('div', 'sp-docinfo-row');
    var lbl = h('label', 'sp-docinfo-lbl', key + ':');
    var inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'sp-docinfo-inp';
    inp.value = meta[key] || '';
    inputs[key] = inp;
    row.appendChild(lbl); row.appendChild(inp);
    body.appendChild(row);
  });
  modal.appendChild(body);

  var foot = h('div', 'sp-docinfo-foot');
  var cancelBtn = h('button', 'sp-docinfo-btn', 'Cancel');
  cancelBtn.addEventListener('click', function(){ document.body.removeChild(overlay); });
  var saveBtn = h('button', 'sp-docinfo-btn sp-docinfo-apply', 'Apply');
  saveBtn.addEventListener('click', function(){
    meta['Dynamo'] = body._dynamoSel.value;
    var lang = body._langSel.value || detectedLang || '';
    if (lang) meta['Language'] = lang; else delete meta['Language'];
    FIELDS.forEach(function(key){
      var val = inputs[key].value.trim();
      if (val) meta[key] = val;
      else delete meta[key];
    });
    st.titlePageMeta = meta;
    applyDynamoMode();
    ensureSpellLexicon();
    document.body.removeChild(overlay);
    renderTitleCard();
    renderBlocks();
    scheduleSave();
  });
  foot.appendChild(cancelBtn); foot.appendChild(saveBtn);
  modal.appendChild(foot);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  setTimeout(function(){ body._langSel.focus(); }, 50);
}

/* ── Script dictionary: words stored in Fountain metadata so collaborators
   and future opens know they are intentional (character names, made-up words,
   proper nouns, etc.).  Stored as: Dictionary: word1, word2, word3  ─────── */
function getDictionary() {
  var raw = (st.titlePageMeta && st.titlePageMeta['Dictionary']) || '';
  return raw ? raw.split(',').map(function(w){ return w.trim().toLowerCase(); }).filter(Boolean) : [];
}
function addToDictionary(word) {
  if (!word || word.length < 2) return;
  word = word.toLowerCase();
  var dict = getDictionary();
  if (dict.indexOf(word) >= 0) return; /* already there */
  dict.push(word);
  if (!st.titlePageMeta) st.titlePageMeta = {};
  st.titlePageMeta['Dictionary'] = dict.join(', ');
  scheduleSave();
  renderTitleCard();
  renderBlocks();
  if (st.focusedIdx >= 0) focusTA(st.focusedIdx);
}
function isKnownWord(word) {
  var lw = (word || '').toLowerCase();
  if (!lw) return true;
  if (getDictionary().indexOf(lw) >= 0) return true;
  if (SPELL_LEXICON) return !!SPELL_LEXICON[lw];
  return false;
}
function editDistanceCapped(a, b, cap) {
  var al = a.length, bl = b.length;
  if (Math.abs(al - bl) > cap) return cap + 1;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= bl; j++) prev[j] = j;
  for (i = 1; i <= al; i++) {
    cur[0] = i;
    var rowMin = cur[0];
    for (j = 1; j <= bl; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    var tmp = prev; prev = cur; cur = tmp;
  }
  return prev[bl];
}
function getSuggestions(word, maxN) {
  var out = [];
  var lw = (word || '').toLowerCase();
  if (!lw || !SPELL_LEXICON_LIST || !SPELL_LEXICON_LIST.length) return out;
  var first = lw[0];
  for (var i = 0; i < SPELL_LEXICON_LIST.length; i++) {
    var cand = SPELL_LEXICON_LIST[i];
    if (cand === lw) continue;
    if (Math.abs(cand.length - lw.length) > 2) continue;
    if (cand[0] !== first) continue;
    var d = editDistanceCapped(lw, cand, 2);
    if (d <= 2) out.push({ w: cand, d: d, rank: i });
  }
  out.sort(function(a, b) { return (a.d - b.d) || (a.rank - b.rank); });
  return out.slice(0, maxN).map(function(x){ return x.w; });
}
function getWordAtCaret(ta) {
  var pos = ta.selectionStart;
  var text = ta.value;
  var start = pos, end = pos;
  while (start > 0 && /[\w']/.test(text[start - 1])) start--;
  while (end < text.length && /[\w']/.test(text[end])) end++;
  return { word: text.slice(start, end), start: start, end: end };
}
function findFirstUnknownWord(text) {
  var re = /[A-Za-z']+/g, m;
  while ((m = re.exec(text))) {
    var w = m[0];
    if (w.length < 3) continue;
    if (w === w.toUpperCase()) continue;
    if (!isKnownWord(w)) return { word: w, start: m.index, end: m.index + w.length };
  }
  return null;
}
function getWordAtPoint(x, y) {
  var node = null, offset = 0;
  if (document.caretPositionFromPoint) {
    var p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  } else if (document.caretRangeFromPoint) {
    var r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  }
  if (!node || node.nodeType !== 3) return null;
  var text = node.nodeValue || '';
  var start = offset, end = offset;
  while (start > 0 && /[\w']/.test(text[start - 1])) start--;
  while (end < text.length && /[\w']/.test(text[end])) end++;
  var w = text.slice(start, end);
  return w ? { word: w } : null;
}

/* custom context menu for spell/dict actions — closes on click-outside */
var _spellMenuEl = null;
function closeSpellMenu() {
  if (_spellMenuEl && _spellMenuEl.parentNode) _spellMenuEl.parentNode.removeChild(_spellMenuEl);
  _spellMenuEl = null;
}
function showSpellContextMenu(opts) {
  var word = opts.word;
  var x = opts.x, y = opts.y;
  var replaceFn = opts.replaceFn;
  closeSpellMenu();
  var menu = h('div', 'sp-spell-menu');
  var inDict = getDictionary().indexOf(word.toLowerCase()) >= 0;
  var known = isKnownWord(word);

  var title = h('div', 'sp-spell-word', '\u201c' + word + '\u201d');
  menu.appendChild(title);

  if (!known) {
    var sugs = getSuggestions(word, 5);
    if (sugs.length) {
      sugs.forEach(function(s) {
        var b = h('button', 'sp-spell-item', 'Replace with "' + s + '"');
        b.addEventListener('mousedown', function(e){ e.preventDefault(); });
        b.addEventListener('click', function(){
          if (replaceFn) replaceFn(s);
          closeSpellMenu();
        });
        menu.appendChild(b);
      });
      menu.appendChild(h('div', 'sp-menu-sep'));
    }
  }

  var addBtn = h('button', 'sp-spell-item' + (inDict ? ' sp-spell-item-done' : ''),
    inDict ? '\u2713 In script dictionary' : 'Add \u201c' + word + '\u201d to script dictionary');
  addBtn.disabled = inDict;
  addBtn.addEventListener('mousedown', function(e){ e.preventDefault(); });
  addBtn.addEventListener('click', function(){
    addToDictionary(word);
    closeSpellMenu();
  });
  menu.appendChild(addBtn);

  if (inDict) {
    var removeBtn = h('button', 'sp-spell-item sp-spell-item-danger', 'Remove from dictionary');
    removeBtn.addEventListener('mousedown', function(e){ e.preventDefault(); });
    removeBtn.addEventListener('click', function(){
      var dict = getDictionary().filter(function(w){ return w !== word.toLowerCase(); });
      st.titlePageMeta['Dictionary'] = dict.join(', ');
      scheduleSave();
      renderBlocks();
      if (st.focusedIdx >= 0) focusTA(st.focusedIdx);
      closeSpellMenu();
    });
    menu.appendChild(removeBtn);
  }

  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
  document.body.appendChild(menu);
  _spellMenuEl = menu;

  /* position: flip left if too close to right edge */
  var mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth - 8) menu.style.left = (x - mr.width) + 'px';
  if (mr.bottom > window.innerHeight - 8) menu.style.top = (y - mr.height) + 'px';
}
/* close on any click outside */
document.addEventListener('click', function(e){
  if (_spellMenuEl && !_spellMenuEl.contains(e.target)) closeSpellMenu();
});
/* right-click on any screenplay textarea → spell/dict menu */
document.addEventListener('contextmenu', function(e) {
  var ta = e.target;
  if (ta && ta.classList && ta.classList.contains('sp-ta')) {
    e.preventDefault();
    var cx = e.clientX, cy = e.clientY;
    ta.focus();
    setTimeout(function() {
      var hit = getWordAtCaret(ta);
      var word = hit.word;

      /* If caret didn't move to the clicked word, use selected text first. */
      if ((!word || word.length < 2) && ta.selectionEnd > ta.selectionStart) {
        var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
        if (/^[A-Za-z']{2,}$/.test(sel)) {
          word = sel;
          hit = { word: sel, start: ta.selectionStart, end: ta.selectionEnd };
        }
      }

      /* Last fallback in edit mode: first unknown word in the current line. */
      if (!word || word.length < 2) {
        var fb = findFirstUnknownWord(ta.value);
        if (fb) { word = fb.word; hit = fb; }
      }

      if (!word || word.length < 2) return;
      showSpellContextMenu({
        word: word,
        x: cx,
        y: cy,
        replaceFn: function(nextWord) {
          var v = ta.value;
          ta.value = v.slice(0, hit.start) + nextWord + v.slice(hit.end);
          ta.selectionStart = hit.start;
          ta.selectionEnd = hit.start + nextWord.length;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }, 0);
    return;
  }

  var pv = e.target && e.target.closest ? e.target.closest('.sp-preview') : null;
  if (!pv) return;
  var pHit = getWordAtPoint(e.clientX, e.clientY);
  var pWord = pHit && pHit.word;
  if (!pWord || pWord.length < 2) return;
  var blockEl = pv.closest('.sp-block');
  if (!blockEl || !blocksEl) return;
  var arr = Array.prototype.slice.call(blocksEl.querySelectorAll('.sp-block'));
  var idx = arr.indexOf(blockEl);
  if (idx < 0 || !st.blocks[idx]) return;
  e.preventDefault();
  showSpellContextMenu({
    word: pWord,
    x: e.clientX,
    y: e.clientY,
    replaceFn: function(nextWord) {
      var cur = st.blocks[idx].text || '';
      var esc = pWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var next = cur.replace(new RegExp('\\b' + esc + '\\b'), nextWord);
      if (next !== cur) {
        st.blocks[idx].text = next;
        renderBlocks();
        scheduleSave();
      }
    }
  });
});

function showSaveStatus(msg) {
  var disp = document.getElementById('sp-last-saved');
  if (!disp) return;
  if (!msg) { updateLastSavedDisplay(); return; }
  disp.textContent = msg;
}

/* The file changed on disk AND we have unsaved local changes → conflict.
   Let the user choose: keep theirs (reload), keep mine (overwrite), or cancel. */
function showConflictDialog(path, diskText, myContent, btn) {
  st.conflictOpen = true;
  var ov = h('div', 'sp-conflict-overlay');
  var box = h('div', 'sp-conflict-box');
  box.appendChild(h('h3', 'sp-conflict-title', '\u26A0\uFE0F This file changed elsewhere'));
  box.appendChild(h('p', 'sp-conflict-msg',
    'Another tab or editor saved this screenplay while you were working. ' +
    'You also have unsaved changes here. Which version should be kept?'));

  var row = h('div', 'sp-conflict-actions');
  var keepMine  = h('button', 'sp-conflict-btn sp-conflict-mine',  'Keep my version (overwrite)');
  var useTheirs = h('button', 'sp-conflict-btn sp-conflict-theirs', 'Use the other version (discard mine)');
  var cancel    = h('button', 'sp-conflict-btn sp-conflict-cancel', 'Cancel');
  row.appendChild(keepMine); row.appendChild(useTheirs); row.appendChild(cancel);
  box.appendChild(row);
  ov.appendChild(box);
  document.body.appendChild(ov);

  function close() { st.conflictOpen = false; if (ov.parentNode) ov.parentNode.removeChild(ov); }

  keepMine.addEventListener('click', function() {
    close();
    writeSave(path, myContent, btn);
  });
  useTheirs.addEventListener('click', function() {
    close();
    st.savedContent = diskText;
    st.blocks = fountainToBlocks(diskText);
    st.history = [JSON.stringify(st.blocks)];
    st.historyIdx = 0;
    st.focusedIdx = Math.min(st.focusedIdx, st.blocks.length - 1);
    st.lastSaved = new Date();
    updateLastSavedDisplay();
    renderBlocks(); renderBar();
    if (st.dockPreview) renderDockPreview();
  });
  cancel.addEventListener('click', close);
}


function updateLastSavedDisplay() {
  var disp = document.getElementById('sp-last-saved');
  if (!disp) return;
  if (!st.lastSaved) { disp.textContent = ''; return; }
  var h = st.lastSaved.getHours(), m = st.lastSaved.getMinutes();
  var hh = (h < 10 ? '0' : '') + h, mm = (m < 10 ? '0' : '') + m;
  disp.textContent = hh + ':' + mm;
}

/* ── blocks ── */
function extractTag(text) {
  if (!text) return '';
  var m = text.match(/\[\[([^\]]+)\]\]/);
  return (m ? m[1] : text).trim().toLowerCase();
}

/* strip any/all brackets and trim → the inner tag name ("door001A-north") */
function extractInner(text) {
  return String(text == null ? '' : text).replace(/[\[\]]/g, '').trim();
}
/* auto-fix an incomplete/none-bracketed tag → always "[[inner]]" (empty stays empty) */
function normalizeTagText(text) {
  var inner = extractInner(text);
  return inner ? '[[' + inner + ']]' : '';
}
/* parse a tag inner into { base, num, digits, letter, suffix }.
   The numeric "slot" is the first run of digits, optionally followed by ONE
   letter, terminated by "-" (tag word spacer) or end of string. */
function parseTagName(inner) {
  if (!inner) return null;
  var re = /(\d+)([A-Za-z])?(?=-|$)/;
  var m = re.exec(inner);
  if (!m) return { base: inner, num: null, digits: 0, letter: '', suffix: '' };
  return {
    base: inner.slice(0, m.index),
    num: parseInt(m[1], 10),
    digits: m[1].length,
    letter: m[2] || '',
    suffix: inner.slice(m.index + m[0].length)
  };
}
/* A, B, … Z, AA, AB … — disambiguation letters */
function tagLetterSeq() {
  var out = [], A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (var i = 0; i < 26; i++) out.push(A[i]);
  for (var j = 0; j < 26; j++) for (var k = 0; k < 26; k++) out.push(A[j] + A[k]);
  return out;
}
/* Infer the next tag name for an insertion at block position `idx`, based on the
   nearest existing tag: bump the number +1; if that number is already taken,
   keep the number and append the next free letter (A,B,…). No-number tags reuse
   the base name (then base+A, base+B …). */
function inferNextTagName(idx) {
  var existing = {};
  st.blocks.forEach(function(b) {
    if (b.type === 'tag-id') { var t = extractInner(b.text); if (t) existing[t.toLowerCase()] = true; }
  });
  var ref = null, i;
  for (i = Math.min(idx, st.blocks.length) - 1; i >= 0 && !ref; i--) {
    if (st.blocks[i].type === 'tag-id') { var inn = extractInner(st.blocks[i].text); if (inn) ref = parseTagName(inn); }
  }
  for (i = idx; i < st.blocks.length && !ref; i++) {
    if (st.blocks[i].type === 'tag-id') { var inn2 = extractInner(st.blocks[i].text); if (inn2) ref = parseTagName(inn2); }
  }
  if (!ref) return '';
  var pad = function(n, w) { var s = '' + n; while (s.length < w) s = '0' + s; return s; };
  var letters = tagLetterSeq(), li;
  if (ref.num != null) {
    var cand = ref.base + pad(ref.num + 1, ref.digits);
    if (!existing[cand.toLowerCase()]) return cand;
    for (li = 0; li < letters.length; li++) {
      var c2 = ref.base + pad(ref.num, ref.digits) + letters[li];
      if (!existing[c2.toLowerCase()]) return c2;
    }
    var n = ref.num + 1;
    while (existing[(ref.base + pad(n, ref.digits)).toLowerCase()]) n++;
    return ref.base + pad(n, ref.digits);
  }
  if (!existing[ref.base.toLowerCase()]) return ref.base;
  for (li = 0; li < letters.length; li++) {
    var cc = ref.base + letters[li];
    if (!existing[cc.toLowerCase()]) return cc;
  }
  return ref.base;
}
/* Insert a new tag-id block at position `idx` with an inferred name. */
function insertTagAt(idx) {
  idx = Math.max(0, Math.min(idx, st.blocks.length));
  pushHistory();
  var name = inferNextTagName(idx);
  st.blocks.splice(idx, 0, { id: st.nextId++, type: 'tag-id', text: name ? '[[' + name + ']]' : '' });
  st.selectedBlocks = [];
  st.focusedIdx = idx;
  renderBlocks();
  focusTA(idx);
  renderBar();
  scheduleSave();
}

function renderBlocks() {
  if (!blocksEl) return;
  /* sync dynamo mode class (in case meta changed since last render) */
  blocksEl.classList.toggle('sp-dynamo-off', !st.dynamoMode);
  /* preserve the scroll position — a full innerHTML rebuild otherwise snaps
     the script area back to the top whenever a block changes type */
  var scroller = blocksEl.closest('.sp-script-area');
  var savedScroll = scroller ? scroller.scrollTop : 0;
  blocksEl.innerHTML = '';
  /* count tag occurrences to flag duplicates */
  var tagCounts = {};
  st.blocks.forEach(function(b) {
    if (b.type === 'tag-id') {
      var key = extractTag(b.text);
      if (key) tagCounts[key] = (tagCounts[key] || 0) + 1;
    }
  });
  /* dialogue-box limit tracking: each [[tag-id]] opens a new box (max 3 lines) */
  var tagLineCount = -1; /* -1 = no active tag, no validation */
  var boxFirstOverLimitShown = false; /* only the FIRST over-limit line in a box gets the label */
  var currentCharacter = '';   /* last CHARACTER cue (drives the gamebox name) */
  var activeGroup = null;      /* the open [[tag]] dialogue group, mutated as we go */
  var activeGroupTagIdx = -1;  /* index of the tag block that opened the group */
  var gameZebra = 0;           /* GLOBAL zebra counter across all game-dialogue lines */
  st.blocks.forEach(function(block, idx) {
    var isSel = st.selectedBlocks.indexOf(idx) >= 0;
    var isFocused = st.selectedBlocks.length === 0 && st.focusedIdx === idx;

    /* track the speaker that feeds the game preview */
    if (block.type === 'character') currentCharacter = extractInner(block.text);
    else if (block.type === 'scene-heading' || block.type === 'transition') currentCharacter = '';

    /* update dialogue box counter */
    if (block.type === 'tag-id') {
      tagLineCount = 0;
      boxFirstOverLimitShown = false;
      activeGroup = { tag: extractInner(block.text), character: currentCharacter, lines: [] };
      activeGroupTagIdx = idx;
    } else if (block.type === 'scene-heading' || block.type === 'action' ||
               block.type === 'transition' || block.type === 'general') {
      tagLineCount = -1; /* reset on new scene/action */
      activeGroup = null;
      activeGroupTagIdx = -1;
    }
    /* only DIALOGUE lines count toward the 3-line box budget;
       character + parenthetical pass through untouched */
    var boxOverLimit = false;
    var boxOverLimitFirst = false;
    var inGameBox = false;
    if (tagLineCount >= 0 && block.type === 'dialogue') {
      boxOverLimit = tagLineCount >= 3;
      inGameBox = !boxOverLimit;
      if (boxOverLimit && !boxFirstOverLimitShown) {
        boxOverLimitFirst = true;
        boxFirstOverLimitShown = true;
      }
      tagLineCount += block.text ? block.text.split('\n').length : 0;
    }
    if (inGameBox && activeGroup) activeGroup.lines.push(block.text);

    /* zebra: alternate blue intensity per game-dialogue line. The counter is
       GLOBAL across the whole script (not reset per box) so consecutive boxes
       differ — line breaks stay easy to tell apart and adjacent boxes never
       read as the identical light/dark/light pattern. */
    var gameLineOdd = false;
    if (inGameBox) {
      gameZebra += 1;
      gameLineOdd = (gameZebra % 2) === 1;
    }

    var wrap = h('div', 'sp-block' + (isSel ? ' sp-block-selected' : '') +
      (boxOverLimit ? ' sp-box-over-limit' : '') +
      (boxOverLimitFirst ? ' sp-box-over-limit-first' : '') +
      (inGameBox ? ' sp-game-dialogue' : '') +
      (inGameBox ? (gameLineOdd ? ' sp-game-line-odd' : ' sp-game-line-even') : '') +
      (block.type === 'tag-id' && isFocused ? ' sp-tag-editing' : ''));
    wrap.dataset.type = block.type;
    /* tag every line of a box (and its tag block) with a shared group id so a
       hover anywhere in the box can light up the WHOLE box at once */
    if (inGameBox || block.type === 'tag-id') {
      if (activeGroupTagIdx >= 0) wrap.dataset.gameGroup = String(activeGroupTagIdx);
    }

    /* hover highlight: light up the WHOLE box (zebra) when the pointer is over
       the tag or any of its dialogue lines. The live preview now lives in the
       docked Preview Panel (View → Preview Panel), so there is no floating popup. */
    if (activeGroup && (block.type === 'tag-id' || inGameBox) && activeGroupTagIdx >= 0) {
      (function(tagIdx, anchor) {
        anchor.addEventListener('mouseenter', function() {
          setGroupZebra(tagIdx, true);
        });
        anchor.addEventListener('mouseleave', function() {
          setGroupZebra(tagIdx, false);
        });
      })(activeGroupTagIdx, wrap);
    }

    /* duplicate tag warning */
    var isDupTag = block.type === 'tag-id' && tagCounts[extractTag(block.text)] > 1;
    if (isDupTag) {
      var warn = h('span', 'sp-tag-warn', '⚠️ Duplicate tag');
      wrap.appendChild(warn);
    }

    var lbl = h('span', 'sp-block-label', tShort(block.type));
    if (!isFocused) lbl.classList.add('sp-block-label-hidden');
    wrap.appendChild(lbl);

    /* drag handle — grab to move this line (or, if it's part of the current
       multi-selection, the whole selection) to reorder scenes. Bind to the
       block's STABLE id and re-resolve the index at click time — capturing the
       render-time index leads to stale-index drags (autosave reload, paste
       reflow, undo) where the user thinks they're dragging the tag they
       clicked but a block from elsewhere in the script gets moved. */
    var grip = h('span', 'sp-drag-handle');
    grip.innerHTML = '\u2237\u2237';
    grip.title = 'Drag to move';
    grip.addEventListener('mousedown', (function(blockId){ return function(ev){
      if (ev.button !== 0) return;
      var curIdx = -1;
      for (var k = 0; k < st.blocks.length; k++) {
        if (st.blocks[k].id === blockId) { curIdx = k; break; }
      }
      if (curIdx < 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      startBlockDrag(curIdx, ev);
    }; })(block.id));
    wrap.appendChild(grip);

    /* textarea — shown when focused */
    var ta = h('textarea', 'sp-ta sp-ta-' + block.type);
    if (!isFocused) ta.classList.add('sp-ta-hidden');
    if (block.type === 'tag-id' && isFocused) ta.classList.add('sp-ta-tag-editing');
    if (isDupTag) ta.classList.add('sp-tag-duplicate');
    ta.rows = 1;
    ta.value = block.text;
    ta.placeholder = tHint(block.type);
    /* enable browser spell-check; set lang so the right dictionary is used.
       Use setAttribute (not .spellcheck=) so we win against any parent
       spellcheck="false" Nextcloud may have set on the app-content element.
       Also force autocorrect/autocomplete off-but-spellcheck-on — some browsers
       tie these together and kill squiggles when autocomplete is on. */
    var docLang = (st.titlePageMeta && st.titlePageMeta['Language']) || '';
    ta.setAttribute('spellcheck', st.spellMode ? 'true' : 'false');
    ta.setAttribute('autocorrect', 'on');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocapitalize', 'off');
    if (docLang) ta.setAttribute('lang', docLang);
    ta.addEventListener('focus', (function(i, lang){ return function(){
      /* Re-assert spellcheck on focus — Nextcloud's JS may reset the attribute
         after render (e.g. when it processes the #app-content subtree). */
      this.setAttribute('spellcheck', st.spellMode ? 'true' : 'false');
      if (lang) this.setAttribute('lang', lang);
      st.focusedIdx = i;
      lastSelectAnchor = i;
      updateFocus();
      renderBar();
    }; })(idx, docLang));
    ta.addEventListener('blur', (function(i){ return function(){
      setTimeout(function() {
        var ae = document.activeElement;
        /* clicking a toolbar dropdown must NOT drop the active line — otherwise
           the blur rebuilds the toolbar and kills the dropdown that just opened */
        if (ae && ae.closest && ae.closest('.sp-chrome')) return;
        /* auto-fix an incomplete / unbracketed tag the moment we leave it */
        var b = st.blocks[i];
        if (b && b.type === 'tag-id') {
          var fixed = normalizeTagText(b.text);
          if (fixed !== b.text) {
            b.text = fixed;
            var node = blocksEl.querySelectorAll('.sp-block')[i];
            if (node) {
              var nta = node.querySelector('textarea'); if (nta) nta.value = fixed;
              var npv = node.querySelector('.sp-preview');
              if (npv) npv.innerHTML = renderInline(fixed, 'tag-id') ||
                '<span class="sp-preview-empty">' + tHint('tag-id') + '</span>';
            }
            scheduleSave();
          }
        }
        if (st.focusedIdx === i && ae && !blocksEl.contains(ae)) {
          st.focusedIdx = -1;
          updateFocus();
          renderBar();
        }
      }, 60);
    }; })(idx));
    ta.addEventListener('input', (function(i, t, bt){ return function(){
      st.blocks[i].text = t.value;
      autoH(t);
      scheduleHistory();
      scheduleSave();
      var pv = wrap.querySelector('.sp-preview');
      if (pv) pv.innerHTML = renderInline(t.value, bt) ||
        '<span class="sp-preview-empty">' + tHint(bt) + '</span>';
      if (st.dockPreview) renderDockPreview();
    }; })(idx, ta, block.type));
    ta.addEventListener('keydown', (function(i){ return function(e){ onKey(e, i); }; })(idx));
    /* multi-line paste: a single textarea is one screenplay element, so dumping
       several lines into it is wrong. Detect multi-line clipboard text, splice it
       in at the caret, run it through the smart-paste classifier (turns raw
       screenplay text into canonical Fountain), then re-parse with the same
       fountainToBlocks used on file load so paste === load behaviour. */
    ta.addEventListener('paste', (function(i){ return function(e){
      var data = e.clipboardData || window.clipboardData;
      if (!data) return;
      var text = data.getData('text/plain');
      if (!text) return;
      text = text.replace(/\r\n?/g, '\n');
      if (text.indexOf('\n') === -1) return; /* single line → native paste is fine */
      e.preventDefault();
      pushHistory();
      var t = e.target;
      var before = t.value.slice(0, t.selectionStart);
      var after = t.value.slice(t.selectionEnd);
      /* classify clipboard text into Fountain, then parse the merged document */
      var fountain = smartParsePaste(before + '\n' + text + '\n' + after);
      var parsed = fountainToBlocks(fountain);
      parsed.forEach(function(b){ b.id = st.nextId++; });
      Array.prototype.splice.apply(st.blocks, [i, 1].concat(parsed));
      st.selectedBlocks = [];
      st.focusedIdx = i + parsed.length - 1;
      renderBlocks();
      focusTA(st.focusedIdx);
      renderBar();
      scheduleSave();
    }; })(idx));
    /* NOTE: no mousedown block-select hijack here — inside the focused line we
       want fully native text selection (drag, double-click word, shift-click,
       Cmd+A, cut/copy/paste). Block (multi-line) selection is initiated from
       the preview elements of the OTHER, non-focused blocks. */
    wrap.appendChild(ta);

     /* preview div — shown when not focused; in spell mode we also keep it
       visible for the focused line as a live typo-overlay beneath the textarea */
    var pv = document.createElement('div');
    pv.className = 'sp-preview sp-ta sp-ta-' + block.type + (isDupTag ? ' sp-tag-duplicate' : '');
     var liveTypoOverlay = isFocused && st.spellMode && block.type !== 'tag-id';
     if (isFocused && !liveTypoOverlay) pv.classList.add('sp-preview-hidden');
     /* same classes updateFocus() sets, else the overlay renders in-flow (doubled line) */
     if (liveTypoOverlay) { wrap.classList.add('sp-live-typo-edit'); ta.classList.add('sp-ta-live-typo'); }
    var rendered = renderInline(block.text, block.type);
    pv.innerHTML = rendered ||
      '<span class="sp-preview-empty">' + tHint(block.type) + '</span>';
    pv.addEventListener('click', (function(i){ return function(e){
      /* a drag-select just finished here — don't turn its mouseup into a focus */
      if (blocksEl && blocksEl._spSuppressClick) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) { applySelectClick(i, e); return; }
      var off = caretFromPoint(pv, e.clientX, e.clientY);
      if (st.selectedBlocks.length) { st.selectedBlocks = []; renderBlocks(); renderBar(); }
      focusTA(i, off);
    }; })(idx));
    /* double-click a word in the preview → enter the line and select that word */
    pv.addEventListener('dblclick', (function(i){ return function(e){
      var off = caretFromPoint(pv, e.clientX, e.clientY);
      focusTA(i, off);
      var ta2 = blocksEl.querySelectorAll('textarea')[i];
      if (ta2 && typeof off === 'number') {
        var t = ta2.value, a = off, b = off;
        while (a > 0 && /\w/.test(t.charAt(a - 1))) a--;
        while (b < t.length && /\w/.test(t.charAt(b))) b++;
        if (b > a) ta2.setSelectionRange(a, b);
      }
    }; })(idx));
    wrap.appendChild(pv);

    blocksEl.appendChild(wrap);
    autoH(ta);
  });
  /* restore the scroll position captured before the rebuild */
  if (scroller) scroller.scrollTop = savedScroll;
}

function updateFocus() {
  if (!blocksEl) return;
  blocksEl.querySelectorAll('.sp-block').forEach(function(wrap, idx) {
    if (idx >= st.blocks.length) return;
    wrap.dataset.type = st.blocks[idx].type;
    var isFocused = st.selectedBlocks.length === 0 && st.focusedIdx === idx;
    var lbl = wrap.querySelector('.sp-block-label');
    var ta  = wrap.querySelector('textarea');
    var pv  = wrap.querySelector('.sp-preview');
    if (lbl) lbl.classList.toggle('sp-block-label-hidden', !isFocused);
    if (ta)  ta.classList.toggle('sp-ta-hidden', !isFocused);
    if (ta)  ta.classList.toggle('sp-ta-tag-editing', isFocused && st.blocks[idx].type === 'tag-id');
    if (ta)  ta.classList.toggle('sp-ta-live-typo', isFocused && st.spellMode && st.blocks[idx].type !== 'tag-id');
    /* mark the WRAP as tag-editing too, so the dynamo tag's drag-box appears */
    wrap.classList.toggle('sp-tag-editing', isFocused && st.blocks[idx].type === 'tag-id');
    wrap.classList.toggle('sp-live-typo-edit', isFocused && st.spellMode && st.blocks[idx].type !== 'tag-id');
    if (pv) {
      var keepPreview = isFocused && st.spellMode && st.blocks[idx].type !== 'tag-id';
      pv.classList.toggle('sp-preview-hidden', isFocused && !keepPreview);
    }
  });
  if (st.dockPreview) renderDockPreview();
}

/* keep old name as alias so any stray calls still work */
function updateLabels() { updateFocus(); }

/* toggle only the selection highlight in-place — never rebuild the DOM,
   so the scroll position is preserved while selecting multiple blocks */
function updateSelection() {
  if (!blocksEl) return;
  blocksEl.querySelectorAll('.sp-block').forEach(function(wrap, idx) {
    wrap.classList.toggle('sp-block-selected', st.selectedBlocks.indexOf(idx) >= 0);
  });
  updateFocus();
}

function autoH(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

function focusTA(idx, caretPos) {
  if (!blocksEl) return;
  // Must unhide the textarea before calling .focus() — display:none blocks focus
  st.focusedIdx = idx;
  updateFocus();
  var tas = blocksEl.querySelectorAll('textarea');
  if (tas[idx]) {
    tas[idx].focus();
    autoH(tas[idx]); /* recompute height now that it's visible (was 0 while hidden) */
    var len = tas[idx].value.length;
    // place caret where the user clicked (natural), else at end
    var pos = (typeof caretPos === 'number' && caretPos >= 0) ? Math.min(caretPos, len) : len;
    tas[idx].setSelectionRange(pos, pos);
  }
}

/* Map a click point inside a rendered preview to a character offset in its text.
   Text is monospace and the preview mirrors the raw line, so for plain lines the
   offset matches the textarea exactly; lines with [[tag]] chips degrade gracefully. */
function textOffsetInEl(el, container, offset) {
  var total = 0, done = false;
  (function walk(node) {
    if (done) return;
    if (node === container) {
      if (node.nodeType === 3) { total += offset; }
      else {
        for (var k = 0; k < offset && k < node.childNodes.length; k++) {
          total += (node.childNodes[k].textContent || '').length;
        }
      }
      done = true; return;
    }
    if (node.nodeType === 3) { total += node.nodeValue.length; return; }
    for (var i = 0; i < node.childNodes.length; i++) { walk(node.childNodes[i]); if (done) return; }
  })(el);
  return total;
}
function caretFromPoint(el, x, y) {
  try {
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r) return textOffsetInEl(el, r.startContainer, r.startOffset);
    } else if (document.caretPositionFromPoint) {
      var cp = document.caretPositionFromPoint(x, y);
      if (cp) return textOffsetInEl(el, cp.offsetNode, cp.offset);
    }
  } catch (e) { /* fall through */ }
  return null;
}

function tShort(id) { var t=TYPES.find(function(t){return t.id===id;}); return t?t.shortLabel:id; }
function tHint(id)  { var t=TYPES.find(function(t){return t.id===id;}); return t?t.hint:''; }

/* ── keyboard ── */
function onKey(e, idx) {
  var b = st.blocks[idx];
  /* Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo */
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoHistory(); else undoHistory();
    return;
  }
  /* Cmd/Ctrl+1..8 set the element type of the current line instantly */
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '8') {
    var ti = parseInt(e.key, 10) - 1;
    if (TYPES[ti]) {
      e.preventDefault();
      pushHistory();
      var caret = e.target.selectionStart;
      b.type = TYPES[ti].id;
      renderBlocks(); focusTA(idx, caret); renderBar();
    }
    return;
  }
  /* Up/Down: move between blocks at the same column when at the edge line.
     Within a multi-line block, let the textarea handle native line movement. */
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    var ta = e.target, pos = ta.selectionStart, val = ta.value;
    if (e.key === 'ArrowUp') {
      var before = val.slice(0, pos);
      if (before.indexOf('\n') === -1 && idx > 0) {
        e.preventDefault();
        var col = pos; /* column on the (only) first line */
        var pt = st.blocks[idx - 1].text;
        var lastNL = pt.lastIndexOf('\n');
        var lineStart = lastNL + 1;
        var lineLen = pt.length - lineStart;
        focusTA(idx - 1, lineStart + Math.min(col, lineLen));
        return;
      }
    } else { /* ArrowDown */
      var after = val.slice(pos);
      if (after.indexOf('\n') === -1 && idx < st.blocks.length - 1) {
        e.preventDefault();
        var bnl = val.lastIndexOf('\n', pos - 1);
        var col2 = pos - (bnl + 1); /* column on the current (last) line */
        var nt = st.blocks[idx + 1].text;
        var firstNL = nt.indexOf('\n');
        var firstLen = firstNL === -1 ? nt.length : firstNL;
        focusTA(idx + 1, Math.min(col2, firstLen));
        return;
      }
    }
    /* otherwise fall through — native caret movement within the block */
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    /* tag-id: Enter just exits the tag — never inserts a new block */
    if (b.type === 'tag-id') {
      st.focusedIdx = -1;
      updateFocus();
      renderBar();
      if (e.target && e.target.blur) e.target.blur();
      return;
    }
    pushHistory();
    /* natural flow: stay in same type where it makes sense */
    var enterMap = {
      'scene-heading': 'action',
      'action':        'action',
      'character':     'dialogue',
      'dialogue':      'dialogue',
      'parenthetical': 'dialogue',
      'transition':    'scene-heading',
      'general':       'general'
    };
    var newType = enterMap[b.type] || 'action';
    /* at absolute start of the line, insert a NEW line ABOVE and keep the
       current line intact (writer-first behavior while drafting):
       CHARACTER -> DIALOGUE above, DIALOGUE -> DIALOGUE above,
       ACTION/SCENE/TRANSITION -> ACTION above. */
    var caretStart = (e.target && typeof e.target.selectionStart === 'number')
      ? e.target.selectionStart : b.text.length;
    var caretEnd = (e.target && typeof e.target.selectionEnd === 'number')
      ? e.target.selectionEnd : caretStart;
    if (caretStart === 0 && caretEnd === 0) {
      var insertAboveMap = {
        'scene-heading': 'action',
        'action':        'action',
        'character':     'dialogue',
        'dialogue':      'dialogue',
        'parenthetical': 'dialogue',
        'transition':    'action',
        'general':       'action'
      };
      var aboveType = insertAboveMap[b.type] || 'action';
      st.blocks.splice(idx, 0, { id: st.nextId++, type: aboveType, text: '' });
      st.focusedIdx = idx;
      renderBlocks();
      focusTA(idx, 0);
      renderBar();
      return;
    }
    /* split at the caret: text before stays here, text after starts the new
       block — so pressing Enter mid-sentence breaks the line in two */
    var caret = caretStart;
    var after = b.text.slice(caret).replace(/^ +/, ''); /* strip leading space on the new line */
    b.text = b.text.slice(0, caret).replace(/ +$/, ''); /* strip trailing space on the old line */
    var nb = { id: st.nextId++, type: newType, text: after };
    st.blocks.splice(idx + 1, 0, nb);
    st.focusedIdx = idx + 1;
    renderBlocks();
    focusTA(idx + 1, 0); /* caret at the very start of the new line */
    renderBar();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    pushHistory();
    var ids = TYPES.map(function(t){return t.id;});
    b.type = ids[(ids.indexOf(b.type)+1) % ids.length];
    renderBlocks(); focusTA(idx); renderBar();
    return;
  }
  if (e.key === 'Backspace') {
    var bp = (e.target && typeof e.target.selectionStart === 'number') ? e.target.selectionStart : -1;
    var bpEnd = (e.target && typeof e.target.selectionEnd === 'number') ? e.target.selectionEnd : -1;
    /* caret collapsed at char 0 → merge this line into the previous block,
       joining the two (e.g. combine two dialogue lines). Caret lands at the
       seam. Never merge text INTO a tag-id (it's a structural marker). */
    if (bp === 0 && bpEnd === 0 && idx > 0) {
      var prev = st.blocks[idx - 1];
      if (prev.type === 'tag-id') {
        /* can't merge into a tag — only collapse an empty line above it */
        if (b.text === '' && st.blocks.length > 1) {
          e.preventDefault();
          pushHistory();
          st.blocks.splice(idx, 1);
          st.focusedIdx = idx - 1;
          renderBlocks(); focusTA(idx - 1);
        }
        return;
      }
      e.preventDefault();
      pushHistory();
      var joinAt = prev.text.length;
      prev.text = prev.text + b.text;
      st.blocks.splice(idx, 1);
      st.focusedIdx = idx - 1;
      renderBlocks();
      focusTA(idx - 1, joinAt); /* caret at the join point */
      return;
    }
  }
}

function insertBlock(after, type) {
  var nb = { id: st.nextId++, type: type, text: '' };
  st.blocks.splice(after+1, 0, nb);
  st.focusedIdx = after+1;
  renderBlocks(); focusTA(after+1);
}

/* ── chrome: menu bar (row 1) + element-type icon toolbar (row 2) ── */
function renderBar() {
  if (!mobileBarEl) return;

  var hasSel = st.selectedBlocks.length > 0;
  var cur = !hasSel && st.focusedIdx >= 0 && st.focusedIdx < st.blocks.length
            ? st.blocks[st.focusedIdx].type : '';
  var curType = cur || (hasSel && st.selectedBlocks.length ? st.blocks[st.selectedBlocks[0]].type : '');
  var typeEnabled = hasSel || !!cur;

  var NAMES = {
    'tag-id': 'Tag', 'scene-heading': 'Scene Heading', 'action': 'Action',
    'character': 'Character', 'parenthetical': 'Parenthetical', 'dialogue': 'Dialogue',
    'transition': 'Transition', 'general': 'General'
  };

  /* apply an element type to the selection or the focused block */
  function setType(tid) {
    pushHistory();
    if (st.selectedBlocks.length) {
      st.selectedBlocks.forEach(function(i){ st.blocks[i].type = tid; });
      renderBlocks(); updateSelection(); renderBar();
    } else if (st.focusedIdx >= 0 && st.focusedIdx < st.blocks.length) {
      st.blocks[st.focusedIdx].type = tid;
      renderBlocks(); focusTA(st.focusedIdx); renderBar();
    }
  }

  /* close any open menu when clicking elsewhere (install once) */
  if (!window._spMenuCloser) {
    window._spMenuCloser = true;
    document.addEventListener('click', function() {
      document.querySelectorAll('.sp-menu-wrap.open').forEach(function(d){ d.classList.remove('open'); });
    });
  }

  /* ════ ROW 1 — classic menu bar: File · Edit · Format · View ════ */
  if (menuBarEl) {
    menuBarEl.innerHTML = '';
    var nativeModel = [], nativeFns = {};

    function addMenu(label, items) {
      if (NATIVE) nativeModel.push({ title: label, items: items.map(function(it) {
        if (it === 'separator') return { sep: true };
        nativeFns[label + '\n' + it.label] = it.fn;
        return { menu: label, label: it.label, accel: it.accel || '',
                 enabled: it.enabled !== false, checked: !!it.checked };
      }) });
      var wrap = h('div', 'sp-menu-wrap');
      var title = h('button', 'sp-menu-title', label);
      var list = h('div', 'sp-menu');
      items.forEach(function(it) {
        if (it === 'separator') { list.appendChild(h('div', 'sp-menu-sep')); return; }
        var enabled = it.enabled !== false;
        var b = h('button', 'sp-menu-row'
          + (it.danger ? ' sp-menu-row-danger' : '')
          + (it.checked ? ' sp-menu-row-checked' : ''));
        b.disabled = !enabled;
        b.innerHTML = '<span class="sp-menu-lbl">' + (it.checked ? '\u2713\u2009' : '') + it.label + '</span>'
                    + '<span class="sp-menu-accel">' + (it.accel || '') + '</span>';
        b.addEventListener('mousedown', function(e){ e.preventDefault(); });
        b.addEventListener('click', function(e){
          e.stopPropagation(); wrap.classList.remove('open');
          if (enabled && it.fn) it.fn();
        });
        list.appendChild(b);
      });
      function openThis() {
        document.querySelectorAll('.sp-menu-wrap.open').forEach(function(d){ if (d !== wrap) d.classList.remove('open'); });
        wrap.classList.add('open');
      }
      title.addEventListener('mousedown', function(e){ e.preventDefault(); });
      title.addEventListener('click', function(e){
        e.stopPropagation();
        if (wrap.classList.contains('open')) wrap.classList.remove('open'); else openThis();
      });
      /* classic menu-follow: once one menu is open, hovering a sibling opens it */
      title.addEventListener('mouseenter', function(){
        if (document.querySelector('.sp-menu-wrap.open')) openThis();
      });
      wrap.appendChild(title); wrap.appendChild(list);
      menuBarEl.appendChild(wrap);
    }

    if (NATIVE) addMenu('File', [
      { label: 'New Screenplay', accel: '\u2318N', fn: function(){ NATIVE.cmd('new'); } },
      { label: 'Open\u2026',        accel: '\u2318O', fn: function(){ NATIVE.cmd('open'); } },
      'separator',
      { label: 'Document Info\u2026', fn: function(){ showDocInfoModal(); } },
      'separator',
      { label: 'Save',       accel: '\u2318S',       fn: function(){ NATIVE.cmd('save'); } },
      { label: 'Save As\u2026', accel: '\u21E7\u2318S', fn: function(){ NATIVE.cmd('saveAs'); } },
      { label: 'Close',      accel: '\u2318W',       fn: function(){ NATIVE.cmd('close'); } }
    ]);
    else addMenu('File', [
      { label: 'New Screenplay\u2026', fn: function(){ promptNewFile(); } },
      { label: 'Open\u2026',           fn: function(){ reloadList(); } },
      'separator',
      { label: 'Document Info\u2026',  fn: function(){ showDocInfoModal(); } },
      'separator',
      { label: 'Save', accel: '\u2318S', fn: function(){ if (window._spDoSave) window._spDoSave(); } },
      { label: 'Download .fountain',    fn: function(){ downloadFountain(); } }
    ]);

    addMenu('Edit', [
      { label: 'Undo', accel: '\u2318Z',      enabled: canUndo(), fn: function(){ undoHistory(); } },
      { label: 'Redo', accel: '\u21E7\u2318Z', enabled: canRedo(), fn: function(){ redoHistory(); } },
      'separator',
      { label: 'Cut',   accel: '\u2318X', enabled: hasSel,               fn: function(){ cutS(); } },
      { label: 'Copy',  accel: '\u2318C', enabled: hasSel,               fn: function(){ copyS(); } },
      { label: 'Paste', accel: '\u2318V', enabled: !!st.clipboard.length, fn: function(){ pasteS(); } },
      'separator',
      { label: 'Delete', accel: '\u2326', enabled: hasSel, danger: true,  fn: function(){ delS(); } }
    ]);

    addMenu('Format', TYPES.map(function(t, ti){
      return { label: NAMES[t.id] || t.id, accel: '\u2318' + (ti + 1),
               enabled: typeEnabled, checked: t.id === curType,
               fn: function(){ setType(t.id); } };
    }));

    addMenu('View', [
      { label: 'Preview Panel', checked: st.dockPreview, fn: function(){
          setDockPreview(!st.dockPreview);
      } },
      { label: 'Spellcheck', checked: st.spellMode, fn: function(){
          st.spellMode = !st.spellMode;
          renderBlocks();
          /* re-focus the active line so the attribute takes effect immediately */
          if (st.focusedIdx >= 0) focusTA(st.focusedIdx);
          renderBar();
      } },
      { label: 'Element Labels', checked: !st.hideLabels, fn: function(){
          st.hideLabels = !st.hideLabels;
          if (blocksEl) blocksEl.classList.toggle('sp-hide-labels', st.hideLabels);
          renderBar();
      } },
      { label: 'Hide Dynamos', checked: st.hideDynamos, fn: function(){
          st.hideDynamos = !st.hideDynamos;
          if (blocksEl) blocksEl.classList.toggle('sp-hide-dynamos', st.hideDynamos);
          renderBar();
      } }
    ]);

    if (NATIVE) {
      window.__dynamoMenuFns = nativeFns;
      var menusJson = JSON.stringify(nativeModel);
      if (menusJson !== window.__dynamoMenusSent) {
        window.__dynamoMenusSent = menusJson;
        NATIVE.cmd('menus', { menus: nativeModel });
      }
    }
  }

  /* ════ ROW 2 — element-type icon toolbar (Word/Final Draft style) ════ */
  mobileBarEl.innerHTML = '';
  TYPES.forEach(function(t, ti) {
    var active = t.id === curType;
    var b = h('button', 'sp-type-btn' + (active ? ' active' : ''));
    b.disabled = !typeEnabled;
    b.title = (NAMES[t.id] || t.id) + '  (\u2318' + (ti + 1) + ')';
    b.innerHTML = '<span class="sp-type-ico">' + t.shortLabel + '</span>'
                + '<span class="sp-type-name">' + (NAMES[t.id] || t.id) + '</span>';
    b.addEventListener('mousedown', function(e){ e.preventDefault(); });
    b.addEventListener('click', function(){ setType(t.id); });
    mobileBarEl.appendChild(b);
  });

  mobileBarEl.appendChild(h('div', 'sp-tb-divider'));

  function hbtn(glyph, title, enabled, fn) {
    var b = h('button', 'sp-type-btn sp-type-btn-ico', glyph);
    b.title = title;
    b.disabled = !enabled;
    b.addEventListener('mousedown', function(e){ e.preventDefault(); });
    b.addEventListener('click', fn);
    mobileBarEl.appendChild(b);
  }
  hbtn('\u21B6', 'Undo (\u2318Z)', canUndo(), function(){ undoHistory(); });
  hbtn('\u21B7', 'Redo (\u21E7\u2318Z)', canRedo(), function(){ redoHistory(); });

  var stats = h('div', 'sp-tb-stats',
    hasSel ? (st.selectedBlocks.length + ' selected')
           : (st.blocks.length + ' blocks'));
  mobileBarEl.appendChild(stats);

  /* mirror count into the bottom status bar (Final-Draft style) */
  var statLeft = document.getElementById('sp-status-left');
  if (statLeft) {
    statLeft.textContent = hasSel
      ? (st.selectedBlocks.length + ' of ' + st.blocks.length + ' elements selected')
      : (st.blocks.length + ' element' + (st.blocks.length === 1 ? '' : 's'));
  }
}

/* ── batch (modeless selection) ── */
var lastSelectAnchor = -1;
var selRangeAnchor = -1; /* fixed end of a shift-extended range (keyboard) */

/* Drag up/down over the page (when NOT editing a line) rubber-bands a multi-block
   selection — like selecting paragraphs in a word processor. A plain click still
   focuses a single line; a drag selects the range it covers. */
function setupDragSelect(container) {
  var startIdx = -1, dragging = false, startX = 0, startY = 0;
  function blockIdxFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    var w = el && el.closest ? el.closest('.sp-block') : null;
    if (!w || !container.contains(w)) return -1;
    return Array.prototype.indexOf.call(container.querySelectorAll('.sp-block'), w);
  }
  container.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    /* never hijack selection while the pointer is inside the focused textarea —
       there we want native text selection */
    if (e.target.closest && e.target.closest('textarea')) return;
    /* the drag handle runs its own reorder drag — don't start a select-drag */
    if (e.target.closest && e.target.closest('.sp-drag-handle')) return;
    startIdx = blockIdxFromPoint(e.clientX, e.clientY);
    dragging = false; startX = e.clientX; startY = e.clientY;
  });
  document.addEventListener('mousemove', function(e) {
    if (startIdx < 0) return;
    if (!dragging) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 5) return;
      dragging = true;
      st.focusedIdx = -1; /* entering select-drag: leave edit mode */
    }
    var curIdx = blockIdxFromPoint(e.clientX, e.clientY);
    if (curIdx < 0) return;
    var lo = Math.min(startIdx, curIdx), hi = Math.max(startIdx, curIdx);
    st.selectedBlocks = [];
    for (var k = lo; k <= hi; k++) st.selectedBlocks.push(k);
    lastSelectAnchor = startIdx; selRangeAnchor = startIdx;
    updateSelection(); renderBar();
    e.preventDefault();
  });
  document.addEventListener('mouseup', function() {
    if (startIdx >= 0 && dragging) {
      /* suppress the click that follows so it doesn't focus a single line */
      container._spSuppressClick = true;
      setTimeout(function(){ container._spSuppressClick = false; }, 0);
    }
    startIdx = -1; dragging = false;
  });
}

/* ── left-gutter "+" affordance: hover the page's left margin to drop a new
   [[tag]] into the GAP between any two lines (auto-named from nearby tags). The
   button snaps to whichever inter-line gap the cursor is closest to. ── */
function setupGutterAdd(area) {
  var btn = h('button', 'sp-gutter-add', '+');
  btn.type = 'button';
  btn.title = 'Insert tag here';
  btn.style.display = 'none';
  area.appendChild(btn);
  /* yellow guide line across the page showing exactly where the tag will land */
  var guide = h('div', 'sp-gutter-guide');
  guide.style.display = 'none';
  area.appendChild(guide);
  var targetIdx = -1;
  function hideAll() { btn.style.display = 'none'; guide.style.display = 'none'; targetIdx = -1; }
  function place(e) {
    var page = area.querySelector('.sp-page');
    if (!page) { hideAll(); return; }
    var pr = page.getBoundingClientRect();
    /* OUTSIDE-the-page band only: a ~70px strip to the LEFT of the page edge.
       Never trigger when the cursor is on the page itself (keeps the writing
       area calm — the + is a gutter affordance, not a content one). */
    if (e.clientX < pr.left - 70 || e.clientX > pr.left - 2) { hideAll(); return; }
    var blocks = Array.prototype.slice.call(page.querySelectorAll('.sp-block'));
    if (!blocks.length) { hideAll(); return; }
    var ar = area.getBoundingClientRect();
    /* only react while the cursor is vertically within the page body */
    if (e.clientY < pr.top - 12 || e.clientY > pr.bottom + 12) { hideAll(); return; }
    /* If the cursor is hovering an EXISTING tag-id row, don't fight its drag
       handle with the "+ new tag" affordance — the user is here to grab, not add. */
    for (var bi = 0; bi < blocks.length; bi++) {
      if (blocks[bi].dataset.type === 'tag-id') {
        var br = blocks[bi].getBoundingClientRect();
        if (e.clientY >= br.top - 10 && e.clientY <= br.bottom + 10) { hideAll(); return; }
      }
    }
    /* find the gap (between any two lines) whose boundary is nearest the cursor.
       gap i sits ABOVE block i; the final gap (== blocks.length) sits after the
       last block. We compare against each block's vertical midpoint. */
    var idx = blocks.length, gapY = blocks[blocks.length - 1].getBoundingClientRect().bottom;
    for (var k = 0; k < blocks.length; k++) {
      var r = blocks[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { idx = k; gapY = r.top; break; }
    }
    targetIdx = idx;
    var topPx = gapY - ar.top + area.scrollTop;
    btn.style.display = 'flex';
    btn.style.top = topPx + 'px';
    btn.style.left = (pr.left - ar.left - 34) + 'px';
    /* guide line: a SHORT marker right next to the button, not a full-page bar
       (the full bar was visually loud and competed with the writing) */
    guide.style.display = 'block';
    guide.style.top = topPx + 'px';
    guide.style.left = (pr.left - ar.left - 20) + 'px';
    guide.style.width = '24px';
  }
  area.addEventListener('mousemove', place);
  area.addEventListener('mouseleave', hideAll);
  /* keep the button visible while the pointer is on it */
  btn.addEventListener('mousemove', function(e) { e.stopPropagation(); });
  btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (targetIdx >= 0) insertTagAt(targetIdx);
  });
}

/* ── game preview (Disgaea-style box + CBS subtitle) shown on hover; this is a
   writer-only visual aid, it never touches the saved Fountain ── */
var _spGamePvEl = null, _spGamePvTimer = null;
/* Recompute a [[tag]] dialogue group LIVE from current st.blocks (so hover always
   reflects the latest edits). Mirrors the render-loop grouping exactly:
   speaker = last CHARACTER cue (reset by scene/transition); lines = up to 3
   dialogue lines after the tag, stopped by the next tag or a scene/action/
   transition/general boundary. */
/* toggle the whole-box zebra highlight for every line that shares a game group,
   so hovering anywhere in the box lights up ALL its lines at once */
function setGroupZebra(tagIdx, on) {
  if (!blocksEl) return;
  var lines = blocksEl.querySelectorAll('[data-game-group="' + tagIdx + '"]');
  for (var i = 0; i < lines.length; i++) {
    lines[i].classList.toggle('sp-zebra-on', !!on);
  }
}
function computeGameGroup(tagIdx) {
  var blocks = st.blocks;
  if (!blocks[tagIdx] || blocks[tagIdx].type !== 'tag-id') return { tag: '', character: '', lines: [] };
  /* find the speaker: walk back to the nearest CHARACTER, stopping at a scene
     heading or transition boundary */
  var character = '';
  for (var b = tagIdx - 1; b >= 0; b--) {
    var t = blocks[b].type;
    if (t === 'scene-heading' || t === 'transition') break;
    if (t === 'character') { character = extractInner(blocks[b].text); break; }
  }
  var lines = [], count = 0;
  for (var f = tagIdx + 1; f < blocks.length; f++) {
    var ft = blocks[f].type;
    if (ft === 'tag-id' || ft === 'scene-heading' || ft === 'action' ||
        ft === 'transition' || ft === 'general') break;
    if (ft === 'dialogue') {
      if (count >= 3) break;
      lines.push(blocks[f].text);
      count += blocks[f].text ? blocks[f].text.split('\n').length : 0;
    }
  }
  return { tag: extractInner(blocks[tagIdx].text), character: character, lines: lines };
}
function ensureGamePreview() {
  if (_spGamePvEl && document.body.contains(_spGamePvEl)) return _spGamePvEl;
  _spGamePvEl = h('div', 'sp-gamepv');
  _spGamePvEl.style.display = 'none';
  _spGamePvEl.addEventListener('mouseenter', function() {
    if (_spGamePvTimer) { clearTimeout(_spGamePvTimer); _spGamePvTimer = null; }
  });
  _spGamePvEl.addEventListener('mouseleave', hideGamePreviewSoon);
  document.body.appendChild(_spGamePvEl);
  return _spGamePvEl;
}
/* Render one preview line: draw inline icons/variables/highlights and report
   the CLEAN length (markup excluded) so the 36-char count matches the editor.
   mode 'game' → Disgaea (yellow bold, circle icons); 'sub' → BBC (just bold). */
function renderPreviewLine(line, mode) {
  var iconCls = mode === 'sub' ? 'sp-pv-icon-sub' : 'sp-pv-icon-game';
  var hlCls   = mode === 'sub' ? 'sp-pv-hl-sub'   : 'sp-pv-hl-game';
  var varCls  = mode === 'sub' ? 'sp-pv-var-sub'  : 'sp-pv-var-game';
  var re = /\[\[h\]\]([\s\S]*?)\[\[\/h\]\]|\[\[(c\d{2})\]\]|\[\[(t\d{2})\]\]|\[\[([^\]]+)\]\]/g;
  var html = '', last = 0, m, len = 0;
  while ((m = re.exec(line))) {
    var plain = line.slice(last, m.index);
    html += escapeHtml(plain);
    len += plain.length;
    if (m[1] != null) {                          /* [[h]]…[[/h]] highlight */
      html += '<b class="' + hlCls + '">' + escapeHtml(m[1]) + '</b>';
      len += m[1].length;
    } else if (m[2] != null) {                   /* [[cNN]] icon */
      html += '<span class="' + iconCls + '">' + escapeHtml(m[2]) + '</span>';
    } else if (m[3] != null) {                   /* [[tNN]] variable */
      /* a variable is replaced in-game by a real value, so it must be shown at
         its MAX width — a fixed 12-char placeholder "[NNVariable]" — and it
         counts as 12 chars toward the 36-char line budget (worst-case spacing) */
      var num = m[3].slice(1);                   /* "NN" from tNN */
      var label = '[' + num + 'Variable]';       /* 12 chars: [ + NN + Variable + ] */
      html += '<span class="' + varCls + '">' + escapeHtml(label) + '</span>';
      len += label.length;
    } else if (m[4] != null) {                   /* [[anything]] generic tag */
      html += '<b class="' + hlCls + '">' + escapeHtml(m[4]) + '</b>';
      len += m[4].length;
    }
    last = re.lastIndex;
  }
  var tail = line.slice(last);
  html += escapeHtml(tail);
  len += tail.length;
  return { html: html, len: len };
}
function showGamePreview(group, anchor) {
  if (_spGamePvTimer) { clearTimeout(_spGamePvTimer); _spGamePvTimer = null; }
  /* when dynamos are hidden (View → Hide Dynamos), suppress the hover preview
     entirely — no subtitle/bubble cards while the tags are out of view */
  if (st.hideDynamos) { hideGamePreview(); return; }
  /* when the docked preview panel is open, the floating hover popup is redundant
     and cumbersome — the dock already shows everything, live */
  if (st.dockPreview) { hideGamePreview(); return; }
  var html = buildGamePreviewHtml(group);
  if (!html) { hideGamePreview(); return; }
  var el = ensureGamePreview();
  el.innerHTML = html;
  el.style.display = 'block';
  /* position to the right of the page, vertically aligned to the hovered line */
  var ar = anchor.getBoundingClientRect();
  var pageEl = blocksEl ? blocksEl.getBoundingClientRect() : ar;
  var w = el.offsetWidth || 360;
  var left = pageEl.right + 16;
  if (left + w > window.innerWidth - 8) left = Math.max(8, pageEl.left - w - 16);
  var top = Math.min(Math.max(8, ar.top), window.innerHeight - el.offsetHeight - 8);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
/* Build the inner HTML for a game preview from a group {character, lines}.
   Returns '' when there's nothing to show. Shared by the floating hover popup
   and the docked preview panel. */
function buildGamePreviewHtml(group) {
  /* every dialogue LINE is its own subtitle/game line — the line-length matters,
     so we keep each line separate (line / line / line) and never reflow them. */
  var lines = [];
  (group.lines || []).forEach(function(s){
    String(s == null ? '' : s).split('\n').forEach(function(ln){
      var t = ln.replace(/\s+$/, '');
      if (t.trim()) lines.push(t);
    });
  });
  if (!lines.length) return '';
  var name = (group.character || '').trim();
  /* Disgaea boxes hold ~36 characters per line — flag any line that runs over. */
  var rows = lines.map(function(ln){
    var r = renderPreviewLine(ln, 'game');
    var over = r.len > 36;
    return '<div class="sp-gl' + (over ? ' sp-gl-over' : '') + '">' +
           '<span class="sp-gl-text">' + r.html + '</span>' +
           '<span class="sp-gl-count">' + r.len + '</span></div>';
  }).join('');
  /* TALK SCENE / CUTSCENE subtitles: show every dialogue line stacked together
     as ONE continuous subtitle block (no 2-line chunking — that orphaned the
     third line). Each line keeps its own black box + over-36 flag. */
  var subCards = lines.map(function(ln){
    var r = renderPreviewLine(ln, 'sub');
    var over = r.len > 36;
    return '<div class="sp-sub-line' + (over ? ' sp-sub-over' : '') + '">' +
           '<span>' + r.html + '</span></div>';
  }).join('');
  /* BUBBLE (items, pickups): a small circle with the text centred inside. */
  var bubbleText = lines.map(function(ln){
    return renderPreviewLine(ln, 'game').html;
  }).join('<br>');
  /* timing/analytics — game writers care about delivery, not page count.
     Spoken delivery ≈ 14 chars/sec; auto-advance when ≤ box capacity. Line
     length comes from renderPreviewLine().len so variables count at max width. */
  var lens = lines.map(function(ln){ return renderPreviewLine(ln, 'game').len; });
  var totalChars = lens.reduce(function(n, l){ return n + l; }, 0);
  var maxLen = lens.reduce(function(mx, l){ return Math.max(mx, l); }, 0);
  var secs = Math.max(0.4, totalChars / 14);
  var secsTxt = secs.toFixed(1) + 's';
  var barPct = Math.min(100, Math.round((secs / 6) * 100)); /* 6s = full bar */
  var autoAdv = (lines.length <= 3 && maxLen <= 36) ? 'Yes' : 'No';
  var overCount = lens.filter(function(l){ return l > 36; }).length;
  var initial = name ? escapeHtml(name.charAt(0).toUpperCase()) : '·';
  return (
    '<div class="sp-gpv-viewport">' +
      '<div class="sp-gpv-portrait" aria-hidden="true">' +
        '<div class="sp-gpv-portrait-glow"></div>' +
        '<div class="sp-gpv-portrait-mono">' + initial + '</div>' +
      '</div>' +
      '<div class="sp-gpv-box">' +
        (name ? '<div class="sp-gpv-name">' + escapeHtml(name) + '</div>' : '') +
        '<div class="sp-gpv-text">' + rows + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="sp-gpv-meta">' +
      '<div class="sp-gpv-timing">' +
        '<span class="sp-gpv-timing-bar"><i style="width:' + barPct + '%"></i></span>' +
        '<span class="sp-gpv-timing-val">' + secsTxt + '</span>' +
      '</div>' +
      '<div class="sp-gpv-stats">' +
        '<span>' + totalChars + ' chars</span>' +
        '<span>' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + '</span>' +
        '<span class="sp-gpv-auto' + (autoAdv === 'Yes' ? ' on' : '') + '">auto-advance ' + autoAdv + '</span>' +
        (overCount ? '<span class="sp-gpv-warn">' + overCount + ' over 36</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="sp-gpv-modes">' +
      '<div class="sp-gpv-mode">' +
        '<div class="sp-gpv-mode-label">TALK SCENE / CUTSCENE</div>' +
        '<div class="sp-subtitle">' + subCards + '</div>' +
      '</div>' +
      '<div class="sp-gpv-mode">' +
        '<div class="sp-gpv-mode-label">BUBBLE</div>' +
        '<div class="sp-gpv-bubble"><span class="sp-gpv-bubble-text">' + bubbleText + '</span></div>' +
      '</div>' +
    '</div>'
  );
}
function hideGamePreview() {
  if (_spGamePvEl) _spGamePvEl.style.display = 'none';
}
function hideGamePreviewSoon() {
  if (_spGamePvTimer) clearTimeout(_spGamePvTimer);
  _spGamePvTimer = setTimeout(hideGamePreview, 180);
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── drag-to-reorder: grab a block's grip handle to pick up that line — or the
   whole current selection if the grabbed line is part of it — and drop it
   elsewhere. A gold indicator shows the drop point; near the edges the script
   auto-scrolls so long scenes can be moved across the whole document. ── */
function startBlockDrag(originIdx, e) {
  if (!blocksEl) return;
  var moving;
  var origin = st.blocks[originIdx];
  /* Tags are atomic — dragging a tag's grip ALWAYS moves just that tag, even
     if it happens to be part of a wider multi-selection (Cmd+A, range-select).
     Otherwise the user thinks they're moving the tag but unrelated character
     names from elsewhere in the script come along. */
  if (origin && origin.type === 'tag-id') {
    moving = [originIdx];
  } else if (st.selectedBlocks.length && st.selectedBlocks.indexOf(originIdx) >= 0) {
    moving = st.selectedBlocks.slice().sort(function(a, b){ return a - b; });
  } else {
    moving = [originIdx];
  }
  var movingIds = moving.map(function(i){ return st.blocks[i].id; });

  document.body.classList.add('sp-dragging-blocks');
  var ind = h('div', 'sp-drop-indicator');
  document.body.appendChild(ind);
  var ghost = h('div', 'sp-drag-ghost',
    moving.length > 1 ? (moving.length + ' lines') : (tShort(st.blocks[originIdx].type) + ' moving'));
  document.body.appendChild(ghost);

  var dropAt = originIdx, lastY = e.clientY;

  function position(ev) {
    lastY = ev.clientY;
    ghost.style.left = (ev.clientX + 14) + 'px';
    ghost.style.top = (ev.clientY + 10) + 'px';
    var blocks = blocksEl.querySelectorAll('.sp-block');
    var target = blocks.length;
    for (var k = 0; k < blocks.length; k++) {
      var r = blocks[k].getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) { target = k; break; }
    }
    dropAt = target;
    var pr = blocksEl.getBoundingClientRect();
    var y;
    if (target >= blocks.length) {
      y = blocks.length ? blocks[blocks.length - 1].getBoundingClientRect().bottom : pr.top;
    } else {
      y = blocks[target].getBoundingClientRect().top;
    }
    ind.style.left = pr.left + 'px';
    ind.style.width = pr.width + 'px';
    ind.style.top = y + 'px';
    ind.style.display = 'block';
  }
  /* continuous edge auto-scroll while a drag is held near the top/bottom */
  var scrollTimer = setInterval(function() {
    var area = blocksEl.closest('.sp-script-area');
    if (!area) return;
    var ar = area.getBoundingClientRect();
    if (lastY < ar.top + 48) area.scrollTop -= 16;
    else if (lastY > ar.bottom - 48) area.scrollTop += 16;
  }, 16);

  function onUp() {
    document.removeEventListener('mousemove', position);
    document.removeEventListener('mouseup', onUp);
    clearInterval(scrollTimer);
    document.body.classList.remove('sp-dragging-blocks');
    if (ind.parentNode) ind.parentNode.removeChild(ind);
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    moveBlocksTo(movingIds, dropAt);
  }
  document.addEventListener('mousemove', position);
  document.addEventListener('mouseup', onUp);
  position(e);
}

/* Move the blocks identified by `movingIds` so they land at the original-list
   position `dropIdx`, preserving their relative order, and keep them selected. */
function moveBlocksTo(movingIds, dropIdx) {
  var idSet = {};
  movingIds.forEach(function(id){ idSet[id] = true; });
  var moving = [], remaining = [];
  st.blocks.forEach(function(b){ (idSet[b.id] ? moving : remaining).push(b); });
  if (!moving.length) return;
  var insertAt = 0;
  for (var i = 0; i < dropIdx && i < st.blocks.length; i++) {
    if (!idSet[st.blocks[i].id]) insertAt++;
  }
  var next = remaining.slice();
  Array.prototype.splice.apply(next, [insertAt, 0].concat(moving));
  var changed = next.length !== st.blocks.length ||
    next.some(function(b, idx){ return !st.blocks[idx] || st.blocks[idx].id !== b.id; });
  if (!changed) return;
  pushHistory();
  st.blocks = next;
  st.focusedIdx = -1;
  st.selectedBlocks = [];
  for (var j = 0; j < moving.length; j++) st.selectedBlocks.push(insertAt + j);
  renderBlocks();
  updateSelection();
  renderBar();
  scrollBlockIntoView(insertAt);
  scheduleSave();
}

/* scroll a block into view without jumping the whole page to the top */
function scrollBlockIntoView(idx) {
  if (!blocksEl) return;
  var w = blocksEl.querySelectorAll('.sp-block')[idx];
  if (w && w.scrollIntoView) w.scrollIntoView({ block: 'nearest' });
}
/* Shift+click = range-select from anchor; Cmd/Ctrl+click = toggle one block */
function applySelectClick(idx, e) {
  var anchor = lastSelectAnchor >= 0 ? lastSelectAnchor
             : (st.focusedIdx >= 0 ? st.focusedIdx : idx);
  st.focusedIdx = -1;
  if (e && e.shiftKey) {
    var lo = Math.min(anchor, idx), hi = Math.max(anchor, idx);
    st.selectedBlocks = [];
    for (var k = lo; k <= hi; k++) st.selectedBlocks.push(k);
    selRangeAnchor = anchor;
  } else {
    var p = st.selectedBlocks.indexOf(idx);
    if (p >= 0) st.selectedBlocks.splice(p, 1); else st.selectedBlocks.push(idx);
    lastSelectAnchor = idx;
    selRangeAnchor = idx;
  }
  updateSelection(); renderBar();
}
function toggleSel(idx) {
  var p = st.selectedBlocks.indexOf(idx);
  if (p >= 0) st.selectedBlocks.splice(p, 1); else st.selectedBlocks.push(idx);
  lastSelectAnchor = idx;
  updateSelection(); renderBar();
}
function copyS() {
  if (!st.selectedBlocks.length) return;
  st.clipboard = st.selectedBlocks.slice().sort(function(a,b){return a-b;})
    .map(function(i){ return JSON.parse(JSON.stringify(st.blocks[i])); });
  renderBar();
}
function cutS() { copyS(); delS(); }
function pasteS() {
  if (!st.clipboard.length) return;
  var idx = st.focusedIdx >= 0 ? st.focusedIdx : st.blocks.length-1;
  var copies = st.clipboard.map(function(b){ return Object.assign({}, b, {id: st.nextId++}); });
  Array.prototype.splice.apply(st.blocks, [idx+1, 0].concat(copies));
  st.selectedBlocks = []; st.focusedIdx = idx + copies.length;
  renderBlocks(); focusTA(st.focusedIdx); renderBar();
}
function delS() {
  if (!st.selectedBlocks.length) return;
  pushHistory(); /* make the multi-delete undoable (and persisted) */
  st.selectedBlocks.slice().sort(function(a,b){return b-a;})
    .forEach(function(i){ st.blocks.splice(i, 1); });
  if (!st.blocks.length) st.blocks.push({id: st.nextId++, type:'action', text:''});
  st.selectedBlocks = []; st.focusedIdx = Math.min(st.focusedIdx, st.blocks.length-1);
  renderBlocks(); renderBar();
}

/* ════ boot ════ */
function boot() {
  var root = document.getElementById('app-content-vue');
  if (!root) { setTimeout(boot, 50); return; }

  /* desktop: the shell owns files; it pushes text in and pulls it out */
  if (NATIVE) {
    window.__dynamo = {
      open: function(text, title) {
        var blocks = fountainToBlocks(text || '');
        if (!blocks.length) blocks = [{ id: st.nextId++, type: 'scene-heading', text: '' }];
        openEditor('dynamo://doc', title || 'Untitled', blocks, text || '');
      },
      /* serialize + adopt as baseline so the next autosave doesn't flag a conflict */
      flush: function() {
        if (!st.blocks) return null;
        st.savedContent = blocksToFountain(st.blocks);
        st.lastSaved = new Date();
        updateLastSavedDisplay();
        return st.savedContent;
      },
      menu: function(title, label) {
        var fn = (window.__dynamoMenuFns || {})[title + '\n' + label];
        if (fn) fn();
      }
    };
    NATIVE.cmd('ready');
    return;
  }

  // If launched from the Files "Open in Screenplay" action, open that file
  // directly instead of showing the Screenplays folder list.
  var params = new URLSearchParams(window.location.search);
  var openPath = params.get('path');
  if (openPath) {
    loadFile(openPath).then(function(text) {
      var filename = openPath.split('/').pop().replace(/\.fountain$/, '');
      openEditor(openPath, filename, fountainToBlocks(text), text);
    }).catch(function(e) {
      st.error = 'Cannot open file: ' + e.message;
      reloadList();
    });
  } else {
    reloadList();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
