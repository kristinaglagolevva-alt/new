import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ScrollArea } from './ui/scroll-area';
import { useDatabase } from '../data/DataContext';
import type { Template } from '../data/models';
import {
  Plus,
  Save,
  Trash2,
  Bold,
  Italic,
  Underline,
  Download,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Table,
  SquareDashed,
  Minus,
  CheckCircle2,
} from 'lucide-react';
import { convertToHtml } from 'mammoth/mammoth.browser';

const TEMPLATE_TYPES: { value: Template['type']; label: string }[] = [
  { value: 'act', label: 'Акт' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'timesheet', label: 'Таймшит' },
  { value: 'custom', label: 'Другое' },
];

const FONT_SIZE_STEPS = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32];
const DEFAULT_FONT_SIZE = 12;

const pxToPt = (px: number) => Math.round((px * 72) / 96);

const findNearestFontSize = (value: number) => {
  let closest = FONT_SIZE_STEPS[0];
  let minDiff = Math.abs(value - closest);
  for (const option of FONT_SIZE_STEPS) {
    const diff = Math.abs(value - option);
    if (diff < minDiff) {
      minDiff = diff;
      closest = option;
    }
  }
  return closest;
};

const DOC_TEMPLATE_STYLESHEET = `@page {
  size: A4;
  margin: 2cm;
}
body.doc-template,
.doc-template-preview {
  font-family: "Times New Roman", serif;
  font-size: 12pt;
  line-height: 1.2;
  color: #000;
}
body.doc-template {
  margin: 2cm;
  white-space: pre-wrap;
}
body.doc-template strong,
.doc-template-preview strong {
  font-weight: 700;
}
body.doc-template p,
.doc-template-preview p {
  margin: 0 0 6pt;
  text-indent: 1.25cm;
  text-align: justify;
}
body.doc-template p.no-indent,
.doc-template-preview p.no-indent,
body.doc-template p.doc-no-indent,
.doc-template-preview p.doc-no-indent,
body.doc-template p[style*="text-align:center"],
.doc-template-preview p[style*="text-align:center"],
body.doc-template p[style*="text-align: center"],
.doc-template-preview p[style*="text-align: center"],
body.doc-template p[style*="text-align:right"],
.doc-template-preview p[style*="text-align:right"],
body.doc-template p[style*="text-align: right"],
.doc-template-preview p[style*="text-align: right"],
body.doc-template p[style*="margin-left: 0"],
.doc-template-preview p[style*="margin-left: 0"],
body.doc-template p[style*="margin-left:0"],
.doc-template-preview p[style*="margin-left:0"] {
  text-indent: 0;
  text-align: inherit;
}
body.doc-template p.doc-center,
.doc-template-preview p.doc-center {
  text-indent: 0;
  text-align: center;
}
body.doc-template p.doc-right,
.doc-template-preview p.doc-right {
  text-indent: 0;
  text-align: right;
}
body.doc-template p.doc-flexline,
.doc-template-preview p.doc-flexline {
  text-indent: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12pt;
  flex-wrap: nowrap;
}
body.doc-template p.doc-flexline .doc-flexline__tab,
.doc-template-preview p.doc-flexline .doc-flexline__tab {
  flex: 1 1 auto;
}
body.doc-template p.doc-flexline span:last-child,
.doc-template-preview p.doc-flexline span:last-child {
  text-align: right;
}
body.doc-template span[style*="mso-tab-count"],
.doc-template-preview span[style*="mso-tab-count"] {
  display: inline-block;
  min-width: 2.5cm;
}
body.doc-template ul,
body.doc-template ol,
.doc-template-preview ul,
.doc-template-preview ol {
  margin: 0 0 6pt 1.27cm;
  padding: 0 0 0 0.4cm;
  list-style-position: outside;
}
body.doc-template ol,
.doc-template-preview ol {
  list-style: decimal;
}
body.doc-template ul,
.doc-template-preview ul {
  list-style: disc;
}
body.doc-template li,
.doc-template-preview li {
  margin: 0;
}
body.doc-template li p,
.doc-template-preview li p {
  margin: 0;
  text-indent: 0;
  text-align: inherit;
}
body.doc-template span[style*="mso-list:ignore" i],
.doc-template-preview span[style*="mso-list:ignore" i] {
  display: inline-block;
  min-width: 1.1cm;
}
body.doc-template table,
.doc-template-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
  border: none;
}
body.doc-template table.doc-table-plain,
.doc-template-preview table.doc-table-plain {
  border: none;
}
body.doc-template table.doc-table-plain td,
.doc-template-preview table.doc-table-plain td {
  border: none;
}
body.doc-template th,
body.doc-template td,
.doc-template-preview th,
.doc-template-preview td {
  border: none;
  padding: 4pt 6pt;
  vertical-align: top;
  text-indent: 0;
  text-align: left;
}
body.doc-template th,
.doc-template-preview th {
  font-weight: 700;
  text-align: center;
}
body.doc-template table.doc-table-striped thead th,
.doc-template-preview table.doc-table-striped thead th {
  background-color: #f3f4f6;
}
body.doc-template table.doc-table-bordered,
body.doc-template table.doc-table-striped,
body.doc-template table.doc-table-signature,
.doc-template-preview table.doc-table-bordered,
.doc-template-preview table.doc-table-striped,
.doc-template-preview table.doc-table-signature {
  border: 1.5pt solid #000;
}
body.doc-template table.doc-table-bordered th,
body.doc-template table.doc-table-bordered td,
body.doc-template table.doc-table-striped th,
body.doc-template table.doc-table-striped td,
.doc-template-preview table.doc-table-bordered th,
.doc-template-preview table.doc-table-bordered td,
.doc-template-preview table.doc-table-striped th,
.doc-template-preview table.doc-table-striped td {
  border: 1pt solid #000;
}
body.doc-template table.doc-table-transparent,
.doc-template-preview table.doc-table-transparent {
  border: none !important;
}
body.doc-template table.doc-table-transparent th,
body.doc-template table.doc-table-transparent td,
.doc-template-preview table.doc-table-transparent th,
.doc-template-preview table.doc-table-transparent td {
  border: none !important;
}
body.doc-template tfoot td,
.doc-template-preview tfoot td {
  font-weight: 700;
}
body.doc-template tfoot td:first-child,
.doc-template-preview tfoot td:first-child {
  text-align: right;
}
body.doc-template table.doc-table-signature,
.doc-template-preview table.doc-table-signature {
  margin-top: 18pt;
  border: 1.5pt solid #000;
}
body.doc-template table.doc-table-signature td,
.doc-template-preview table.doc-table-signature td {
  border: 1.5pt solid #000;
  padding: 6pt 8pt;
  height: 32pt;
  vertical-align: bottom;
}
body.doc-template table.doc-table-signature td:first-child,
body.doc-template table.doc-table-signature td:last-child,
.doc-template-preview table.doc-table-signature td:first-child,
.doc-template-preview table.doc-table-signature td:last-child {
  width: 50%;
}
body.doc-template table.doc-table-signature .doc-label,
.doc-template-preview table.doc-table-signature .doc-label {
  font-weight: 700;
  text-indent: 0;
}
body.doc-template table + p,
.doc-template-preview table + p {
  margin-top: 12pt;
}
body.doc-template hr.doc-divider,
.doc-template-preview hr.doc-divider {
  border: none;
  border-top: 1pt solid #000;
  margin: 12pt 0;
}
body.doc-template .doc-title,
.doc-template-preview .doc-title {
  text-indent: 0;
  text-align: center;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6pt;
}
body.doc-template .doc-subtitle,
.doc-template-preview .doc-subtitle {
  text-indent: 0;
  text-align: center;
  margin-bottom: 6pt;
}
body.doc-template .doc-meta-line,
.doc-template-preview .doc-meta-line {
  text-indent: 0;
  display: flex;
  justify-content: space-between;
  margin-bottom: 6pt;
}
body.doc-template .doc-meta-line span:first-child,
.doc-template-preview .doc-meta-line span:first-child {
  text-align: left;
}
body.doc-template .doc-meta-line span:last-child,
.doc-template-preview .doc-meta-line span:last-child {
  text-align: right;
  min-width: 5.5cm;
}
body.doc-template .doc-placeholder,
.doc-template-preview .doc-placeholder {
  display: inline-block;
  min-width: 2cm;
  border-bottom: 0.5pt solid #000;
  text-indent: 0;
}
body.doc-template .doc-note,
.doc-template-preview .doc-note {
  font-size: 10pt;
  text-indent: 0;
  margin-top: 4pt;
}
body.doc-template .doc-small,
.doc-template-preview .doc-small {
  font-size: 10pt;
}
body.doc-template sup,
.doc-template-preview sup {
  font-size: 9pt;
}
body.doc-template table.doc-table-transparent,
.doc-template-preview table.doc-table-transparent {
  border: none;
}
body.doc-template table.doc-table-transparent td,
.doc-template-preview table.doc-table-transparent td {
  border: none;
  padding: 3pt 4pt;
}
`; // exported HTML stylesheet for printed look

