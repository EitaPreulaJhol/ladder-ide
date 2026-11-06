/** Minimal XML reader/writer (enough for PLCopen TC6): elements, attributes, text, CDATA, comments. */

export interface XmlElement {
  /** Local name (namespace prefix removed). */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
      );
    return ENTITIES[e] ?? m;
  });
}

const local = (n: string) => n.slice(n.indexOf(':') + 1);

/** Nesting limit: real PLCopen files stay far below; deeper documents are rejected, not walked. */
export const MAX_XML_DEPTH = 256;

export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1]!.text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3;
      if (i < 3) throw new Error('XML: comentário não fechado');
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end < 0) throw new Error('XML: CDATA não fechado');
      stack[stack.length - 1]!.text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      i = src.indexOf('>', lt) + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = local(src.slice(lt + 2, end).trim());
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML: </${name}> inesperado`);
      i = end + 1;
    } else {
      // Find the end of the tag, honoring quotes in attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = src[j]!;
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      if (j >= n) throw new Error('XML: tag não fechada');
      let body = src.slice(lt + 1, j);
      const selfClose = body.endsWith('/');
      if (selfClose) body = body.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(body);
      if (!m) throw new Error('XML: tag inválida');
      const el: XmlElement = { name: local(m[1]!), attrs: {}, children: [], text: '' };
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(body.slice(m[1]!.length)))) el.attrs[local(a[1]!)] = decode(a[3] ?? a[4] ?? '');
      stack[stack.length - 1]!.children.push(el);
      if (!selfClose) {
        if (stack.length > MAX_XML_DEPTH)
          throw new Error(`XML: aninhamento maior que ${MAX_XML_DEPTH} níveis`);
        stack.push(el);
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1]!.name}> não foi fechada`);
  const top = root.children[0];
  if (!top) throw new Error('XML vazio');
  return top;
}

export const child = (el: XmlElement | undefined, name: string) => el?.children.find((c) => c.name === name);
export const children = (el: XmlElement | undefined, name: string) =>
  el?.children.filter((c) => c.name === name) ?? [];

/** Depth-first search (document order) for descendants with this local name. Iterative: no stack overflow. */
export function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const stack = [...el.children].reverse();
  while (stack.length) {
    const c = stack.pop()!;
    if (c.name === name) out.push(c);
    for (let i = c.children.length - 1; i >= 0; i--) stack.push(c.children[i]!);
  }
  return out;
}

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Tiny builder: x('tag', {attr}, ...children | text). */
export type XmlNode =
  | string
  | {
      tag: string;
      attrs: Record<string, string | number | boolean | undefined>;
      kids: XmlNode[];
      raw?: string;
    };

export function x(
  tag: string,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...kids: (XmlNode | XmlNode[] | null | undefined | false)[]
): XmlNode {
  return {
    tag,
    attrs,
    kids: kids.flat().filter((k): k is XmlNode => k !== null && k !== undefined && k !== false),
  };
}

/** CDATA section (comments/documentation). */
export const cdata = (s: string): XmlNode => ({
  tag: '',
  attrs: {},
  kids: [],
  raw: `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`,
});

export function renderXml(node: XmlNode, indent = ''): string {
  if (typeof node === 'string') return indent + escText(node);
  if (node.raw !== undefined) return indent + node.raw;
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escAttr(String(v))}"`)
    .join('');
  if (!node.kids.length) return `${indent}<${node.tag}${attrs}/>`;
  if (node.kids.length === 1 && (typeof node.kids[0] === 'string' || node.kids[0]!.raw !== undefined))
    return `${indent}<${node.tag}${attrs}>${renderXml(node.kids[0]!, '')}</${node.tag}>`;
  return `${indent}<${node.tag}${attrs}>\n${node.kids.map((k) => renderXml(k, indent + '  ')).join('\n')}\n${indent}</${node.tag}>`;
}
