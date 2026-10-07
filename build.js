import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CleanCSS from 'clean-css';
import { XMLParser } from 'fast-xml-parser';
import { minify as minifyJs } from 'terser';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const files = {
  theme: path.join(SRC, 'theme.xml'),
  css: path.join(SRC, 'css', 'style.css'),
  js: path.join(SRC, 'js', 'main.js'),
  header: path.join(SRC, 'components', 'header.xml'),
  post: path.join(SRC, 'components', 'post.xml'),
  sidebar: path.join(SRC, 'components', 'sidebar.xml'),
  output: path.join(DIST, 'theme.xml')
};

/**
 * Read a UTF-8 source file.
 */
const readSource = async (filePath) => readFile(filePath, 'utf8');

/**
 * Escape CDATA terminators so arbitrary CSS/JS cannot break
 * the CDATA sections used by the Blogger theme.
 */
const toCdataSafe = (value) => value.replaceAll(']]>', ']]]]><![CDATA[>');

/**
 * Build the complete Blogger theme from the source components.
 */
const buildTheme = async () => {
  const [
    theme,
    cssSource,
    jsSource,
    header,
    post,
    sidebar
  ] = await Promise.all([
    readSource(files.theme),
    readSource(files.css),
    readSource(files.js),
    readSource(files.header),
    readSource(files.post),
    readSource(files.sidebar)
  ]);

  const cssResult = new CleanCSS({
    level: 2
  }).minify(cssSource);

  if (cssResult.errors.length > 0) {
    throw new Error(
      `CSS minification failed:\n${cssResult.errors.join('\n')}`
    );
  }

  const jsResult = await minifyJs(jsSource, {
    compress: true,
    mangle: true,
    format: {
      comments: false
    }
  });

  if (!jsResult.code) {
    throw new Error('JavaScript minification produced no output.');
  }

  let output = theme
    .replace('{{INCLUDE_CSS}}', toCdataSafe(cssResult.styles))
    .replace('{{INCLUDE_JS}}', toCdataSafe(jsResult.code))
    .replace('{{INCLUDE_COMPONENT:header}}', header.trim())
    .replace('{{INCLUDE_COMPONENT:post}}', post.trim())
    .replace('{{INCLUDE_COMPONENT:sidebar}}', sidebar.trim());

  const unresolved = output.match(/\{\{[^}]+\}\}/g);

  if (unresolved) {
    throw new Error(
      `Unresolved build placeholders: ${[...new Set(unresolved)].join(', ')}`
    );
  }

  return output;
};

/**
 * Validate XML syntax with a parser configured to preserve Blogger
 * namespace-qualified element names and attributes.
 *
 * This validates well-formed XML. Blogger-specific semantic validation
 * still needs to be performed by Blogger's theme editor/importer.
 */
