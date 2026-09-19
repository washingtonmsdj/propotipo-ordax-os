import {
  MAX_NOTE_RICH_BLOCKS,
  MAX_NOTE_TEXT_CHARS,
  validateNotesRichBody,
} from "../../../contracts/notes-store.mjs";

const BLOCK_TYPES = new Set(["paragraph", "heading", "quote", "bullet"]);
const INLINE_MARK_COMMANDS = Object.freeze({
  bold: "bold",
  italic: "italic",
});

function directEditorChild(editor, node) {
  let current = node?.nodeType === 3 ? node.parentElement : node;
  while (current && current !== editor && current.parentElement !== editor) {
    current = current.parentElement;
  }
  return current?.parentElement === editor ? current : null;
}

function selectionInside(editor) {
  const selection = editor.ownerDocument.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }
  return { selection, range };
}

function markDescriptor(element) {
  const tag = element.tagName;
  if (tag === "STRONG" || tag === "B") return { type: "bold", href: "" };
  if (tag === "EM" || tag === "I") return { type: "italic", href: "" };
  if (tag === "A") {
    const href = element.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) return { type: "link", href };
    return null;
  }

  const weight = element.style?.fontWeight ?? "";
  if (weight === "bold" || Number.parseInt(weight, 10) >= 600) {
    return { type: "bold", href: "" };
  }
  if (element.style?.fontStyle === "italic") {
    return { type: "italic", href: "" };
  }
  return null;
}

function readInlineContent(root) {
  const chunks = [];
  const marks = [];
  let length = 0;

  const append = (value) => {
    if (!value) return;
    chunks.push(value);
    length += value.length;
  };

  const visit = (node) => {
    if (node.nodeType === 3) {
      append(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== 1) return;

    const element = node;
    if (element.tagName === "BR") {
      if (element.dataset.notesPlaceholder === undefined) append("\n");
      return;
    }

    const descriptor = markDescriptor(element);
    const start = length;
    for (const child of element.childNodes) visit(child);
    const end = length;
    if (descriptor && end > start) {
      marks.push({
        type: descriptor.type,
        start,
        end,
        href: descriptor.href,
      });
    }
  };

  for (const child of root.childNodes) visit(child);
  marks.sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || left.type.localeCompare(right.type)
  ));
  return { text: chunks.join(""), marks };
}

function blockTypeFor(element) {
  const explicit = element?.dataset?.notesBlockType;
  if (BLOCK_TYPES.has(explicit)) return explicit;
  if (/^H[1-6]$/.test(element?.tagName ?? "")) return "heading";
  if (element?.tagName === "BLOCKQUOTE") return "quote";
  if (element?.tagName === "LI") return "bullet";
  return "paragraph";
}

function coalesceMarks(marks) {
  const merged = [];
  for (const mark of marks) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && previous.type === mark.type
      && previous.href === mark.href
      && mark.start <= previous.end
    ) {
      previous.end = Math.max(previous.end, mark.end);
    } else if (
      previous
      && previous.type === mark.type
      && previous.href === mark.href
      && mark.start === previous.end
    ) {
      previous.end = mark.end;
    } else {
      merged.push({ ...mark });
    }
  }
  return merged;
}

function serializeBlock(element, type = blockTypeFor(element)) {
  const inline = readInlineContent(element);
  const rootMark = markDescriptor(element);
  if (rootMark && inline.text.length > 0) {
    inline.marks.push({
      type: rootMark.type,
      start: 0,
      end: inline.text.length,
      href: rootMark.href,
    });
  }
  inline.marks.sort((left, right) => (
    left.type.localeCompare(right.type)
    || left.href.localeCompare(right.href)
    || left.start - right.start
    || left.end - right.end
  ));
  return {
    type: BLOCK_TYPES.has(type) ? type : "paragraph",
    text: inline.text,
    marks: coalesceMarks(inline.marks),
  };
}

