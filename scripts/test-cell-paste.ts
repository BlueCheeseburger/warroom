// Exercises the flow-cell clipboard cleaning and sanitizer against real-world
// clipboard payloads (Word, Google Docs) plus hostile input. jsdom supplies the
// DOMParser the sanitizer relies on in the renderer.
//
// Run:  npx tsx scripts/test-cell-paste.ts

import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
(globalThis as any).DOMParser = dom.window.DOMParser;

const { cleanPastedHtml, sanitizeCellHtml, cellToHtml, htmlToText } = await import('../src/lib/cellHtml');

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  →  ' + extra : ''}`); }
}

// A real Word clipboard payload for a bolded, underlined tag copied out of a
// Verbatim speech doc: mso <style> block, class attrs, explicit font + size +
// white ink, and an <o:p> Office tag.
const WORD_TAG = `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><style><!-- p.MsoNormal {font-family:"Calibri",sans-serif;} --></style></head>
<body lang=EN-US>
<p class=MsoNormal><b><u><span style='font-size:12.0pt;font-family:"Calibri",sans-serif;color:white;background:yellow'>Warming causes extinction</span></u></b><o:p></o:p></p>
</body></html>`;

console.log('\n[1] Word tag paste');
{
  const out = cleanPastedHtml(WORD_TAG, 'Warming causes extinction');
  check('keeps the text', out.includes('Warming causes extinction'), out);
  check('keeps bold', /<b>/.test(out), out);
  check('keeps underline', /<u>/.test(out), out);
  check('drops font-family', !/font-family/i.test(out), out);
  check('drops font-size', !/font-size/i.test(out), out);
  check('drops the white ink color', !/color\s*:/i.test(out), out);
  check('drops Word background shorthand', !/background/i.test(out), out);
  check('drops the mso <style> block contents', !/MsoNormal\s*\{/.test(out), out);
  check('drops class attributes', !/class=/i.test(out), out);
}

// Google Docs emits background-color:transparent on every span. Left in, it
// would match the .flow-cell `span[style*="background-color"]` dark-ink rule and
// force pasted text to near-black — invisible in dark mode.
console.log('\n[2] Google Docs paste (background-color:transparent trap)');
{
  const GDOCS = `<meta charset="utf-8"><b style="font-weight:normal"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-style:italic;">Perm do both</span></b>`;
  const out = cleanPastedHtml(GDOCS, 'Perm do both');
  check('keeps the text', out.includes('Perm do both'), out);
  check('keeps italic', /font-style:\s*italic/.test(out), out);
  check('drops background-color entirely', !/background-color/i.test(out), out);
  check('drops color', !/color\s*:/i.test(out), out);
}

console.log('\n[3] Plain-text clipboard / fallbacks');
{
  check('plain text is escaped', cleanPastedHtml('', 'a < b & c') === 'a &lt; b &amp; c');
  check('newlines become <br>', cleanPastedHtml('', 'one\ntwo') === 'one<br>two');
  check('CRLF becomes one <br>', cleanPastedHtml('', 'one\r\ntwo') === 'one<br>two');
  check('empty clipboard yields nothing', cleanPastedHtml('', '') === '');
  // HTML that sanitizes away to nothing must fall back to the text flavor.
  check('wrapper-only HTML falls back to text', cleanPastedHtml('<meta charset="utf-8">', 'hello') === 'hello', cleanPastedHtml('<meta charset="utf-8">', 'hello'));
}

console.log('\n[4] Hostile clipboard / remote content');
{
  check('script is dropped', !/alert/.test(cleanPastedHtml('<script>alert(1)</script>ok', '')), cleanPastedHtml('<script>alert(1)</script>ok', ''));
  check('img onerror is dropped', !/onerror|<img/i.test(cleanPastedHtml('<img src=x onerror=alert(1)>hi', '')), cleanPastedHtml('<img src=x onerror=alert(1)>hi', ''));
  check('event handlers on allowed tags are dropped', !/onclick/i.test(cleanPastedHtml('<b onclick="alert(1)">x</b>', '')), cleanPastedHtml('<b onclick="alert(1)">x</b>', ''));
  check('javascript: url in style is dropped', !/javascript/i.test(sanitizeCellHtml('<span style="background-color:javascript:alert(1)">x</span>')), sanitizeCellHtml('<span style="background-color:javascript:alert(1)">x</span>'));
  check('url() in style is dropped', !/url\(/i.test(sanitizeCellHtml('<span style="background-color:url(http://x/a.png)">x</span>')));
  check('iframe subtree text never leaks', !/evil/.test(cleanPastedHtml('<iframe>evil</iframe>safe', '')), cleanPastedHtml('<iframe>evil</iframe>safe', ''));
}

// The ⌘⇧H highlight must survive a normal (non-paste) sanitize round-trip,
// otherwise reopening a flow would strip every highlight the user applied.
console.log('\n[5] Our own highlight survives the render path');
{
  const hi = '<span style="background-color: rgb(253, 230, 138);">dropped</span>';
  const out = cellToHtml(hi);
  check('highlight span survives cellToHtml', /background-color/.test(out), out);
  check('highlight text survives', out.includes('dropped'), out);
  check('paste path would strip it (by design)', !/background-color/.test(cleanPastedHtml(hi, 'dropped')));
}

console.log('\n[6] htmlToText round-trip');
{
  check('tags stripped for text', htmlToText('<b>a</b><br><i>b</i>') === 'a\nb', JSON.stringify(htmlToText('<b>a</b><br><i>b</i>')));
  check('entities decoded', htmlToText('a &amp; b') === 'a & b', htmlToText('a &amp; b'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