const validateBloggerStructure = (xml) => {
  const requiredText = [
    "xmlns:b='http://www.google.com/2005/gml/b'",
    "xmlns:data='http://www.google.com/2005/gml/data'",
    "xmlns:expr='http://www.google.com/2005/gml/expr'",
    "<b:skin",
    "id='header'",
    "id='Header1'",
    "id='navigation'",
    "id='PageList1'",
    "id='main'",
    "id='Blog1'",
    "id='sidebar'",
    "id='HTML1'"
  ];

  for (const value of requiredText) {
    if (!xml.includes(value)) {
      throw new Error(
        `Blogger structure validation failed: missing required marker ${value}.`
      );
    }
  }

  const structuralXml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const count = (pattern) => (structuralXml.match(pattern) ?? []).length;

  const exactCounts = [
    ['b:section', /<b:section(?=\s|>)/g, 4],
    ['b:widget', /<b:widget(?=\s|>)/g, 4],
    ['b:skin', /<b:skin(?=\s|>)/g, 1],
    ['Blog1 widget', /id=['"]Blog1['"]/g, 1],
    ['HTML1 widget', /id=['"]HTML1['"]/g, 1],
    ['Header1 widget', /id=['"]Header1['"]/g, 1],
    ['PageList1 widget', /id=['"]PageList1['"]/g, 1]
  ];

  for (const [label, pattern, expected] of exactCounts) {
    const actual = count(pattern);
    if (actual !== expected) {
      throw new Error(
        `Blogger structure validation failed: expected ${expected} ${label}, found ${actual}.`
      );
    }
  }


  const structuralChecks = [
    ['root html element', /^<\?xml[^>]*>\s*(?:<!DOCTYPE[^>]*>\s*)?<html\b/],
    ['Blogger V3 layouts version', /<html[^>]*\bb:layoutsVersion=['"]3['"]/],
    ['Blogger widget default version', /<html[^>]*\bb:defaultwidgetversion=['"]2['"]/],
    ['Blogger responsive mode', /<html[^>]*\bb:responsive=['"]true['"]/],
    ['Header section id', /<b:section(?=\s|>)[^>]*\bid=['"]header['"]/],
    ['Navigation section id', /<b:section(?=\s|>)[^>]*\bid=['"]navigation['"]/],
    ['main section id', /<b:section(?=\s|>)[^>]*\bid=['"]main['"]/],
    ['sidebar section id', /<b:section(?=\s|>)[^>]*\bid=['"]sidebar['"]/],
    ['Header section name', /<b:section(?=\s|>)[^>]*\bid=['"]header['"][^>]*\bname=['"]Header['"]/],
    ['Navigation section name', /<b:section(?=\s|>)[^>]*\bid=['"]navigation['"][^>]*\bname=['"]Navigation['"]/],
    ['Main section name', /<b:section(?=\s|>)[^>]*\bid=['"]main['"][^>]*\bname=['"]Main['"]/],
    ['Sidebar section name', /<b:section(?=\s|>)[^>]*\bid=['"]sidebar['"][^>]*\bname=['"]Sidebar['"]/],
    ['Blog1 widget type', /<b:widget(?=\s|>)[^>]*\bid=['"]Blog1['"][^>]*\btype=['"]Blog['"]/],
    ['HTML1 widget type', /<b:widget(?=\s|>)[^>]*\bid=['"]HTML1['"][^>]*\btype=['"]HTML['"]/],
    ['Header1 widget type', /<b:widget(?=\s|>)[^>]*\bid=['"]Header1['"][^>]*\btype=['"]Header['"]/],
    ['PageList1 widget type', /<b:widget(?=\s|>)[^>]*\bid=['"]PageList1['"][^>]*\btype=['"]PageList['"]/],
    ['Header1 widget version', /<b:widget(?=\s|>)[^>]*\bid=['"]Header1['"][^>]*\bversion=['"]2['"]/],
    ['PageList1 widget version', /<b:widget(?=\s|>)[^>]*\bid=['"]PageList1['"][^>]*\bversion=['"]2['"]/],
    ['Blog1 widget settings', /<b:widget(?=\s|>)[^>]*\bid=['"]Blog1['"][\s\S]*?<b:widget-settings>[\s\S]*?<b:widget-setting name=['"]showDateHeader['"]>/],
    ['Blog1 post includable', /<b:includable\b[^>]*\bid=['"]post['"][^>]*\bvar=['"]post['"]/],
    ['Blog1 main includable', /<b:includable\b[^>]*\bid=['"]main['"][^>]*\bvar=['"]top['"]/],
    ['Blog1 comments includable', /<b:includable\b[^>]*\bid=['"]comments['"][^>]*\bvar=['"]post['"]/],
    ['Blog1 comments include call', /<b:include\s+data=['"]post['"]\s+name=['"]comments['"]\s*\/>/],
    ['Blogger comment renderer', /<data:post\.commentHtml\/>/],
    ['Blogger comment iframe bootstrap', /BLOG_CMT_createIframe\(/],
    ['Blog1 widget version', /<b:widget(?=\s|>)[^>]*\bid=['"]Blog1['"][^>]*\btype=['"]Blog['"][^>]*\bversion=['"]2['"]/],
    ['HTML1 widget version', /<b:widget(?=\s|>)[^>]*\bid=['"]HTML1['"][^>]*\btype=['"]HTML['"][^>]*\bversion=['"]2['"]/],
    ['HTML1 main includable', /<b:widget(?=\s|>)[^>]*\bid=['"]HTML1['"][\s\S]*?<b:includable\b[^>]*\bid=['"]main['"]/],
    ['Header1 main includable', /<b:widget(?=\s|>)[^>]*\bid=['"]Header1['"][\s\S]*?<b:includable\b[^>]*\bid=['"]main['"]/],
    ['PageList1 main includable', /<b:widget(?=\s|>)[^>]*\bid=['"]PageList1['"][\s\S]*?<b:includable\b[^>]*\bid=['"]main['"]/]
  ];

  for (const [label, pattern] of structuralChecks) {
    if (!pattern.test(structuralXml)) {
      throw new Error(
        `Blogger structure validation failed: missing or invalid ${label}.`
      );
    }
  }

  const sections = [...structuralXml.matchAll(/<b:section(?=\s|>)[^>]*>([\s\S]*?)<\/b:section>/g)].map((match) => match[1]);
  for (const sectionContent of sections) {
    const widgetStripped = sectionContent.replace(/<b:widget(?=\s|>)[\s\S]*?<\/b:widget>/g, '');
    if (/<(?:b:|data:|expr:)/.test(widgetStripped) || /<\/?[A-Za-z][^>]*>/.test(widgetStripped)) {
      throw new Error('Blogger structure validation failed: a b:section contains content outside its b:widget children.');
    }
  }

  const widgetIds = [...structuralXml.matchAll(/<b:widget(?=\s|>)[^>]*\bid=['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  const sectionIds = [...structuralXml.matchAll(/<b:section(?=\s|>)[^>]*\bid=['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);

  const assertUnique = (label, values) => {
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    if (duplicates.length > 0) {
      throw new Error(
        `Blogger structure validation failed: duplicate ${label} id(s): ${[...new Set(duplicates)].join(', ')}.`
      );
    }
  };

  assertUnique('widget', widgetIds);
  assertUnique('section', sectionIds);

  const forbiddenV2Markers = [
    ["b:version='2'", /\bb:version=['"]2['"]/],
    ["class='v2'", /\bclass=['"]v2['"]/]
  ];

  for (const [label, pattern] of forbiddenV2Markers) {
    if (pattern.test(structuralXml)) {
      throw new Error(
        `Blogger structure validation failed: forbidden V2 marker ${label} found in a V3 theme.`
      );
    }
  }

  const loopStart = structuralXml.indexOf("<b:loop values='data:posts' var='post'>");
  const includeStart = structuralXml.indexOf("<b:include data='post' name='post'/>", loopStart);
  const loopEnd = structuralXml.indexOf('</b:loop>', loopStart);
  const postIncludableStart = structuralXml.indexOf("<b:includable id='post' var='post'>");
  const postIncludableEnd = structuralXml.indexOf('</b:includable>', postIncludableStart);

  if (
    loopStart === -1 ||
    includeStart === -1 ||
    loopEnd === -1 ||
    includeStart < loopStart ||
    includeStart > loopEnd ||
    postIncludableStart === -1 ||
    postIncludableEnd === -1 ||
    postIncludableStart > postIncludableEnd
  ) {
    throw new Error(
      'Blogger structure validation failed: post includable/include flow is invalid.'
    );
  }
};

const validateXml = (xml) => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    allowBooleanAttributes: true,
    processEntities: true,
    trimValues: false
  });

  try {
    parser.parse(xml);
  } catch (error) {
    throw new Error(`Generated theme is not valid XML: ${error.message}`);
  }
};

/**
 * CLI entry point.
 */
const main = async () => {
  const validateOnly = process.argv.includes('--validate-only');
  const output = await buildTheme();

  validateXml(output);
  validateBloggerStructure(output);

  if (validateOnly) {
    console.log('Theme validation passed: generated XML is well-formed.');
    return;
  }

  await mkdir(DIST, { recursive: true });
  await writeFile(files.output, output, 'utf8');

  console.log(`Theme built successfully: ${path.relative(ROOT, files.output)}`);
  console.log(`Generated size: ${Buffer.byteLength(output, 'utf8')} bytes`);
};

main().catch((error) => {
  console.error('Build failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