function editorBlocks(editor) {
  const blocks = [];
  for (const child of editor.childNodes) {
    if (child.nodeType === 3) {
      const text = child.nodeValue ?? "";
      if (text || blocks.length === 0) {
        blocks.push({ type: "paragraph", text, marks: [] });
      }
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.tagName === "UL" || child.tagName === "OL") {
      for (const item of child.children) {
        if (item.tagName === "LI") blocks.push(serializeBlock(item, "bullet"));
      }
      continue;
    }
    if (child.tagName === "BR" && child.dataset.notesPlaceholder !== undefined) {
      if (blocks.length === 0) blocks.push({ type: "paragraph", text: "", marks: [] });
      continue;
    }
    blocks.push(serializeBlock(child));
  }
  if (blocks.length === 0) blocks.push({ type: "paragraph", text: "", marks: [] });
  return blocks;
}

function markWrapper(documentObject, mark) {
  if (mark.type === "bold") {
    const element = documentObject.createElement("strong");
    element.dataset.notesRichMark = "bold";
    return element;
  }
  if (mark.type === "italic") {
    const element = documentObject.createElement("em");
    element.dataset.notesRichMark = "italic";
    return element;
  }
  const element = documentObject.createElement("a");
  element.dataset.notesRichMark = "link";
  element.href = mark.href;
  element.rel = "noopener noreferrer";
  element.tabIndex = -1;
  return element;
}

function appendMarkedText(documentObject, container, block) {
  if (!block.text) {
    const placeholder = documentObject.createElement("br");
    placeholder.dataset.notesPlaceholder = "";
    container.append(placeholder);
    return;
  }

  const boundaries = new Set([0, block.text.length]);
  for (const mark of block.marks) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }
  const positions = [...boundaries].sort((left, right) => left - right);
  const order = Object.freeze({ bold: 1, italic: 2, link: 3 });

  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index];
    const end = positions[index + 1];
    if (end <= start) continue;
    let current = documentObject.createTextNode(block.text.slice(start, end));
    const active = block.marks
      .filter((mark) => mark.start <= start && mark.end >= end)
      .sort((left, right) => order[left.type] - order[right.type]);

    for (const mark of active) {
      const wrapper = markWrapper(documentObject, mark);
      wrapper.append(current);
      current = wrapper;
    }
    container.append(current);
  }
}

function selectionBlocks(editor, range) {
  if (range.collapsed) {
    const block = directEditorChild(editor, range.startContainer);
    return block ? [block] : [];
  }
  return [...editor.children].filter((child) => {
    try {
      return range.intersectsNode(child);
    } catch {
      return false;
    }
  });
}

function fallbackWrapSelection(editor, tagName, attributes = {}) {
  const selected = selectionInside(editor);
  if (!selected || selected.range.collapsed) return false;
  const startBlock = directEditorChild(editor, selected.range.startContainer);
  const endBlock = directEditorChild(editor, selected.range.endContainer);
  if (!startBlock || startBlock !== endBlock) return false;

  const wrapper = editor.ownerDocument.createElement(tagName);
  for (const [key, value] of Object.entries(attributes)) {
    wrapper.setAttribute(key, value);
  }
  const fragment = selected.range.extractContents();
  wrapper.append(fragment);
  selected.range.insertNode(wrapper);
  selected.selection.removeAllRanges();
  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(wrapper);
  selected.selection.addRange(range);
  return true;
}

function isEditorEmpty(editor) {
  return editorBlocks(editor).every((block) => block.text.length === 0);
}

function syncNotesRichEmptyState(editor) {
  editor.dataset.notesEmptyState = String(isEditorEmpty(editor));
}

function placeholderBreak(documentObject) {
  const placeholder = documentObject.createElement("br");
  placeholder.dataset.notesPlaceholder = "";
  return placeholder;
}

function ensureEditableBlock(block) {
  if (readInlineContent(block).text.length === 0) {
    block.replaceChildren(placeholderBreak(block.ownerDocument));
  }
}

