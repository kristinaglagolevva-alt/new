import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Minus,
  Plus,
  Undo,
  Redo,
  Hash,
  Table as TableIcon,
  Paintbrush,
  Braces,
} from 'lucide-react';
import { cn } from './ui/utils';
import type { TemplateType } from '../data/models';
import { TEMPLATE_PLACEHOLDERS, type TemplatePlaceholder } from '../data/templatePlaceholders';
import '../styles/doc-template.css';
import { DEFAULT_FONT_SIZE, FONT_SIZES, FONT_SIZE_STEPS, findNearestFontSize, pxToPt } from './rich-text-utils';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  editable?: boolean;
  previewType?: TemplateType;
}

const TABLE_TEMPLATE_HTML = `<table class="doc-table-striped">
  <thead>
    <tr>
      <th>№</th>
      <th>Наименование</th>
      <th>Кол-во</th>
      <th>Стоимость, руб.</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td>Описание позиции</td>
      <td>1</td>
      <td>0.00</td>
    </tr>
  </tbody>
</table>
<p></p>`;

const normalizeDocumentLayout = (root: HTMLElement) => {
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
      paragraph
        .querySelectorAll('.doc-flexline__tab')
        .forEach((span) => span.classList.remove('doc-flexline__tab'));
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
        paragraph.innerHTML = `<span>${left}</span><span class="doc-flexline__tab"></span><span>${'${date}'}${
          right ? ' ' + right : ''
        }</span>`;
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
            (tableText.includes('исполнитель') || tableText.includes('заказчик') || tableText.includes('подпись'))
          );
        });
      if (signatureCandidate) {
        signatureCandidate.classList.add('doc-table-signature');
      }
    }
  }

  root.querySelectorAll('li').forEach((listItem) => {
    const firstParagraph = listItem.querySelector(':scope > p');
    if (firstParagraph) {
      firstParagraph.classList.add('doc-no-indent');
    }
  });

  root.querySelectorAll('p > span').forEach((span) => {
    if (span.textContent?.trim() === '') {
      span.classList.add('doc-flexline__tab');
      span.parentElement?.classList.add('doc-flexline');
    }
  });
};