const TABLE_TEMPLATE_HTML = `<table class="doc-table-striped">
  <thead>
    <tr>
      <th>Наименование</th>
      <th>Кол-во часов</th>
      <th>Стоимость часа</th>
      <th>Стоимость</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td colspan="3" style="text-align: right; font-weight: 700;">Итого:</td>
      <td></td>
    </tr>
  </tfoot>
</table>`;

export function TemplatesPage() {
  const { templates, saveTemplate, deleteTemplate } = useDatabase();
  const [activeId, setActiveId] = useState<string | null>(templates[0]?.id ?? null);
  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeId) ?? templates[0] ?? null,
    [templates, activeId]
  );

  const [draft, setDraft] = useState<Template | null>(activeTemplate ? { ...activeTemplate } : null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const draftContentRef = useRef<string>(draft?.content ?? '');
  const lastSelectionRef = useRef<Range | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [showSaveToast, setShowSaveToast] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);

  const captureEditorContent = useCallback(() => {
    if (!editorRef.current) return;
    draftContentRef.current = editorRef.current.innerHTML;
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const isNodeInsideEditor = useCallback((node: Node | null) => {
    if (!editorRef.current || !node) return false;
    return editorRef.current.contains(node instanceof Node ? node : null);
  }, []);

  const storeSelection = useCallback(() => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!isNodeInsideEditor(range.commonAncestorContainer)) return;
    lastSelectionRef.current = range.cloneRange();
  }, [isNodeInsideEditor]);

  const restoreSelection = useCallback(() => {
    const selection = document.getSelection();
    if (!selection || !lastSelectionRef.current) return false;
    selection.removeAllRanges();
    selection.addRange(lastSelectionRef.current);
    return true;
  }, []);

  const updateDraftFromEditor = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    draftContentRef.current = html;
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            content: html,
            updatedAt: new Date().toISOString(),
          }
        : prev
    );
  }, []);

  const updateFontSizeFromSelection = useCallback(() => {
    if (!editorRef.current) return;
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }
    if (!(node instanceof HTMLElement)) return;
    if (!editorRef.current.contains(node)) return;
    const computed = window.getComputedStyle(node);
    const px = parseFloat(computed.fontSize || '0');
    if (Number.isNaN(px) || px <= 0) return;
    const nearest = findNearestFontSize(pxToPt(px));
    setFontSize(nearest);
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!editorRef.current || !editorRef.current.contains(range.commonAncestorContainer)) return;
      lastSelectionRef.current = range.cloneRange();
      updateFontSizeFromSelection();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [updateFontSizeFromSelection]);

  const normalizeDocumentLayout = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;

    const tabSelector = 'span[style*="mso-tab-count" i]';

    const paragraphs = Array.from(root.querySelectorAll('p'));

    paragraphs.forEach((paragraph) => {
      if (paragraph.closest('li')) {
        return;
      }

      const tabSpans = Array.from(paragraph.querySelectorAll(tabSelector));
      if (tabSpans.length > 0) {
        paragraph.classList.add('doc-flexline');
        tabSpans.forEach((span) => span.classList.add('doc-flexline__tab'));
      } else {
        paragraph.classList.remove('doc-flexline');
        paragraph.querySelectorAll('.doc-flexline__tab').forEach((span) => span.classList.remove('doc-flexline__tab'));
      }

      const text = (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim();
      const styleAttr = paragraph.getAttribute('style')?.toLowerCase() ?? '';
      if (text.startsWith('за период')) {
        paragraph.classList.add('doc-center', 'doc-no-indent');
      }
      if (styleAttr.includes('mso-list')) {
        paragraph.classList.add('doc-no-indent');
      }
      if (
        !paragraph.classList.contains('doc-flexline') &&
        /г\.\s*/i.test(text) &&
        paragraph.innerHTML.includes('${date}')
      ) {
        const parts = paragraph.innerHTML.split('${date}');
        if (parts.length === 2) {
          const left = parts[0].trim();
          const right = parts[1].trim();
          paragraph.innerHTML = `<span>${left}</span><span class="doc-flexline__tab"></span><span>${'${date}'}${right ? ' ' + right : ''}</span>`;
          paragraph.classList.add('doc-flexline');
        }
      }
    });

    const stripLeadingMarker = (element: HTMLElement) => {
      const markerRegex = /^(\d+[\.\)]|[•◦\-\u2022\u25CF])/u;
      let done = false;
      while (!done && element.firstChild) {
        const first = element.firstChild;
        if (first.nodeType === Node.TEXT_NODE) {
          const raw = first.textContent ?? '';
          const normalized = raw.replace(/\u00a0/g, ' ');
          const trimmedStart = normalized.replace(/^\s+/, '');
          if (!trimmedStart) {
            element.removeChild(first);
            continue;
          }
          const match = trimmedStart.match(markerRegex);
          if (match) {
            const remainder = trimmedStart.slice(match[0].length).replace(/^\s+/, '');
            if (remainder) {
              first.textContent = remainder;
            } else {
              element.removeChild(first);
            }
            continue;
          }
          done = true;
        } else if (first.nodeType === Node.ELEMENT_NODE) {
          stripLeadingMarker(first as HTMLElement);
          if (!(first as HTMLElement).textContent?.trim()) {
            element.removeChild(first);
            continue;
          }
          done = true;
        } else {
          element.removeChild(first);
        }
      }
    };

    const standaloneParagraphs = paragraphs.filter((paragraph) => !paragraph.closest('li'));
    let currentList: HTMLOListElement | HTMLUListElement | null = null;
    let currentListType: 'ol' | 'ul' | null = null;
    let currentListKey: string | null = null;
    const listState = new Map<string, number>();
    let anonCounter = 0;
    let globalOrdinal = 0;

    standaloneParagraphs.forEach((paragraph) => {
      const text = (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim();
      const styleAttr = paragraph.getAttribute('style')?.toLowerCase() ?? '';
      const ignoreSpan = paragraph.querySelector('span[style*="mso-list:ignore" i]');
      const ignoreSpanText = ignoreSpan?.textContent ?? '';
      const ignoreNumberMatch = ignoreSpanText.match(/(\d{1,3})/);
      const inlineNumberMatch = text.match(/^(\d{1,3})[\.\)]/);
      const ordinalSource = ignoreNumberMatch ?? inlineNumberMatch;
      const declaredOrdinal = ordinalSource ? parseInt(ordinalSource[1], 10) : null;
      const bulletFromIgnore = ignoreSpanText.match(/[•◦\-\u2022\u25CF]/u);
      const bulletFromText = text.match(/^[•◦\-\u2022\u25CF]\s+/u);

      const isNumbered = typeof declaredOrdinal === 'number' && !Number.isNaN(declaredOrdinal);
      const isBullet = Boolean(bulletFromIgnore || bulletFromText);
      const isListItem = isNumbered || isBullet || styleAttr.includes('mso-list');

      if (!text) {
        currentList = null;
        currentListType = null;
        currentListKey = null;
        return;
      }

      if (!isListItem) {
        currentList = null;
        currentListType = null;
        currentListKey = null;
        return;
      }

      const listType: 'ol' | 'ul' = isNumbered ? 'ol' : 'ul';
      const listTag = listType === 'ol' ? 'OL' : 'UL';
      const parent = paragraph.parentElement;
      if (!parent) {
        currentList = null;
        currentListType = null;
        currentListKey = null;
        return;
      }

      const listIdMatch = styleAttr.match(/lfo(\d+)/);
      const resolvedKey = listIdMatch?.[1] ?? `anon-${anonCounter}`;
      if (!listIdMatch) {
        anonCounter += 1;
      }

      const previousOrdinal = listType === 'ol' ? listState.get(resolvedKey) ?? null : null;
      let effectiveOrdinal = listType === 'ol' ? declaredOrdinal ?? null : null;
      if (listType === 'ol') {
        if (effectiveOrdinal == null) {
          effectiveOrdinal = (previousOrdinal ?? globalOrdinal) + 1;
        }
        if (effectiveOrdinal <= globalOrdinal) {
          effectiveOrdinal = globalOrdinal + 1;
        }
      }

      if (!currentList || currentListType !== listType || currentListKey !== resolvedKey) {
        currentList = document.createElement(listTag) as HTMLOListElement | HTMLUListElement;
        currentListType = listType;
        currentListKey = resolvedKey;
        currentList.classList.add('doc-list');
        if (listType === 'ol' && effectiveOrdinal != null && effectiveOrdinal > 1) {
          (currentList as HTMLOListElement).start = effectiveOrdinal;
        }
        parent.insertBefore(currentList, paragraph);
      }

      const listItem = document.createElement('li');
      const workingNode = paragraph.cloneNode(true) as HTMLElement;
      workingNode.classList.add('doc-no-indent');
      workingNode.querySelectorAll('span[style*="mso-list:ignore" i]').forEach((span) => span.remove());
      workingNode.normalize();
      stripLeadingMarker(workingNode);
      workingNode.normalize();

      listItem.innerHTML = workingNode.innerHTML || workingNode.textContent || '';
      if (paragraph.classList.contains('doc-center')) {
        listItem.classList.add('doc-center');
      }
      if (paragraph.classList.contains('doc-right')) {
        listItem.classList.add('doc-right');
      }

      currentList.appendChild(listItem);
      paragraph.remove();

      if (listType === 'ol') {
        const listElement = currentList as HTMLOListElement;
        const startValue = listElement.start ?? 1;
        const currentValue = startValue + listElement.children.length - 1;
        listState.set(resolvedKey, currentValue);
        globalOrdinal = currentValue;
      } else {
        listState.set(resolvedKey, 0);
      }
    });

    let sequentialOrdinal = 0;
    root.querySelectorAll('ol').forEach((orderedList) => {
      const items = Array.from(orderedList.querySelectorAll(':scope > li'));
      if (!items.length) {
        return;
      }
      const explicitStartAttr = orderedList.getAttribute('start');
      let startValue = Number(explicitStartAttr);
      if (!Number.isFinite(startValue) || startValue <= 0) {
        startValue = sequentialOrdinal + 1;
      }

      if (startValue <= 1) {
        orderedList.removeAttribute('start');
      } else {
        orderedList.setAttribute('start', String(startValue));
      }
      sequentialOrdinal = startValue + items.length - 1;
    });

    const tables = Array.from(root.querySelectorAll('table'));
    tables.forEach((table) => {
      const styleAttr = table.getAttribute('style')?.toLowerCase() ?? '';
      const borderAttr = table.getAttribute('border');
      const borderColorAttr = table.getAttribute('bordercolor')?.toLowerCase() ?? '';
      const forcedMode = table.dataset.displayMode ?? '';
      if (forcedMode === 'transparent') {
        table.classList.add('doc-table-transparent');
        table.classList.remove('doc-table-striped', 'doc-table-bordered');
        return;
      }
      if (forcedMode === 'visible') {
        table.classList.remove('doc-table-transparent');
      }
      const isTransparent =
        /border[^:]*:\s*0/.test(styleAttr) ||
        /border[^:]*:\s*none/.test(styleAttr) ||
        /border-color:\s*transparent/.test(styleAttr) ||
        borderAttr === '0';
      const isWhiteBorder =
        /border[^:]*:\s*(?:[\d.]+pt\s*)?(?:solid\s*)?(?:#fff|#ffffff|white|rgb\(255\s*,\s*255\s*,\s*255\))/i.test(styleAttr) ||
        ['#fff', '#ffffff', 'white', 'rgb(255,255,255)'].includes(borderColorAttr);
      if (isTransparent || isWhiteBorder) {
        table.classList.add('doc-table-transparent');
      }
    });

    if (tables.length > 0) {
      const primaryTable = tables[0];
      const primaryText = primaryTable?.textContent?.toLowerCase() ?? '';
      if (
        primaryTable &&
        !primaryTable.classList.contains('doc-table-striped') &&
        !primaryTable.classList.contains('doc-table-plain') &&
        !primaryTable.classList.contains('doc-table-signature') &&
        !primaryTable.classList.contains('doc-table-transparent') &&
        !primaryText.includes('исполнитель') &&
        !primaryText.includes('заказчик')
      ) {
        primaryTable.classList.add('doc-table-striped');
      }

      if (tables.length > 1) {
        const signatureCandidate = tables
          .slice()
          .reverse()
          .find((table) => {
            if (table.classList.contains('doc-table-signature')) {
              return true;
            }
            if (table.classList.contains('doc-table-transparent') || table.classList.contains('doc-table-plain')) {
              return false;
            }
            const tableText = table.textContent?.toLowerCase() ?? '';
            return (
              table.rows.length <= 4 &&
              (tableText.includes('исполнитель') || tableText.includes('заказчик') || tableText.includes('генеральн') || tableText.includes('м.п'))
            );
          });

        if (signatureCandidate && !signatureCandidate.classList.contains('doc-table-signature')) {
          signatureCandidate.classList.add('doc-table-signature');
        }
      }
    }

    tables.forEach((table) => {
      if (
        table.classList.contains('doc-table-striped') ||
        table.classList.contains('doc-table-signature') ||
        table.classList.contains('doc-table-transparent')
      ) {
        return;
      }
      const styleAttr = table.getAttribute('style')?.toLowerCase() ?? '';
      const borderAttr = table.getAttribute('border');
      const borderColorAttr = table.getAttribute('bordercolor')?.toLowerCase() ?? '';
      const hasWhiteBorder =
        /border[^:]*:\s*(?:[\d.]+pt\s*)?(?:solid\s*)?(?:#fff|#ffffff|white|rgb\(255\s*,\s*255\s*,\s*255\))/i.test(styleAttr) ||
        ['#fff', '#ffffff', 'white', 'rgb(255,255,255)'].includes(borderColorAttr);
      if (hasWhiteBorder) {
        table.classList.add('doc-table-transparent');
        return;
      }
      const hasVisibleBorder =
        /border[^:]*:\s*(?:solid|single|double|dashed)/.test(styleAttr) ||
        /border[^:]*:\s*(?!0)(?:[1-9]\d*pt|thin|medium|thick)/.test(styleAttr) ||
        borderAttr === '1';
      if (hasVisibleBorder) {
        table.classList.add('doc-table-bordered');
      }
    });
  }, []);

  const handleSelectTemplate = (template: Template) => {
    setActiveId(template.id);
    draftContentRef.current = template.content;
    setDraft({ ...template, description: template.description ?? undefined });
    setFontSize(DEFAULT_FONT_SIZE);
    requestAnimationFrame(() => updateFontSizeFromSelection());
  };

  const handleCreateTemplate = async () => {
    if (isMutating) return;
    setIsMutating(true);
    try {
      const created = await saveTemplate({
        name: 'Новый шаблон',
        type: 'custom',
        content: '',
        description: '',
      });
      setActiveId(created.id);
      draftContentRef.current = created.content;
      setDraft({ ...created, description: created.description ?? undefined });
      setFontSize(DEFAULT_FONT_SIZE);
      requestAnimationFrame(() => updateFontSizeFromSelection());
    } catch (error) {
      console.error(error);
      window.alert('Не удалось создать шаблон. Проверьте подключение к серверу.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (templates.length <= 1) {
      window.alert('Нельзя удалить последний шаблон.');
      return;
    }
    if (window.confirm('Удалить шаблон?')) {
      setIsMutating(true);
      setIsDeletingId(id);
      const remaining = templates.filter((template) => template.id !== id);
      const nextTemplate = remaining[0] ?? null;
      try {
        await deleteTemplate(id);
        setActiveId(nextTemplate?.id ?? null);
        draftContentRef.current = nextTemplate?.content ?? '';
        setDraft(nextTemplate ? { ...nextTemplate, description: nextTemplate.description ?? undefined } : null);
      } catch (error) {
        console.error(error);
        window.alert('Не удалось удалить шаблон. Проверьте подключение к серверу.');
      } finally {
        setIsDeletingId(null);
        setIsMutating(false);
      }
    }
  };

  useEffect(() => {
    if (!activeTemplate) {
      setDraft(null);
      return;
    }

    const correctedContent = activeTemplate.content.replace(
      /\$\{startPeriodDate\}\s*по\s*\$\{startPeriodDate\}/g,
      '${startPeriodDate} по ${endPeriodDate}'
    );
    const nextDraft = { ...activeTemplate, content: correctedContent, description: activeTemplate.description ?? undefined };
    draftContentRef.current = correctedContent;
    setDraft(nextDraft);

    if (editorRef.current) {
      editorRef.current.innerHTML = correctedContent;
      requestAnimationFrame(() => {
        normalizeDocumentLayout();
        updateFontSizeFromSelection();
      });
    }
  }, [activeTemplate?.id, normalizeDocumentLayout, updateFontSizeFromSelection]);

  const handleSave = async () => {
    if (!draft || isSaving) return;
    setIsSaving(true);
    try {
      restoreSelection();
      captureEditorContent();
      normalizeDocumentLayout();
      captureEditorContent();
      const html = editorRef.current?.innerHTML ?? draft.content;
      const updated = await saveTemplate({ ...draft, content: html });
      draftContentRef.current = html;
      setDraft({ ...updated, description: updated.description ?? undefined });
      setShowSaveToast(true);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setShowSaveToast(false);
        toastTimerRef.current = null;
      }, 2000);
    } catch (error) {
      console.error(error);
      window.alert('Не удалось сохранить шаблон. Проверьте подключение к серверу.');
    } finally {
      setIsSaving(false);
    }
  };

  const applyFormatting = (command: string, value?: string) => {
    if (!editorRef.current) {
      return;
    }
    editorRef.current.focus();
    restoreSelection();
    document.execCommand(command, false, value ?? undefined);
    normalizeDocumentLayout();
    updateDraftFromEditor();
    updateFontSizeFromSelection();
    storeSelection();
  };

  const applyFontSize = useCallback(
    (nextSize: number) => {
      if (!editorRef.current) {
        return;
      }

      editorRef.current.focus();
      restoreSelection();

      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch (error) {
        // Some browsers ignore styleWithCSS; safe to continue.
      }

      document.execCommand('fontSize', false, '7');

      try {
        document.execCommand('styleWithCSS', false, 'false');
      } catch (error) {
        // Ignore reset failures; command state is best-effort.
      }

      const editorNode = editorRef.current;
      const fontNodes = Array.from(editorNode.querySelectorAll('font[size="7"]')) as HTMLFontElement[];
      fontNodes.forEach((fontNode) => {
        const span = document.createElement('span');
        span.innerHTML = fontNode.innerHTML;
        const inlineStyle = fontNode.getAttribute('style');
        if (inlineStyle) {
          span.setAttribute('style', inlineStyle);
        }
        const color = fontNode.getAttribute('color');
        const face = fontNode.getAttribute('face');
        if (color) {
          span.style.color = color;
        }
        if (face) {
          span.style.fontFamily = face;
        }
        span.style.fontSize = `${nextSize}pt`;
        fontNode.replaceWith(span);
      });

      const keywordSizedSpans = Array.from(
        editorNode.querySelectorAll('span[style*="font-size" i]')
      ) as HTMLElement[];
      keywordSizedSpans.forEach((span) => {
        const value = span.style.fontSize;
        if (!value || /\d/.test(value[0])) {
          return;
        }
        span.style.fontSize = `${nextSize}pt`;
      });

      normalizeDocumentLayout();
      updateDraftFromEditor();
      setFontSize(nextSize);
      updateFontSizeFromSelection();
      storeSelection();
    },
    [normalizeDocumentLayout, restoreSelection, storeSelection, updateDraftFromEditor, updateFontSizeFromSelection]
  );

  const adjustFontSize = useCallback(
    (direction: 'decrease' | 'increase') => {
      const currentIndex = FONT_SIZE_STEPS.findIndex((size) => size === fontSize);
      if (currentIndex === -1) {
        return;
      }

      const nextIndex =
        direction === 'increase'
          ? Math.min(currentIndex + 1, FONT_SIZE_STEPS.length - 1)
          : Math.max(currentIndex - 1, 0);

      const nextSize = FONT_SIZE_STEPS[nextIndex];
      if (nextSize === fontSize) {
        return;
      }

      applyFontSize(nextSize);
    },
    [applyFontSize, fontSize]
  );

  const handleEditorInput = () => {
    if (editorRef.current && draft) {
      storeSelection();
      captureEditorContent();
    }
  };

  const handleEditorBlur = () => {
    normalizeDocumentLayout();
    updateDraftFromEditor();
  };

  const handleImportDocx = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !draft) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const { value } = await convertToHtml({ arrayBuffer });
      const timestamp = new Date().toISOString();
      draftContentRef.current = value;
      setDraft((prev) => (prev ? { ...prev, content: value, updatedAt: timestamp } : prev));
      if (editorRef.current) {
        editorRef.current.innerHTML = value;
        requestAnimationFrame(() => normalizeDocumentLayout());
      }
    } catch (error) {
      console.error(error);
      window.alert('Не удалось импортировать документ. Проверьте формат DOCX.');
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  };

  const handleDownloadHtml = () => {
    if (!draft) return;
    const cleanedName = draft.name.trim() || 'document';
    const bodyClass = ['doc-template', draft.type ? `doc-template--${draft.type}` : '']
      .filter(Boolean)
      .join(' ');
    normalizeDocumentLayout();
    const content = editorRef.current?.innerHTML ?? draft.content;
    const htmlDocument = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${cleanedName}</title>
  <style>${DOC_TEMPLATE_STYLESHEET}</style>
</head>
<body class="${bodyClass}">
${content}
</body>
</html>`;
    const blob = new Blob([htmlDocument], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${cleanedName.replace(/\s+/g, '_')}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleInsertTable = () => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    applyFormatting('insertHTML', TABLE_TEMPLATE_HTML);
  };

  const toggleTableTransparency = () => {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }
    const table = node instanceof Element ? node.closest('table') : null;
    if (!table) return;

    const shouldBeTransparent = !table.classList.contains('doc-table-transparent');
    table.classList.toggle('doc-table-transparent', shouldBeTransparent);
    if (shouldBeTransparent) {
      table.dataset.displayMode = 'transparent';
      table.classList.remove('doc-table-striped', 'doc-table-bordered');
    } else {
      table.dataset.displayMode = 'visible';
      table.classList.remove('doc-table-transparent');
      if (!table.classList.contains('doc-table-striped') && !table.classList.contains('doc-table-signature')) {
        table.classList.add('doc-table-bordered');
      }
    }
    editorRef.current?.focus();
    normalizeDocumentLayout();
    captureEditorContent();
  };

  if (!draft) {
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="mb-2">Шаблоны документов</h1>
            <p className="text-sm text-muted-foreground">
              Управляйте текстами актов, счетов и дополнительных документов прямо в интерфейсе.
            </p>
          </div>
          <Button onClick={handleCreateTemplate}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить шаблон
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Пока шаблонов нет.
          </CardContent>
        </Card>
      </div>
    );
  }

  const updatedLabel = new Date(draft.updatedAt).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const previewClassName = [
    'doc-template',
    'doc-template-preview',
    draft.type ? `doc-template-preview--${draft.type}` : '',
    draft.type ? `doc-template--${draft.type}` : '',
    'min-h-[340px]',
    'rounded-xl',
    'border',
    'border-slate-200',
    'bg-white',
    'shadow-inner',
    'focus-within:outline-none',
    'focus-within:ring-2',
    'focus-within:ring-slate-900/20',
    'overflow-auto',
  ]
    .filter(Boolean)
    .join(' ');

  const saveToast =
    showSaveToast && typeof document !== 'undefined'
      ? createPortal(
          <div className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex items-center gap-2 rounded-lg border border-emerald-500 bg-emerald-500/95 px-4 py-3 text-sm font-medium text-white shadow-xl">
            <CheckCircle2 className="h-4 w-4" />
            <span>Изменения сохранены</span>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="max-w-5xl mx-auto px-6 pt-14 pb-10 space-y-8 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-6 mb-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Шаблоны документов</h1>
          <p className="text-sm text-muted-foreground mt-0.5 mb-2.5">
            Редактируйте тексты актов, счетов и служебных документов, не выходя из системы.
          </p>
        </div>
        <Button
          onClick={handleCreateTemplate}
          disabled={isMutating || isSaving}
          className="h-10 px-5 text-sm font-medium shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Новый шаблон
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-6">
        <Card className="h-full border border-slate-200/70 shadow-sm rounded-xl">
          <CardHeader className="px-4 pt-4 pb-2.5 items-center">
            <CardTitle className="text-[16px] font-semibold leading-6 tracking-tight text-slate-900">
              Список шаблонов
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-1.5">
            <ScrollArea className="h-[520px]">
              <div className="space-y-1.5 pt-0.5">
                {templates.map((template) => {
                  const isActive = template.id === draft.id;
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                       className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? 'border-secondary/70 bg-secondary/15 text-secondary-foreground'
                          : 'border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span
                          className={`truncate font-medium ${
                            isActive ? 'text-secondary-foreground' : 'text-slate-900'
                          }`}
                        >
                        {template.name}
                        </span>
                        <span
                          className={`shrink-0 text-[11px] uppercase tracking-wide ${
                            isActive ? 'text-secondary-foreground/80' : 'text-slate-500'
                          }`}
                        >
                          {TEMPLATE_TYPES.find((item) => item.value === template.type)?.label ?? '—'}
                        </span>
                        {template.description && (
                          <span
                            className={`truncate text-xs ${
                              isActive ? 'text-secondary-foreground/70' : 'text-slate-500'
      
                            }`}
                          >
                          ({template.description})
                          </span>
                        )}
                      </div>
                       <span
                        className={`shrink-0 text-[11px] leading-none ${
                          isActive ? 'text-secondary-foreground/80' : 'text-slate-500'
                        }`}
                      >
                        {new Date(template.updatedAt).toLocaleDateString('ru-RU', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                      })}
                          </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="h-full border border-slate-200/80 shadow-sm rounded-2xl">
          <CardHeader className="space-y-3 pb-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-semibold">{draft.name}</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                Обновлён: {updatedLabel}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{TEMPLATE_TYPES.find((item) => item.value === draft.type)?.label}</Badge>
              {draft.description && <span className="truncate">{draft.description}</span>}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Название</Label>
                <Input
                  id="template-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, name: event.target.value, updatedAt: new Date().toISOString() }
                        : prev
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-type">Тип документа</Label>
                <Select
                  value={draft.type}
                  onValueChange={(value) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            type: value as Template['type'],
                            updatedAt: new Date().toISOString(),
                          }
                        : prev
                    )
                  }
                >
                  <SelectTrigger id="template-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-description">Описание (необязательно)</Label>
              <Input
                id="template-description"
                value={draft.description ?? ''}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          description: event.target.value,
                          updatedAt: new Date().toISOString(),
                        }
                      : prev
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label>Содержимое шаблона</Label>
                  <p className="text-xs text-muted-foreground">
                    Используйте плейсхолдеры вида <code className="bg-slate-100 px-1 rounded">{'${variable}'}</code>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <div className="flex items-center gap-1 pr-2 mr-2 border-r border-slate-200">
                    <Button
                      variant="outline"
                      size="sm"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => adjustFontSize('decrease')}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <Select value={String(fontSize)} onValueChange={(value) => applyFontSize(Number(value))}>
                      <SelectTrigger className="h-8 w-[64px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FONT_SIZE_STEPS.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => adjustFontSize('increase')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('bold')}
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('italic')}
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('underline')}
                  >
                    <Underline className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('justifyLeft')}
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('justifyCenter')}
                  >
                    <AlignCenter className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('justifyRight')}
                  >
                    <AlignRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('justifyFull')}
                  >
                    <AlignJustify className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('insertUnorderedList')}
                  >
                    <List className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFormatting('insertOrderedList')}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleInsertTable}
                  >
                    <Table className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={toggleTableTransparency}
                  >
                    <SquareDashed className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleDownloadHtml}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div
                ref={editorRef}
                className={previewClassName}
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onBlur={handleEditorBlur}
                onKeyUp={storeSelection}
                onMouseUp={storeSelection}
                dangerouslySetInnerHTML={{ __html: draftContentRef.current || draft.content }}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={handleImportDocx}
                />
                <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
                  Импортировать из DOCX
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="text-xs text-muted-foreground">
                Подсказка: чтобы вернуть исходный текст, сохраните резервную копию шаблона и импортируйте её позже.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleDeleteTemplate(draft.id)}
                  disabled={isMutating || isSaving || isDeletingId === draft.id}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Сохраняем…' : 'Сохранить изменения'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      {saveToast}
    </div>
  );
}