function placeCaretAtStart(element) {
  const documentObject = element.ownerDocument;
  const selection = documentObject.getSelection?.();
  if (!selection) return false;
  const range = documentObject.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function placeCaretAtEnd(element) {
  const documentObject = element.ownerDocument;
  const selection = documentObject.getSelection?.();
  if (!selection) return false;
  const range = documentObject.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function rangeStartsBlock(block, range) {
  try {
    const before = block.ownerDocument.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length === 0;
  } catch {
    return false;
  }
}

function currentPlainLength(editor) {
  return editorBlocks(editor).map((block) => block.text).join("\n").length;
}

function convertBlockToParagraph(editor, block) {
  block.dataset.notesBlockType = "paragraph";
  block.classList.add("ordax-notes-rich-block");
  block.dataset.notesRichBlock = "";
  ensureEditableBlock(block);
  placeCaretAtStart(block);
  dispatchEditorInput(editor);
  return true;
}

function insertNotesSoftBreak(editor, event) {
  const selected = selectionInside(editor);
  if (!selected) return false;
  const startBlock = directEditorChild(editor, selected.range.startContainer);
  const endBlock = directEditorChild(editor, selected.range.endContainer);
  if (!startBlock || startBlock !== endBlock) return false;

  const selectedLength = selected.range.toString().length;
  if (currentPlainLength(editor) - selectedLength + 1 > MAX_NOTE_TEXT_CHARS) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();
  selected.range.deleteContents();
  const textNode = editor.ownerDocument.createTextNode("\n");
  selected.range.insertNode(textNode);
  selected.range.setStartAfter(textNode);
  selected.range.collapse(true);
  selected.selection.removeAllRanges();
  selected.selection.addRange(selected.range);
  dispatchEditorInput(editor);
  return true;
}

function splitNotesBlock(editor, event) {
  const selected = selectionInside(editor);
  if (!selected) return false;
  const startBlock = directEditorChild(editor, selected.range.startContainer);
  const endBlock = directEditorChild(editor, selected.range.endContainer);
  if (!startBlock || startBlock !== endBlock) return false;

  const currentType = blockTypeFor(startBlock);
  const currentText = readInlineContent(startBlock).text;
  if (selected.range.collapsed && currentText.length === 0 && currentType !== "paragraph") {
    event.preventDefault();
    return convertBlockToParagraph(editor, startBlock);
  }

  if (editor.children.length >= MAX_NOTE_RICH_BLOCKS) {
    event.preventDefault();
    return true;
  }
  const selectedLength = selected.range.toString().length;
  if (currentPlainLength(editor) - selectedLength + 1 > MAX_NOTE_TEXT_CHARS) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();
  if (!selected.range.collapsed) {
    selected.range.deleteContents();
    selected.range.collapse(true);
  }

  const trailing = editor.ownerDocument.createRange();
  trailing.setStart(selected.range.startContainer, selected.range.startOffset);
  trailing.setEnd(startBlock, startBlock.childNodes.length);
  const fragment = trailing.extractContents();

  ensureEditableBlock(startBlock);
  const nextBlock = editor.ownerDocument.createElement("div");
  nextBlock.className = "ordax-notes-rich-block";
  nextBlock.dataset.notesRichBlock = "";
  nextBlock.dataset.notesBlockType = currentType === "bullet" ? "bullet" : "paragraph";
  nextBlock.append(fragment);
  ensureEditableBlock(nextBlock);
  startBlock.after(nextBlock);
  placeCaretAtStart(nextBlock);
  dispatchEditorInput(editor);
  return true;
}

function handleNotesBackspace(editor, event) {
  const selected = selectionInside(editor);
  if (!selected || !selected.range.collapsed) return false;
  const block = directEditorChild(editor, selected.range.startContainer);
  if (!block || !rangeStartsBlock(block, selected.range)) return false;

  const type = blockTypeFor(block);
  if (type !== "paragraph") {
    event.preventDefault();
    return convertBlockToParagraph(editor, block);
  }

  const previous = block.previousElementSibling;
  if (!previous || previous.parentElement !== editor) return false;

  event.preventDefault();
  const blockText = readInlineContent(block).text;
  if (blockText.length === 0) {
    block.remove();
    placeCaretAtEnd(previous);
    dispatchEditorInput(editor);
    return true;
  }

  if (readInlineContent(previous).text.length === 0) previous.replaceChildren();
  const boundary = previous.childNodes.length;
  while (block.firstChild) previous.append(block.firstChild);
  block.remove();

  const selection = editor.ownerDocument.getSelection?.();
  if (selection) {
    const range = editor.ownerDocument.createRange();
    range.setStart(previous, Math.min(boundary, previous.childNodes.length));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  dispatchEditorInput(editor);
  return true;
}

function dispatchEditorInput(editor) {
  syncNotesRichEmptyState(editor);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

export function createNotesRichEditor(documentObject) {
  const editor = documentObject.createElement("div");
  editor.className = "ordax-notes-body ordax-notes-rich-editor";
  editor.contentEditable = "true";
  editor.spellcheck = true;
  editor.dataset.notesBody = "";
  editor.dataset.notesEmptyState = "true";
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("aria-label", "Conteúdo da nota");
  return editor;
}

export function renderNotesRichBody(editor, value) {
  const richBody = validateNotesRichBody(value);
  const documentObject = editor.ownerDocument;
  const fragment = documentObject.createDocumentFragment();

  for (const block of richBody.blocks) {
    const element = documentObject.createElement("div");
    element.className = "ordax-notes-rich-block";
    element.dataset.notesRichBlock = "";
    element.dataset.notesBlockType = block.type;
    appendMarkedText(documentObject, element, block);
    fragment.append(element);
  }

  editor.replaceChildren(fragment);
  syncNotesRichEmptyState(editor);
  return richBody;
}

export function readNotesRichBody(editor) {
  return validateNotesRichBody({ blocks: editorBlocks(editor) });
}

export function normalizeNotesRichEditor(editor) {
  for (const child of editor.children) {
    if (child.tagName === "UL" || child.tagName === "OL") continue;
    if (!BLOCK_TYPES.has(child.dataset.notesBlockType)) {
      child.dataset.notesBlockType = blockTypeFor(child);
    }
    child.classList.add("ordax-notes-rich-block");
    child.dataset.notesRichBlock = "";
  }
  syncNotesRichEmptyState(editor);
}

export function handleNotesRichBlockKeyDown(editor, event) {
  if (!editor || !event || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  if (event.key === "Enter") {
    return event.shiftKey
      ? insertNotesSoftBreak(editor, event)
      : splitNotesBlock(editor, event);
  }
  if (event.key === "Backspace" && !event.shiftKey) {
    return handleNotesBackspace(editor, event);
  }
  return false;
}

export function setNotesRichBlockType(editor, type) {
  if (!BLOCK_TYPES.has(type)) throw new TypeError("Unsupported Notes block type");
  const selected = selectionInside(editor);
  if (!selected) return false;
  const blocks = selectionBlocks(editor, selected.range);
  if (blocks.length === 0) return false;
  for (const block of blocks) {
    block.dataset.notesBlockType = type;
    block.classList.add("ordax-notes-rich-block");
    block.dataset.notesRichBlock = "";
  }
  dispatchEditorInput(editor);
  editor.focus();
  return true;
}

export function toggleNotesRichInlineMark(editor, type) {
  const command = INLINE_MARK_COMMANDS[type];
  if (!command) throw new TypeError("Unsupported Notes inline mark");
  const selected = selectionInside(editor);
  if (!selected) return false;

  const documentObject = editor.ownerDocument;
  let changed = false;
  if (typeof documentObject.execCommand === "function") {
    documentObject.execCommand("styleWithCSS", false, false);
    changed = documentObject.execCommand(command, false, null);
  }
  if (!changed && !selected.range.collapsed) {
    changed = fallbackWrapSelection(editor, type === "bold" ? "strong" : "em");
  }
  if (changed) dispatchEditorInput(editor);
  editor.focus();
  return changed;
}

export function applyNotesRichLink(editor, href) {
  if (typeof href !== "string" || !/^https?:\/\//i.test(href)) {
    throw new TypeError("Notes rich link must use http or https");
  }
  const selected = selectionInside(editor);
  if (!selected || selected.range.collapsed) return false;

  const documentObject = editor.ownerDocument;
  let changed = false;
  if (typeof documentObject.execCommand === "function") {
    changed = documentObject.execCommand("createLink", false, href);
  }
  if (!changed) {
    changed = fallbackWrapSelection(editor, "a", { href });
  }
  if (changed) {
    for (const link of editor.querySelectorAll("a")) {
      link.rel = "noopener noreferrer";
      link.tabIndex = -1;
      link.dataset.notesRichMark = "link";
    }
    dispatchEditorInput(editor);
  }
  editor.focus();
  return changed;
}

export function undoNotesRichEditor(editor) {
  const documentObject = editor.ownerDocument;
  if (typeof documentObject.execCommand !== "function") return false;
  editor.focus();
  const changed = documentObject.execCommand("undo", false, null);
  if (changed) dispatchEditorInput(editor);
  return changed;
}

export function captureNotesRichSelection(editor) {
  const selected = selectionInside(editor);
  return selected ? selected.range.cloneRange() : null;
}

export function restoreNotesRichSelection(editor, range) {
  if (!range || !range.startContainer?.isConnected || !range.endContainer?.isConnected) return false;
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return false;
  const selection = editor.ownerDocument.getSelection?.();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function notesRichSelectionState(editor) {
  const selected = selectionInside(editor);
  if (!selected) {
    return Object.freeze({ blockType: "paragraph", bold: false, italic: false, link: false });
  }

  let node = selected.range.startContainer.nodeType === 3
    ? selected.range.startContainer.parentElement
    : selected.range.startContainer;
  let bold = false;
  let italic = false;
  let link = false;
  while (node && node !== editor) {
    const descriptor = markDescriptor(node);
    if (descriptor?.type === "bold") bold = true;
    if (descriptor?.type === "italic") italic = true;
    if (descriptor?.type === "link") link = true;
    node = node.parentElement;
  }
  const block = directEditorChild(editor, selected.range.startContainer);
  return Object.freeze({
    blockType: blockTypeFor(block),
    bold,
    italic,
    link,
  });
}

export function pastePlainTextIntoNotesEditor(editor, event) {
  if (!editor.contains(event.target) && event.target !== editor) return false;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  event.preventDefault();

  const blockBreaks = Math.max(0, editor.children.length - 1);
  const currentLength = (editor.textContent ?? "").length + blockBreaks;
  const remaining = Math.max(0, MAX_NOTE_TEXT_CHARS - currentLength);
  const bounded = text.slice(0, remaining);
  if (!bounded) return true;

  const documentObject = editor.ownerDocument;
  let inserted = false;
  if (typeof documentObject.execCommand === "function") {
    inserted = documentObject.execCommand("insertText", false, bounded);
  }
  if (!inserted) {
    const selected = selectionInside(editor);
    if (selected) {
      selected.range.deleteContents();
      const textNode = documentObject.createTextNode(bounded);
      selected.range.insertNode(textNode);
      selected.range.setStartAfter(textNode);
      selected.range.collapse(true);
      selected.selection.removeAllRanges();
      selected.selection.addRange(selected.range);
      inserted = true;
    }
  }
  if (inserted) dispatchEditorInput(editor);
  return true;
}

export function preventNotesRichDrop(event) {
  event.preventDefault();
}