export function RichTextEditor({ content, onChange, editable = true, previewType }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const scaleContainerRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRef = useRef<Range | null>(null);
  const lastSerializedHtmlRef = useRef<string>('');
  const skipNextContentSyncRef = useRef(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [tableBorderWidth, setTableBorderWidth] = useState('2');
  const [tableBorderColor, setTableBorderColor] = useState('#000000');
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const baseWidthRef = useRef<number | null>(null);
  const [baseWidth, setBaseWidth] = useState<number | null>(null);

  const stats = useMemo(() => ({ wordCount, charCount }), [wordCount, charCount]);

  const updateStats = useCallback(() => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText || '';
    const words = text.split(/\s+/).filter((word) => word.length > 0).length;
    setWordCount(words);
    setCharCount(text.length);
  }, []);

  const recalcScale = useCallback(() => {
    const wrapper = scaleContainerRef.current;
    const doc = documentRef.current;
    if (!wrapper || !doc) return;

    const currentScale = scaleRef.current || 1;
    const measuredWidth = doc.scrollWidth / currentScale;
    if (measuredWidth > 0) {
      if (!baseWidthRef.current || Math.abs(measuredWidth - baseWidthRef.current) > 1) {
        baseWidthRef.current = measuredWidth;
        setBaseWidth(measuredWidth);
      }
      const base = baseWidthRef.current ?? measuredWidth;
      const available = wrapper.clientWidth;
      if (available > 0 && base > 0) {
        const rawScale = available / base;
        const clamped = Math.max(0.6, Math.min(1, rawScale));
        if (Math.abs(clamped - scaleRef.current) > 0.01) {
          scaleRef.current = clamped;
          setScale(clamped);
        } else if (Math.abs(clamped - scaleRef.current) > 0.001) {
          scaleRef.current = clamped;
          setScale(clamped);
        }
      }
    }
  }, []);

  const storeSelection = useCallback(() => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editorRef.current || !editorRef.current.contains(range.commonAncestorContainer)) return;
    lastSelectionRef.current = range.cloneRange();
  }, []);

  const restoreSelection = useCallback(() => {
    const selection = document.getSelection();
    if (!selection || !lastSelectionRef.current) return false;
    selection.removeAllRanges();
    selection.addRange(lastSelectionRef.current);
    return true;
  }, []);

  const normalizeDocument = useCallback(() => {
    if (!documentRef.current) return;
    normalizeDocumentLayout(documentRef.current);
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

  useEffect(() => {
    const wrapper = scaleContainerRef.current;
    const doc = documentRef.current;
    if (!wrapper || !doc) return;

    const observer = new ResizeObserver(() => {
      recalcScale();
    });

    observer.observe(wrapper);
    observer.observe(doc);
    recalcScale();

    return () => observer.disconnect();
  }, [recalcScale]);

  useLayoutEffect(() => {
    if (!editable) {
      return;
    }
    if (!editorRef.current) return;
    const normalizedContent = content ?? '';
    const editor = editorRef.current;

    if (skipNextContentSyncRef.current && lastSerializedHtmlRef.current === normalizedContent) {
      skipNextContentSyncRef.current = false;
      updateStats();
      return;
    }

    skipNextContentSyncRef.current = false;
    const currentHtml = editor.innerHTML;
    if (currentHtml === normalizedContent) {
      lastSerializedHtmlRef.current = normalizedContent;
      normalizeDocument();
      updateStats();
      return;
    }

    editor.innerHTML = normalizedContent;
    lastSerializedHtmlRef.current = normalizedContent;
    normalizeDocument();
    updateStats();
    recalcScale();
  }, [content, editable, normalizeDocument, recalcScale, updateStats]);

  useEffect(() => {
    if (!editable) return;
    if (!editorRef.current) return;
    normalizeDocument();
    updateStats();
    recalcScale();
  }, [editable, normalizeDocument, recalcScale, updateStats]);

  useEffect(() => {
    requestAnimationFrame(() => {
      recalcScale();
    });
  }, [content, editable, previewType, recalcScale]);

  const emitChange = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastSerializedHtmlRef.current = html;
    skipNextContentSyncRef.current = true;
    onChange(html);
    updateStats();
    recalcScale();
  }, [onChange, recalcScale, updateStats]);

  const applyFormatting = useCallback(
    (command: string, value?: string) => {
      if (!editorRef.current) {
        return;
      }
      editorRef.current.focus();
      restoreSelection();

      document.execCommand(command, false, value ?? undefined);
      normalizeDocument();
      emitChange();
      updateFontSizeFromSelection();
      storeSelection();
    },
    [emitChange, normalizeDocument, restoreSelection, storeSelection, updateFontSizeFromSelection]
  );

  const applyFontSize = useCallback(
    (nextSize: number) => {
      if (!editorRef.current) {
        return;
      }

      editorRef.current.focus();
      restoreSelection();

      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch {
        // Some browsers ignore styleWithCSS; safe to continue.
      }

      document.execCommand('fontSize', false, '7');

      try {
        document.execCommand('styleWithCSS', false, 'false');
      } catch {
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

      const keywordValues = new Set([
        'xxx-large',
        'xx-large',
        'x-large',
        'large',
        'larger',
        'medium',
        'small',
        'smaller',
        'x-small',
        'xx-small',
      ]);
      const sizedSpans = Array.from(
        editorNode.querySelectorAll('span[style*="font-size" i]')
      ) as HTMLElement[];
      sizedSpans.forEach((span) => {
        const rawValue = span.style.fontSize.trim().toLowerCase();
        if (!rawValue) {
          return;
        }
        const isKeyword = keywordValues.has(rawValue);
        let isExecCommandNumeric = false;
        const numeric = parseFloat(rawValue);
        if (Number.isFinite(numeric)) {
          const unit = rawValue.replace(String(numeric), '').trim();
          let numericPt: number | null = null;
          if (unit === 'pt') {
            numericPt = numeric;
          } else if (unit === 'px') {
            numericPt = pxToPt(numeric);
          }
          if (numericPt != null && Math.abs(numericPt - 36) < 0.6) {
            isExecCommandNumeric = true;
          }
        }
        if (!isKeyword && !isExecCommandNumeric) {
          return;
        }
        span.style.fontSize = `${nextSize}pt`;
      });

      normalizeDocument();
      emitChange();
      setFontSize(nextSize);
      updateFontSizeFromSelection();
      storeSelection();
    },
    [emitChange, normalizeDocument, restoreSelection, storeSelection, updateFontSizeFromSelection]
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

  const handleEditorInput = useCallback(() => {
    storeSelection();
    if (!editorRef.current) return;
    emitChange();
  }, [emitChange, storeSelection]);

  const handleEditorBlur = useCallback(() => {
    if (!documentRef.current) return;
    normalizeDocument();
    emitChange();
  }, [emitChange, normalizeDocument]);

  const insertVariable = useCallback(
    (variable: string) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      restoreSelection();
      if (!document.execCommand('insertText', false, variable)) {
        const selection = document.getSelection();
        if (!selection) return;
        selection.deleteFromDocument();
        const textNode = document.createTextNode(variable);
        selection.getRangeAt(0).insertNode(textNode);
        selection.collapseToEnd();
      }
      normalizeDocument();
      emitChange();
      storeSelection();
    },
    [emitChange, normalizeDocument, restoreSelection, storeSelection]
  );

  const insertTable = useCallback(() => {
    applyFormatting('insertHTML', TABLE_TEMPLATE_HTML);
  }, [applyFormatting]);

  const toggleTableTransparency = useCallback(() => {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;

    const findTable = (candidate: Node | null): HTMLTableElement | null => {
      while (candidate) {
        if (candidate instanceof HTMLTableElement) {
          return candidate;
        }
        candidate = candidate.parentNode;
      }
      return null;
    };

    const table = findTable(node);
    if (!table) return;

    if (table.classList.contains('doc-table-transparent')) {
      table.classList.remove('doc-table-transparent');
      table.dataset.displayMode = 'visible';
    } else {
      table.classList.add('doc-table-transparent');
      table.dataset.displayMode = 'transparent';
    }

    normalizeDocument();
    emitChange();
  }, [emitChange, normalizeDocument, restoreSelection]);

  const applyTableBorderStyle = useCallback(() => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;

    const findTable = (candidate: Node | null): HTMLTableElement | null => {
      while (candidate) {
        if (candidate instanceof HTMLTableElement) {
          return candidate;
        }
        candidate = candidate.parentNode;
      }
      return null;
    };

    const table = findTable(node);
    if (!table) return;
    const borderStyle = `${tableBorderWidth}px solid ${tableBorderColor}`;
    table.style.border = borderStyle;
    table.classList.add('doc-table-bordered');
    table.classList.remove('doc-table-transparent');
    table.dataset.displayMode = 'visible';
    const cells = table.querySelectorAll('td, th');
    cells.forEach((cell) => {
      (cell as HTMLElement).style.border = borderStyle;
    });
    normalizeDocument();
    emitChange();
  }, [emitChange, normalizeDocument, restoreSelection, tableBorderColor, tableBorderWidth]);

  const placeholderGroups = useMemo(() => {
    const collator = new Intl.Collator('ru');
    const grouped = new Map<string, TemplatePlaceholder[]>();
    TEMPLATE_PLACEHOLDERS.forEach((placeholder) => {
      const group = placeholder.category ?? 'Прочее';
      if (!grouped.has(group)) {
        grouped.set(group, []);
      }
      grouped.get(group)!.push(placeholder);
    });
    return Array.from(grouped.entries())
      .map(([group, items]) => ({
        group,
        items: [...items].sort((a, b) => collator.compare(a.label, b.label)),
      }))
      .sort((a, b) => collator.compare(a.group, b.group));
  }, []);

  const variableList = useMemo(
    () => (
      <div className="space-y-4">
        {placeholderGroups.map(({ group, items }) => (
          <div key={group} className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-1">{group}</p>
            {items.map((placeholder) => (
              <Button
                key={placeholder.token}
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => insertVariable(placeholder.token)}
                title={placeholder.token}
              >
                {placeholder.label}
              </Button>
            ))}
          </div>
        ))}
      </div>
    ),
    [insertVariable, placeholderGroups]
  );

  const outerClasses = cn(
    'flex flex-col h-full',
    editable ? 'border border-gray-200/60 rounded-lg overflow-hidden bg-gray-50/30 shadow-sm' : 'overflow-hidden'
  );
  const bodyBackgroundClass = editable ? 'bg-[#f8f9fa]' : 'bg-gray-50/30';
  const documentClasses = cn(
    'doc-template doc-template-preview rounded-xl border min-h-[680px] w-[210mm]',
    editable ? 'border-gray-200/40 bg-[#fefefe] shadow-sm cursor-text' : 'border-slate-200 bg-white shadow-inner',
    previewType ? `doc-template-preview--${previewType}` : null,
    previewType ? `doc-template--${previewType}` : null
  );
  const documentStyle = useMemo(
    () => ({
      paddingTop: '72px',
      paddingRight: '72px',
      paddingBottom: '72px',
      paddingLeft: '72px',
    }),
    []
  );
  const scaleStyle = useMemo(
    () => ({
      transform: `scale(${scale})`,
      transformOrigin: 'top center',
      width: baseWidth ? `${baseWidth}px` : undefined,
    }),
    [baseWidth, scale]
  );

  return (
    <div className={outerClasses}>
      {editable && (
        <div className="border-b border-gray-200/60 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="p-2 border-b border-gray-200/40">
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-gray-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFormatting('undo')}
                title="Отменить (Ctrl+Z)"
              >
                <Undo className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-gray-100"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFormatting('redo')}
                title="Повторить (Ctrl+Shift+Z)"
              >
                <Redo className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-6 mx-1" />

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => adjustFontSize('decrease')}
                >
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <Select
                  value={String(fontSize)}
                  onOpenChange={(open) => {
                    if (open) {
                      storeSelection();
                    }
                  }}
                  onValueChange={(value) => applyFontSize(Number(value))}
                >
                  <SelectTrigger
                    className="h-8 w-[64px]"
                    onMouseDown={(event) => {
                      if (event.button === 0) {
                        storeSelection();
                      }
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_SIZES.map((size) => (
                      <SelectItem key={size.value} value={size.value}>
                        {size.label}
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
                <UnderlineIcon className="w-3.5 h-3.5" />
              </Button>
              <Separator orientation="vertical" className="h-6 mx-1" />
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
              <Separator orientation="vertical" className="h-6 mx-1" />
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
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Button
                variant="outline"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={insertTable}
              >
                <TableIcon className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={toggleTableTransparency}
              >
                <Hash className="w-3.5 h-3.5" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      storeSelection();
                    }}
                  >
                    <Braces className="w-3.5 h-3.5" />
                    Плейсхолдеры
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64">{variableList}</PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <Paintbrush className="w-3.5 h-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56">
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground">Толщина рамки</label>
                      <Select value={tableBorderWidth} onValueChange={setTableBorderWidth}>
                        <SelectTrigger className="h-8 mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['1', '1.5', '2', '2.5', '3'].map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}px
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Цвет рамки</label>
                      <input
                        type="color"
                        value={tableBorderColor}
                        onChange={(event) => setTableBorderColor(event.target.value)}
                        className="w-full h-8 rounded border"
                      />
                    </div>
                    <Button size="sm" className="w-full" onClick={applyTableBorderStyle}>
                      Применить к таблице
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="px-4 py-1.5 bg-gray-50/50 border-t border-gray-200/40 flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-4">
              <span>Слов: {stats.wordCount}</span>
              <span>Символов: {stats.charCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs">
                Горячие клавиши: Ctrl+B (жирный), Ctrl+I (курсив), Ctrl+U (подчёркивание)
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={cn('flex-1 overflow-auto', bodyBackgroundClass)}>
        <div ref={scaleContainerRef} className="mx-auto w-full flex justify-center px-4 sm:px-8">
          <div className="inline-block" style={scaleStyle}>
            <div ref={documentRef} className={documentClasses} style={documentStyle}>
              {editable ? (
                <div
                  ref={editorRef}
                  className="outline-none min-h-[600px]"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={handleEditorInput}
                  onBlur={handleEditorBlur}
                  onKeyUp={storeSelection}
                  onMouseUp={storeSelection}
                />
              ) : (
                <div
                  ref={editorRef}
                  className="min-h-[600px]"
                  dangerouslySetInnerHTML={{ __html: content || '' }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {editable && (
        <div className="border-t border-gray-200/60 bg-white/80 px-4 py-2 flex items-center justify-between">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onMouseDown={(event) => {
                  event.preventDefault();
                  storeSelection();
                }}
              >
                <Plus className="h-4 w-4" />
                Переменные
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">{variableList}</PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
